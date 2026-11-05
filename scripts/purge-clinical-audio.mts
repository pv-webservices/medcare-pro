/**
 * RM-3: purge every stored consultation-recording audio object before the
 * clinical AI tables are dropped. Dry run by default.
 *
 *   npx tsx scripts/purge-clinical-audio.mts                         # dry run
 *   npx tsx scripts/purge-clinical-audio.mts --apply --allow-remote  # delete
 *
 * What it finds:
 *   - every `storage_key` (and in-progress `upload_id`) in consultation_recordings,
 *     while that table still exists;
 *   - every object under `clinical-recordings/` and `acceptance/synthetic-` in the
 *     recordings bucket, and every unfinished multipart upload there. These are
 *     the only key shapes the removed storage code (src/lib/clinical-audio at
 *     dd1c3f4) and its acceptance script ever wrote, so objects the database lost
 *     track of are purged too;
 *   - local files under RECORDING_LOCAL_ROOT (default `.private_clinical_audio`),
 *     where the non-production `local` driver wrote audio and multipart parts.
 *
 * Safety: --apply needs --allow-remote whenever DATABASE_URL is not localhost or
 * the R2/S3 bucket is configured. Idempotent: a re-run finds nothing left.
 * Logs counts and byte totals only — never keys, ids, names or audio.
 */
import "dotenv/config";
import { lstat, readdir, rm, rmdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, parse, resolve, sep } from "node:path";
import {
  AbortMultipartUploadCommand,
  DeleteObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { prisma } from "@/lib/prisma";
import { describeScriptError } from "@/lib/scriptErrors";

const apply = process.argv.includes("--apply");
const allowRemote = process.argv.includes("--allow-remote");
const localDb = ["localhost", "127.0.0.1", "::1"].includes(
  new URL(process.env.DATABASE_URL ?? "mysql://invalid").hostname,
);

/** The only key shapes the removed storage code wrote to the bucket. */
const BUCKET_PREFIXES = ["clinical-recordings/", "acceptance/synthetic-"] as const;
/** The only folders the removed local driver wrote under its root. */
const LOCAL_FOLDERS = ["clinical-recordings", "multipart"] as const;

interface RecordingRow {
  storage_key: string | null;
  upload_id: string | null;
  byte_size: bigint | number | null;
  audio_deleted_at: Date | null;
}

let failures = 0;
const say = (line: string) => console.log(line);
const mb = (bytes: number) => (bytes < 1024 * 1024 ? `${bytes} bytes` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

async function tableExists(name: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) AS n FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name = ${name}`;
  return Number(rows[0]?.n ?? 0) > 0;
}

async function databaseRecordings(): Promise<RecordingRow[] | null> {
  if (!(await tableExists("consultation_recordings"))) return null;
  return prisma.$queryRaw<RecordingRow[]>`
    SELECT storage_key, upload_id, byte_size, audio_deleted_at
    FROM consultation_recordings`;
}

async function pendingGeminiArtifacts(): Promise<number | null> {
  if (!(await tableExists("transcription_runs"))) return null;
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) AS n FROM transcription_runs
    WHERE provider_artifact_name IS NOT NULL AND provider_artifact_deleted_at IS NULL`;
  return Number(rows[0]?.n ?? 0);
}

function s3FromEnv(): { client: S3Client; bucket: string } | null {
  const bucket = process.env.RECORDING_S3_BUCKET?.trim();
  if (!bucket) return null;
  const required = ["RECORDING_S3_ENDPOINT", "RECORDING_S3_REGION", "RECORDING_S3_ACCESS_KEY_ID", "RECORDING_S3_SECRET_ACCESS_KEY"];
  const missing = required.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) throw new Error(`RECORDING_S3_BUCKET is set but ${missing.join(", ")} is missing.`);
  return {
    bucket,
    client: new S3Client({
      endpoint: process.env.RECORDING_S3_ENDPOINT,
      region: process.env.RECORDING_S3_REGION,
      forcePathStyle: process.env.RECORDING_S3_FORCE_PATH_STYLE === "true",
      credentials: {
        accessKeyId: process.env.RECORDING_S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.RECORDING_S3_SECRET_ACCESS_KEY!,
      },
      maxAttempts: 3,
    }),
  };
}

async function listObjects(s3: { client: S3Client; bucket: string }) {
  const objects = new Map<string, number>();
  for (const prefix of BUCKET_PREFIXES) {
    let token: string | undefined;
    do {
      const page = await s3.client.send(new ListObjectsV2Command({ Bucket: s3.bucket, Prefix: prefix, ContinuationToken: token }));
      for (const item of page.Contents ?? []) if (item.Key) objects.set(item.Key, item.Size ?? 0);
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  }
  return objects;
}

async function listUploads(s3: { client: S3Client; bucket: string }) {
  const uploads = new Map<string, { key: string; uploadId: string }>();
  for (const prefix of BUCKET_PREFIXES) {
    let keyMarker: string | undefined;
    let uploadIdMarker: string | undefined;
    do {
      const page = await s3.client.send(new ListMultipartUploadsCommand({ Bucket: s3.bucket, Prefix: prefix, KeyMarker: keyMarker, UploadIdMarker: uploadIdMarker }));
      for (const upload of page.Uploads ?? [])
        if (upload.Key && upload.UploadId) uploads.set(upload.UploadId, { key: upload.Key, uploadId: upload.UploadId });
      keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
      uploadIdMarker = page.IsTruncated ? page.NextUploadIdMarker : undefined;
    } while (keyMarker);
  }
  return uploads;
}

/** Refuses roots that could hold anything other than the old driver's audio. */
function safeLocalRoot(): string {
  const root = resolve(process.env.RECORDING_LOCAL_ROOT || ".private_clinical_audio");
  const forbidden = [parse(root).root, homedir(), process.cwd(), resolve("public")];
  if (forbidden.includes(root) || root.startsWith(resolve("public") + sep))
    throw new Error("RECORDING_LOCAL_ROOT points at a directory the purge refuses to touch.");
  return root;
}

async function walk(dir: string): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { files, bytes };
    throw error;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) continue; // never follow links out of the root
    if (entry.isDirectory()) {
      const nested = await walk(path);
      files += nested.files;
      bytes += nested.bytes;
    } else if (entry.isFile()) {
      files += 1;
      bytes += (await lstat(path)).size;
    }
  }
  return { files, bytes };
}

