import { z } from "zod";
import type { StoredMediaType } from "@prisma/client";

export { StoredMediaType };

export const ALLOWED_MIME_CONFIG = {
  "image/jpeg": {
    extensions: [".jpg", ".jpeg"],
    defaultExt: ".jpg",
    mediaType: "IMAGE" as StoredMediaType,
    rkvType: "image" as const,
  },
  "image/png": {
    extensions: [".png"],
    defaultExt: ".png",
    mediaType: "IMAGE" as StoredMediaType,
    rkvType: "image" as const,
  },
  "image/webp": {
    extensions: [".webp"],
    defaultExt: ".webp",
    mediaType: "IMAGE" as StoredMediaType,
    rkvType: "image" as const,
  },
  "video/mp4": {
    extensions: [".mp4"],
    defaultExt: ".mp4",
    mediaType: "VIDEO" as StoredMediaType,
    rkvType: "video" as const,
  },
  "application/pdf": {
    extensions: [".pdf"],
    defaultExt: ".pdf",
    mediaType: "DOCUMENT" as StoredMediaType,
    rkvType: "document" as const,
  },
} as const;

export type AllowedMimeType = keyof typeof ALLOWED_MIME_CONFIG;

export const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
export const DEFAULT_MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50 MB
export const DEFAULT_MAX_DOCUMENT_BYTES = 20 * 1024 * 1024; // 20 MB

export function getMaxBytesForMediaType(type: StoredMediaType): number {
  if (type === "IMAGE") {
    const custom = parseInt(process.env.MEDIA_MAX_IMAGE_BYTES ?? "", 10);
    return Number.isFinite(custom) && custom > 0 ? custom : DEFAULT_MAX_IMAGE_BYTES;
  }
  if (type === "VIDEO") {
    const custom = parseInt(process.env.MEDIA_MAX_VIDEO_BYTES ?? "", 10);
    return Number.isFinite(custom) && custom > 0 ? custom : DEFAULT_MAX_VIDEO_BYTES;
  }
  if (type === "DOCUMENT") {
    const custom = parseInt(process.env.MEDIA_MAX_DOCUMENT_BYTES ?? "", 10);
    return Number.isFinite(custom) && custom > 0 ? custom : DEFAULT_MAX_DOCUMENT_BYTES;
  }
  return DEFAULT_MAX_DOCUMENT_BYTES;
}

export interface SafeMediaAsset {
  id: string;
  clinicId: string;
  originalFileName: string;
  mimeType: string;
  mediaType: StoredMediaType;
  fileSize: number;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export type MediaTokenPurpose = "preview" | "whatsapp";

export interface MediaAccessTokenPayload {
  v: 1;
  mediaId: string;
  tenantId: string;
  clinicId: string;
  purpose: MediaTokenPurpose;
  exp: number;
}

export const bindTemplateMediaSchema = z.object({
  clinicId: z.string().trim().min(1).max(64),
  mediaAssetId: z.string().trim().min(1).max(64),
});

export const removeTemplateMediaSchema = z.object({
  clinicId: z.string().trim().min(1).max(64),
});

export const listMediaQuerySchema = z.object({
  clinicId: z.string().trim().min(1).max(64),
  mediaType: z.enum(["IMAGE", "VIDEO", "DOCUMENT"]).optional(),
});

export class MediaConfigurationError extends Error {
  constructor(message = "Media service is not properly configured.") {
    super(message);
    this.name = "MediaConfigurationError";
  }
}

export class MediaFileMissingError extends Error {
  constructor(message = "The requested media file could not be found.") {
    super(message);
    this.name = "MediaFileMissingError";
  }
}

export class MediaAccessError extends Error {
  constructor(message = "You do not have access to this media.") {
    super(message);
    this.name = "MediaAccessError";
  }
}

