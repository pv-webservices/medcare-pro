import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { ActorContext } from "@/lib/rbac";
import { ScopeError } from "@/lib/rbac";
import { RecordingStateError } from "./errors";
import {
  ALLOWED_AUDIO_MIME,
  audioAudit,
  publicRecording,
  recordingForActor,
  withRecordingLock,
} from "./recordingService";
import { getClinicalAudioConfig } from "./config";
import {
  getRecordingStorageProvider,
  type RecordingStorageProvider,
} from "./storage";
export const uploadInitSchema = z.strictObject({
  mimeType: z.enum(ALLOWED_AUDIO_MIME as [string, ...string[]]),
  byteSize: z.number().int().min(1024).max(2_147_483_647),
  durationMs: z.number().int().min(0).max(7_200_000),
});
export const uploadPartSchema = z.strictObject({
  uploadId: z.string().min(1).max(255),
  partNumber: z.number().int().min(1).max(10000),
});
export const uploadCompleteSchema = z
  .strictObject({
    uploadId: z.string().min(1).max(255),
    parts: z
      .array(
        z.strictObject({
          partNumber: z.number().int().min(1).max(10000),
          etag: z.string().regex(/^"?[a-zA-Z0-9+\/_=-]{8,200}"?$/),
        }),
      )
      .min(1)
      .max(10000),
  })
  .refine((v) => v.parts.every((p, i) => p.partNumber === i + 1));
const getProvider = (p?: RecordingStorageProvider) =>
  p ?? getRecordingStorageProvider();