async function main() {
  const s3 = s3FromEnv();
  if (apply && (!localDb || s3) && !allowRemote) {
    console.error("Deleting from a non-local database or from the R2/S3 bucket requires --apply --allow-remote.");
    process.exitCode = 1;
    return;
  }
  say(`Clinical audio purge: ${apply ? "APPLY" : "DRY RUN"}`);

  // 1. What the database knows about.
  const rows = await databaseRecordings();
  const dbKeys = new Set<string>();
  const dbUploads = new Map<string, { key: string; uploadId: string }>();
  let dbBytes = 0;
  if (rows === null) {
    say("Database: consultation_recordings is already dropped; relying on the bucket listing.");
  } else {
    for (const row of rows) {
      if (!row.storage_key) continue;
      dbKeys.add(row.storage_key);
      if (row.audio_deleted_at === null) dbBytes += Number(row.byte_size ?? 0);
      if (row.upload_id) dbUploads.set(row.upload_id, { key: row.storage_key, uploadId: row.upload_id });
    }
    const retained = rows.filter((row) => row.storage_key && row.audio_deleted_at === null).length;
    say(`Database: ${rows.length} recording rows, ${dbKeys.size} with a storage key, ${retained} not yet retention-deleted (${mb(dbBytes)} recorded).`);
  }

  // 2. The bucket.
  if (s3) {
    const objects = await listObjects(s3);
    const uploads = await listUploads(s3);
    // An upload the bucket no longer lists was already completed or aborted.
    for (const id of [...dbUploads.keys()]) if (!uploads.has(id)) dbUploads.delete(id);
    for (const [id, upload] of uploads) dbUploads.set(id, upload);
    const listedBytes = [...objects.values()].reduce((sum, size) => sum + size, 0);
    const knownToDb = [...objects.keys()].filter((key) => dbKeys.has(key)).length;
    const missing = [...dbKeys].filter((key) => !objects.has(key)).length;
    say(`Bucket: ${objects.size} audio objects (${mb(listedBytes)}); ${knownToDb} match a database row, ${objects.size - knownToDb} are orphans; ${missing} database keys are already gone; ${dbUploads.size} unfinished multipart uploads.`);
    if (apply) {
      let deleted = 0;
      for (const key of objects.keys()) {
        try {
          await s3.client.send(new DeleteObjectCommand({ Bucket: s3.bucket, Key: key }));
          deleted += 1;
        } catch (error: unknown) {
          failures += 1;
          console.error(`Delete failed: ${describeScriptError(error)}`);
        }
      }
      let aborted = 0;
      for (const upload of dbUploads.values()) {
        try {
          await s3.client.send(new AbortMultipartUploadCommand({ Bucket: s3.bucket, Key: upload.key, UploadId: upload.uploadId }));
          aborted += 1;
        } catch (error: unknown) {
          if (error instanceof Error && error.name === "NoSuchUpload") continue;
          failures += 1;
          console.error(`Abort failed: ${describeScriptError(error)}`);
        }
      }
      const left = await listObjects(s3);
      say(`Bucket: deleted ${deleted} objects, aborted ${aborted} uploads; ${left.size} audio objects remain.`);
      if (left.size > 0) failures += 1;
    }
  } else if (dbKeys.size > 0) {
    say("Bucket: RECORDING_S3_* is not configured, so stored audio cannot be listed or deleted.");
    if (apply) {
      console.error("Refusing to continue: the database lists stored audio but no bucket credentials are set.");
      failures += 1;
    }
  } else {
    say("Bucket: RECORDING_S3_* is not configured and the database lists no stored audio.");
  }

  // 3. Local driver files.
  const root = safeLocalRoot();
  let localFiles = 0;
  let localBytes = 0;
  for (const folder of LOCAL_FOLDERS) {
    const found = await walk(join(root, folder));
    localFiles += found.files;
    localBytes += found.bytes;
  }
  say(`Local: ${localFiles} files (${mb(localBytes)}) under the local recording root.`);
  if (apply && localFiles > 0) {
    for (const folder of LOCAL_FOLDERS) await rm(join(root, folder), { recursive: true, force: true });
    await rmdir(root).catch(() => undefined); // only if now empty
    say("Local: removed.");
  }

  // 4. Copies held by Gemini (informational).
  const gemini = await pendingGeminiArtifacts();
  if (gemini !== null && gemini > 0)
    say(`Gemini: ${gemini} transcription uploads were never confirmed deleted. The Gemini Files API deletes uploads after 48 hours, and RM-1 revoked the key, so there is nothing left to delete.`);

  if (!apply) say("Nothing deleted. Review the counts, then re-run with --apply (and --allow-remote for production).");
  if (failures > 0) {
    console.error(`${failures} problem(s); re-run to retry.`);
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error(`Clinical audio purge failed. ${describeScriptError(error)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
