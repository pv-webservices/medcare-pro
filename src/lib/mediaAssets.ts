import crypto from "node:crypto";
import { Readable } from "node:stream";
import { prisma } from "@/lib/prisma";
import { ConflictError } from "@/lib/apiHandler";
import {
  can,
  requirePermission,
  assertClinicInTenant,
  ScopeError,
  type ActorContext,
} from "@/lib/rbac";
import {
  DEFAULT_MAX_VIDEO_BYTES,
  type SafeMediaAsset,
  type StoredMediaType,
} from "@/lib/mediaTypes";
import { validateMediaUpload } from "@/lib/mediaValidation";
import {
  buildRelativeStoragePath,
  deletePhysicalFile,
  moveTempToFinal,
  writeUploadToTemp,
} from "@/lib/mediaStorage";
import {
  buildMediaContentUrl,
  buildDocumentContentUrl,
  getPreviewTtlSeconds,
} from "@/lib/mediaSecurity";

function toSafeMediaAsset(row: {
  id: string;
  clinicId: string;
  originalFileName: string;
  mimeType: string;
  mediaType: StoredMediaType;
  fileSize: number;
  createdAt: Date;
  lastUsedAt: Date | null;
}): SafeMediaAsset {
  return {
    id: row.id,
    clinicId: row.clinicId,
    originalFileName: row.originalFileName,
    mimeType: row.mimeType,
    mediaType: row.mediaType,
    fileSize: row.fileSize,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  };
}

export interface SaveMediaUploadInput {
  clinicId: string;
  fileName: string;
  declaredMimeType?: string | null;
  stream: Readable;
}

/**
 * Validates, writes, and registers a locally uploaded media file.
 * Multi-tenant safe: binds tenantId, clinicId, and uploadedByUserId.
 */
export async function saveUploadedMediaAsset(
  actor: ActorContext,
  input: SaveMediaUploadInput,
): Promise<SafeMediaAsset> {
  // Enforce template/messaging permissions on clinic
  await requirePermission(actor, "message:template", input.clinicId);

  // Maximum upper bound on temp buffer before specific type checks
  const maxBytes = DEFAULT_MAX_VIDEO_BYTES;

  // Stream to temp storage
  const temp = await writeUploadToTemp(input.stream, maxBytes);

  let relativePath: string | null = null;

  try {
    // Validate file magic bytes and actual size limit for detected type
    const validated = validateMediaUpload({
      fileName: input.fileName,
      declaredMimeType: input.declaredMimeType,
      bufferHead: temp.bufferHead,
      fileSizeBytes: temp.bytesWritten,
    });

    const storedFileName = `${crypto.randomUUID()}${validated.extension}`;
    relativePath = buildRelativeStoragePath({
      tenantId: actor.tenantId,
      clinicId: input.clinicId,
      storedFileName,
    });

    // Move file atomically to permanent private path
    await moveTempToFinal(temp.tempFilePath, relativePath);

    // Save DB metadata
    const asset = await prisma.mediaAsset.create({
      data: {
        tenantId: actor.tenantId,
        clinicId: input.clinicId,
        uploadedByUserId: actor.userId,
        originalFileName: validated.originalFileName,
        storedFileName,
        mimeType: validated.mimeType,
        mediaType: validated.mediaType,
        fileSize: temp.bytesWritten,
        storagePath: relativePath,
        sha256: temp.sha256,
      },
      select: {
        id: true,
        clinicId: true,
        originalFileName: true,
        mimeType: true,
        mediaType: true,
        fileSize: true,
        createdAt: true,
        lastUsedAt: true,
      },
    });

    return toSafeMediaAsset(asset);
  } catch (error) {
    // If DB write fails after moving file, clean up permanent file
    if (relativePath) {
      await deletePhysicalFile(relativePath).catch(() => {});
    }
    throw error;
  }
}

/**
 * Lists media assets for a given clinic visible to the actor.
 */
