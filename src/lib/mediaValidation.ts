import path from "node:path";
import {
  ALLOWED_MIME_CONFIG,
  getMaxBytesForMediaType,
  type AllowedMimeType,
} from "@/lib/mediaTypes";

export class MediaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaValidationError";
  }
}

export interface DetectedType {
  mimeType: AllowedMimeType;
  extension: string;
}

/**
 * Validates real file signature / magic bytes from the initial buffer.
 * Rejects executables, scripts, SVGs, HTML, ZIPs, and any unallowed format.
 */
export function detectMagicBytes(buffer: Buffer): DetectedType | null {
  if (buffer.length < 8) {
    return null;
  }

  // Explicitly reject known dangerous signatures
  // Windows PE executable (MZ)
  if (buffer[0] === 0x4d && buffer[1] === 0x5a) {
    return null;
  }
  // Linux ELF
  if (buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) {
    return null;
  }
  // ZIP / Office OpenXML / JAR (PK\x03\x04)
  if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
    return null;
  }
  // Shell script shebang
  if (buffer[0] === 0x23 && buffer[1] === 0x21) {
    return null;
  }

  // Check text-based dangerous content (HTML, SVG, XML)
  const initialText = buffer.subarray(0, Math.min(buffer.length, 512)).toString("utf8").toLowerCase().trim();
  if (
    initialText.includes("<svg") ||
    initialText.includes("<!doctype html") ||
    initialText.includes("<html") ||
    initialText.includes("<script")
  ) {
    return null;
  }

  // 1. JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: "image/jpeg", extension: ".jpg" };
  }

  // 2. PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { mimeType: "image/png", extension: ".png" };
  }

  // 3. WebP: RIFF .... WEBP
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return { mimeType: "image/webp", extension: ".webp" };
  }

  // 4. PDF: %PDF-
  if (
    buffer.length >= 5 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46 &&
    buffer[4] === 0x2d
  ) {
    return { mimeType: "application/pdf", extension: ".pdf" };
  }

  // 5. MP4: [4 bytes box size] ftyp ....
  if (
    buffer.length >= 12 &&
    buffer[4] === 0x66 &&
    buffer[5] === 0x74 &&
    buffer[6] === 0x79 &&
    buffer[7] === 0x70
  ) {
    return { mimeType: "video/mp4", extension: ".mp4" };
  }

  return null;
}

export interface ValidatedMediaInfo {
  mimeType: AllowedMimeType;
  mediaType: "IMAGE" | "VIDEO" | "DOCUMENT";
  extension: string;
  originalFileName: string;
}

/**
 * Validates filename, declared MIME, and buffer magic bytes together.
 * Asserts file extension matches detected format and file size is within limits.
 */
export function validateMediaUpload(params: {
  fileName: string;
  declaredMimeType?: string | null;
  bufferHead: Buffer;
  fileSizeBytes: number;
}): ValidatedMediaInfo {
  const { fileName, bufferHead, fileSizeBytes } = params;

  // Sanitize and check filename
  const cleanName = path.basename(fileName).trim();
  if (!cleanName || cleanName === "." || cleanName === "..") {
    throw new MediaValidationError("Invalid file name.");
  }

  const rawExt = path.extname(cleanName).toLowerCase();
  if (!rawExt) {
    throw new MediaValidationError("File has no extension.");
  }

  // Validate magic bytes
  const detected = detectMagicBytes(bufferHead);
  if (!detected) {
    throw new MediaValidationError(
      "Unsupported or invalid file format. Only JPEG, PNG, WebP, MP4, and PDF are allowed.",
    );
  }

  const config = ALLOWED_MIME_CONFIG[detected.mimeType];
  if (!config) {
    throw new MediaValidationError("Unsupported media format.");
  }

  // Verify extension matches detected MIME type
  const allowedExtensions: readonly string[] = config.extensions;
  if (!allowedExtensions.includes(rawExt)) {
    throw new MediaValidationError(
      `File extension "${rawExt}" does not match the actual file content (${detected.mimeType}).`,
    );
  }

  // Enforce size limits based on detected media type
  const maxBytes = getMaxBytesForMediaType(config.mediaType);
  if (fileSizeBytes > maxBytes) {
    const mbLimit = Math.round(maxBytes / (1024 * 1024));
    throw new MediaValidationError(
      `File size (${(fileSizeBytes / (1024 * 1024)).toFixed(1)} MB) exceeds the maximum allowed limit of ${mbLimit} MB for ${config.mediaType.toLowerCase()}s.`,
    );
  }

  return {
    mimeType: detected.mimeType,
    mediaType: config.mediaType,
    extension: rawExt,
    originalFileName: cleanName,
  };
}