export async function initRecordingUpload(
  actor: ActorContext,
  id: string,
  raw: unknown,
  p?: RecordingStorageProvider,
) {
  const input = uploadInitSchema.parse(raw);
  return withRecordingLock(actor, id, async (tx, r) => {
    const c = getClinicalAudioConfig()!;
    if (
      r.consent.withdrawnAt ||
      !["STOPPED", "UPLOADING", "READY"].includes(r.status)
    )
      throw new RecordingStateError("Recording cannot be uploaded.");
    if (
      input.byteSize > c.maxBytes ||
      input.durationMs > c.maxMinutes * 60000 ||
      r.mimeType !== input.mimeType ||
      r.durationMs !== input.durationMs
    )
      throw new RecordingStateError("Recording metadata does not match.");
    if (r.status === "READY")
      return {
        recording: publicRecording(r),
        uploadId: r.uploadId,
        partSize: r.uploadPartSize!,
        partCount: r.uploadPartCount!,
      };
    if (r.status === "UPLOADING") {
      if (r.uploadExpectedBytes !== BigInt(input.byteSize))
        throw new RecordingStateError("Upload metadata changed.");
      return {
        recording: publicRecording(r),
        uploadId: r.uploadId!,
        partSize: r.uploadPartSize!,
        partCount: r.uploadPartCount!,
      };
    }
    const ext = input.mimeType.includes("ogg")
      ? "ogg"
      : input.mimeType.includes("mp4")
        ? "mp4"
        : "webm";
    const key =
      "clinical-recordings/" + actor.tenantId + "/" + id + "/source." + ext;
    const partSize = Math.max(
      8 * 1024 * 1024,
      Math.ceil(input.byteSize / 10000),
    );
    const provider = getProvider(p);
    const { uploadId } = await provider.createMultipartUpload({
      key,
      contentType: input.mimeType,
    });
    const updated = await tx.consultationRecording.update({
      where: { id },
      data: {
        status: "UPLOADING",
        storageProvider: c.storageProvider,
        storageKey: key,
        uploadId,
        uploadPartSize: partSize,
        uploadPartCount: Math.ceil(input.byteSize / partSize),
        uploadExpectedBytes: BigInt(input.byteSize),
        version: { increment: 1 },
      },
    });
    await audioAudit(tx, actor, updated, "upload-init");
    return {
      recording: publicRecording(updated),
      uploadId,
      partSize,
      partCount: updated.uploadPartCount!,
    };
  });
}
export async function signRecordingPart(
  actor: ActorContext,
  id: string,
  raw: unknown,
  p?: RecordingStorageProvider,
) {
  const input = uploadPartSchema.parse(raw);
  return withRecordingLock(actor, id, async (_tx, r) => {
    if (
      r.status !== "UPLOADING" ||
      r.consent.withdrawnAt ||
      r.uploadId !== input.uploadId ||
      !r.storageKey ||
      !r.uploadPartCount ||
      input.partNumber > r.uploadPartCount
    )
      throw new RecordingStateError("Upload is not active.");
    const size =
      input.partNumber === r.uploadPartCount
        ? Number(r.uploadExpectedBytes!) -
          (input.partNumber - 1) * r.uploadPartSize!
        : r.uploadPartSize!;
    return {
      ...(await getProvider(p).signUploadPart({
        key: r.storageKey,
        uploadId: r.uploadId,
        partNumber: input.partNumber,
        size,
      })),
      size,
    };
  });
}
export async function completeRecordingUpload(
  actor: ActorContext,
  id: string,
  raw: unknown,
  p?: RecordingStorageProvider,
) {
  const input = uploadCompleteSchema.parse(raw);
  const hash = createHash("sha256")
    .update(JSON.stringify(input.parts))
    .digest("hex");
  return withRecordingLock(actor, id, async (tx, r) => {
    if (
      r.consent.withdrawnAt ||
      r.uploadId !== input.uploadId ||
      !r.storageKey ||
      input.parts.length !== r.uploadPartCount
    )
      throw new RecordingStateError("Upload does not match.");
    if (r.status === "READY") {
      if (r.uploadCompletedPartsHash !== hash)
        throw new RecordingStateError("Completion changed.");
      return publicRecording(r);
    }
    if (r.status !== "UPLOADING")
      throw new RecordingStateError("Upload is not active.");
    const provider = getProvider(p);
    let head;
    // HEAD also recovers a prior complete that succeeded at storage before an interrupted DB commit.
    try {
      head = await provider.headObject({ key: r.storageKey });
    } catch {
      head = null;
    }
    if (!head) {
      await provider.completeMultipartUpload({
        key: r.storageKey,
        uploadId: r.uploadId,
        parts: input.parts,
      });
      head = await provider.headObject({ key: r.storageKey });
    }
    if (
      head.size !== Number(r.uploadExpectedBytes) ||
      head.size < 1024 ||
      head.size > getClinicalAudioConfig()!.maxBytes ||
      head.contentType !== r.mimeType
    ) {
      await provider.deleteObject({ key: r.storageKey });
      throw new RecordingStateError("Storage validation failed.");
    }
    const c = getClinicalAudioConfig()!;
    const updated = await tx.consultationRecording.update({
      where: { id },
      data: {
        status: "READY",
        activeKey: null,
        byteSize: BigInt(head.size),
        sha256: head.sha256 ?? null,
        uploadedAt: new Date(),
        audioDeleteAfter: c.retentionDays
          ? new Date(Date.now() + c.retentionDays * 86400000)
          : null,
        uploadCompletedPartsHash: hash,
        version: { increment: 1 },
      },
    });
    await audioAudit(tx, actor, updated, "upload-complete");
    return publicRecording(updated);
  });
}
export async function discardRecording(
  actor: ActorContext,
  id: string,
  p?: RecordingStorageProvider,
) {
  return withRecordingLock(
    actor,
    id,
    async (tx, r) => {
      if (r.status === "ABORTED") return publicRecording(r);
      if (r.status === "READY")
        throw new RecordingStateError("This recording is already retained.");
      if (r.uploadId && r.storageKey) {
        const provider = getProvider(p);
        await provider.abortMultipartUpload({
          key: r.storageKey,
          uploadId: r.uploadId,
        });
        await provider.deleteObject({ key: r.storageKey });
      }
      const updated = await tx.consultationRecording.update({
        where: { id },
        data: {
          status: "ABORTED",
          activeKey: null,
          stoppedAt: new Date(),
          version: { increment: 1 },
        },
      });
      await audioAudit(tx, actor, updated, "discard");
      return publicRecording(updated);
    },
    false,
  );
}
export async function getRecordingAudioUrl(
  actor: ActorContext,
  id: string,
  p?: RecordingStorageProvider,
) {
  const r = await recordingForActor(
    actor,
    id,
    "clinical-ai:transcript-read",
    prisma,
    false,
  );
  if (
    r.status !== "READY" ||
    r.audioDeletedAt ||
    r.consent.withdrawnAt ||
    !r.storageKey
  )
    throw new ScopeError();
  const ttl = getClinicalAudioConfig()!.signedUrlTtlSeconds;
  return {
    url: await getProvider(p).getSignedReadUrl({
      key: r.storageKey,
      ttlSeconds: ttl,
    }),
    expiresIn: ttl,
  };
}