export async function listMediaForActor(
  actor: ActorContext,
  clinicId: string,
  mediaType?: StoredMediaType,
): Promise<SafeMediaAsset[]> {
  await assertClinicInTenant(actor.tenantId, clinicId);

  // Actor must have messaging rights in this clinic
  const [canTemplate, canSend] = await Promise.all([
    can(actor, "message:template", clinicId),
    can(actor, "message:send", clinicId),
  ]);

  if (!canTemplate && !canSend) {
    throw new ScopeError();
  }

  const rows = await prisma.mediaAsset.findMany({
    where: {
      tenantId: actor.tenantId,
      clinicId,
      deletedAt: null,
      ...(mediaType ? { mediaType } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      clinicId: true,
      originalFileName: true,
      mimeType: true,
      mediaType: true,
      fileSize: true,
      createdAt: true,
      lastUsedAt: true,
    },
  });

  return rows.map(toSafeMediaAsset);
}

/**
 * Gets a single media asset by id, ensuring tenant and clinic isolation.
 */
export async function getMediaForActor(
  actor: ActorContext,
  mediaId: string,
): Promise<SafeMediaAsset> {
  const row = await prisma.mediaAsset.findFirst({
    where: {
      id: mediaId,
      tenantId: actor.tenantId,
      deletedAt: null,
    },
    select: {
      id: true,
      clinicId: true,
      originalFileName: true,
      mimeType: true,
      mediaType: true,
      fileSize: true,
      createdAt: true,
      lastUsedAt: true,
    },
  });

  if (!row) {
    throw new ScopeError();
  }

  // Verify actor has access to this clinic
  const [canTemplate, canSend] = await Promise.all([
    can(actor, "message:template", row.clinicId),
    can(actor, "message:send", row.clinicId),
  ]);

  if (!canTemplate && !canSend) {
    throw new ScopeError();
  }

  return toSafeMediaAsset(row);
}

/**
 * Deletes a media asset after verifying it is not referenced by any active templates.
 */
export async function deleteMediaForActor(
  actor: ActorContext,
  mediaId: string,
): Promise<{ deleted: true }> {
  const row = await prisma.mediaAsset.findFirst({
    where: {
      id: mediaId,
      tenantId: actor.tenantId,
      deletedAt: null,
    },
    select: {
      id: true,
      clinicId: true,
      storagePath: true,
    },
  });

  if (!row) {
    throw new ScopeError();
  }

  // Require template management permission for deletion
  await requirePermission(actor, "message:template", row.clinicId);

  // Check if asset is bound to any active template
  const activeTemplateBindings = await prisma.whatsappTemplateMedia.count({
    where: { mediaAssetId: mediaId },
  });

  if (activeTemplateBindings > 0) {
    throw new ConflictError(
      "This file is attached to one or more message templates. Remove the attachment from the template before deleting.",
    );
  }

  // Delete physical file from private filesystem
  await deletePhysicalFile(row.storagePath);

  // Delete DB record
  await prisma.mediaAsset.delete({
    where: { id: mediaId },
  });

  return { deleted: true };
}

/**
 * Generates a temporary signed preview URL for an authenticated user.
 */
export async function generateMediaPreviewUrlForActor(
  actor: ActorContext,
  mediaId: string,
): Promise<{ url: string; ttlSeconds: number }> {
  const media = await getMediaForActor(actor, mediaId);

  const ttlSeconds = getPreviewTtlSeconds();
  const url =
    media.mediaType === "DOCUMENT"
      ? buildDocumentContentUrl({
          mediaId: media.id,
          tenantId: actor.tenantId,
          clinicId: media.clinicId,
          originalFileName: media.originalFileName,
          purpose: "preview",
          ttlSeconds,
        })
      : buildMediaContentUrl({
          mediaId: media.id,
          tenantId: actor.tenantId,
          clinicId: media.clinicId,
          purpose: "preview",
          ttlSeconds,
        });

  return { url, ttlSeconds };
}

