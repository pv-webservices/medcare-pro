import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}

/**
 * Gets the configured media storage root directory.
 * Asserts the root is not inside prohibited public or build directories.
 */
export function getMediaStorageRoot(): string {
  const custom = (process.env.MEDIA_STORAGE_ROOT ?? "").trim();
  let root: string;

  if (custom !== "") {
    root = path.resolve(custom);
  } else {
    // Default safe local directory for dev/testing
    root = path.resolve(process.cwd(), ".private_media");
  }

  // Ensure root is not a public directory or source directory
  const forbiddenSubstrings = [
    path.sep + "public" + path.sep,
    path.sep + ".next" + path.sep,
    path.sep + "public_html" + path.sep,
  ];

  for (const forbidden of forbiddenSubstrings) {
    if (root.includes(forbidden) || root.endsWith(forbidden.slice(0, -1))) {
      throw new StorageError(
        "MEDIA_STORAGE_ROOT cannot be set inside public, public_html, or .next directories.",
      );
    }
  }

  return root;
}

/**
 * Resolves a storage-relative path to an absolute path, asserting that it
 * remains strictly contained within MEDIA_STORAGE_ROOT.
 */
export function resolveSafeStoragePath(relativeStoragePath: string): string {
  const root = getMediaStorageRoot();
  const normalized = path.normalize(relativeStoragePath);

  // Reject any path containing null bytes or starting with path separator
  if (normalized.includes("\0") || path.isAbsolute(normalized)) {
    throw new StorageError("Invalid storage path.");
  }

  const resolved = path.resolve(root, normalized);

  // Security guard: must strictly stay inside root directory
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new StorageError("Path traversal detected.");
  }

  return resolved;
}

/**
 * Generates the relative storage path for a file:
 * {tenantId}/{clinicId}/{YYYY}/{MM}/{generatedFileName}
 */
export function buildRelativeStoragePath(params: {
  tenantId: string;
  clinicId: string;
  storedFileName: string;
  date?: Date;
}): string {
  const d = params.date ?? new Date();
  const year = String(d.getUTCFullYear());
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");

  // Sanitize tenantId and clinicId for filesystem safety
  const safeTenant = params.tenantId.replace(/[^a-zA-Z0-9_-]/g, "");
  const safeClinic = params.clinicId.replace(/[^a-zA-Z0-9_-]/g, "");
  const safeFile = path.basename(params.storedFileName);

  return path.join(safeTenant, safeClinic, year, month, safeFile).replace(/\\/g, "/");
}

export interface StreamWriteResult {
  tempFilePath: string;
  bytesWritten: number;
  sha256: string;
  bufferHead: Buffer;
}

/**
 * Streams an upload readable into a private temporary file while:
 * - enforcing a hard byte limit
 * - calculating SHA-256
 * - capturing the first 256 bytes for magic byte validation
 */
export async function writeUploadToTemp(
  stream: Readable,
  maxAllowedBytes: number,
): Promise<StreamWriteResult> {
  const root = getMediaStorageRoot();
  const tmpDir = path.join(root, "tmp");
  await fs.promises.mkdir(tmpDir, { recursive: true });

  const tempFileName = `tmp-${Date.now()}-${crypto.randomUUID()}.part`;
  const tempFilePath = path.join(tmpDir, tempFileName);

  const hash = crypto.createHash("sha256");
  const writeStream = fs.createWriteStream(tempFilePath);

  let bytesWritten = 0;
  const headChunks: Buffer[] = [];
  let headBytesCaptured = 0;
  let limitExceeded = false;

  try {
    for await (const chunk of stream) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytesWritten += buf.length;

      if (bytesWritten > maxAllowedBytes) {
        limitExceeded = true;
        break;
      }

      hash.update(buf);
      writeStream.write(buf);

      if (headBytesCaptured < 256) {
        headChunks.push(buf);
        headBytesCaptured += buf.length;
      }
    }

    await new Promise<void>((resolve, reject) => {
      writeStream.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });

    if (limitExceeded) {
      // Clean up temp file immediately
      await fs.promises.unlink(tempFilePath).catch(() => {});
      throw new StorageError("Upload exceeds maximum allowed file size.");
    }

    const bufferHead = Buffer.concat(headChunks).subarray(0, 256);
    const sha256 = hash.digest("hex");

    return {
      tempFilePath,
      bytesWritten,
      sha256,
      bufferHead,
    };
  } catch (error) {
    writeStream.destroy();
    await fs.promises.unlink(tempFilePath).catch(() => {});
    throw error;
  }
}

/**
 * Atomically moves a validated temporary file into its final storage path.
 */
export async function moveTempToFinal(
  tempFilePath: string,
  relativeStoragePath: string,
): Promise<string> {
  const finalPath = resolveSafeStoragePath(relativeStoragePath);
  const finalDir = path.dirname(finalPath);

  await fs.promises.mkdir(finalDir, { recursive: true });

  try {
    await fs.promises.rename(tempFilePath, finalPath);
  } catch (err: unknown) {
    // If rename fails across different mount points, fallback to copy + unlink
    if ((err as { code?: string }).code === "EXDEV") {
      await fs.promises.copyFile(tempFilePath, finalPath);
      await fs.promises.unlink(tempFilePath).catch(() => {});
    } else {
      throw err;
    }
  }

  return finalPath;
}

/**
 * Safely removes a physical file given its relative storage path.
 */
export async function deletePhysicalFile(relativeStoragePath: string): Promise<void> {
  try {
    const finalPath = resolveSafeStoragePath(relativeStoragePath);
    await fs.promises.unlink(finalPath);
  } catch (error: unknown) {
    // Ignore ENOENT (file already gone), log other errors server-side
    if ((error as { code?: string }).code !== "ENOENT") {
      console.error("Failed to delete physical media file:", error);
    }
  }
}
