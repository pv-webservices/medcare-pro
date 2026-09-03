import crypto from "node:crypto";
import {
  MediaConfigurationError,
  MediaAccessError,
  type MediaAccessTokenPayload,
  type MediaTokenPurpose,
} from "@/lib/mediaTypes";

export { MediaConfigurationError, MediaAccessError };

export class InvalidTokenError extends Error {
  constructor(message = "Invalid or expired media token.") {
    super(message);
    this.name = "InvalidTokenError";
  }
}

const DEFAULT_PREVIEW_TTL_SECONDS = 300; // 5 minutes
const DEFAULT_WHATSAPP_TTL_SECONDS = 3600; // 1 hour

export function getPreviewTtlSeconds(): number {
  const custom = parseInt(process.env.MEDIA_PREVIEW_URL_TTL_SECONDS ?? "", 10);
  return Number.isFinite(custom) && custom > 0 ? custom : DEFAULT_PREVIEW_TTL_SECONDS;
}

export function getWhatsappTtlSeconds(): number {
  const custom = parseInt(process.env.MEDIA_WHATSAPP_URL_TTL_SECONDS ?? "", 10);
  return Number.isFinite(custom) && custom > 0 ? custom : DEFAULT_WHATSAPP_TTL_SECONDS;
}

function getMediaAccessSecret(): string {
  const secret = (process.env.MEDIA_ACCESS_SECRET ?? "").trim();
  if (secret !== "") {
    return secret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new MediaConfigurationError(
      "MEDIA_ACCESS_SECRET is required in production. Generate a strong random key.",
    );
  }

  // Safe predictable fallback for development and tests
  return "dev-media-access-secret-do-not-use-in-production";
}

function base64UrlEncode(input: string | Buffer): string {
  const buffer = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buffer
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(input: string): Buffer {
  let base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) {
    base64 += "=";
  }
  return Buffer.from(base64, "base64");
}

/**
 * Creates an HMAC-SHA256 signature for the given payload string.
 */
function signPayload(payloadStr: string, secret: string): string {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(payloadStr);
  return base64UrlEncode(hmac.digest());
}

/**
 * Generates a signed token for media access.
 */
export function generateMediaToken(params: {
  mediaId: string;
  tenantId: string;
  clinicId: string;
  purpose: MediaTokenPurpose;
  ttlSeconds?: number;
}): string {
  const secret = getMediaAccessSecret();
  const ttl =
    params.ttlSeconds ??
    (params.purpose === "preview" ? getPreviewTtlSeconds() : getWhatsappTtlSeconds());

  const nowSec = Math.floor(Date.now() / 1000);
  const payload: MediaAccessTokenPayload = {
    v: 1,
    mediaId: params.mediaId,
    tenantId: params.tenantId,
    clinicId: params.clinicId,
    purpose: params.purpose,
    exp: nowSec + ttl,
  };

  const payloadStr = JSON.stringify(payload);
  const encodedPayload = base64UrlEncode(payloadStr);
  const signature = signPayload(encodedPayload, secret);

  return `${encodedPayload}.${signature}`;
}

/**
 * Verifies the token using timing-safe comparison and expiration checks.
 */
export function verifyMediaToken(token: string): MediaAccessTokenPayload {
  if (!token || typeof token !== "string") {
    throw new InvalidTokenError();
  }

  const parts = token.split(".");
  if (parts.length !== 2) {
    throw new InvalidTokenError();
  }

  const [encodedPayload, providedSignature] = parts;
  const secret = getMediaAccessSecret();
  const expectedSignature = signPayload(encodedPayload, secret);

  // Timing-safe comparison of signatures
  const providedBuffer = Buffer.from(providedSignature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");

  if (
    providedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    throw new InvalidTokenError("Invalid token signature.");
  }

  let payload: MediaAccessTokenPayload;
  try {
    const json = base64UrlDecode(encodedPayload).toString("utf8");
    payload = JSON.parse(json) as MediaAccessTokenPayload;
  } catch {
    throw new InvalidTokenError("Malformed token payload.");
  }

  if (payload.v !== 1) {
    throw new InvalidTokenError("Unsupported token version.");
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < nowSec) {
    throw new InvalidTokenError("Token has expired.");
  }

  if (!payload.mediaId || !payload.tenantId || !payload.clinicId) {
    throw new InvalidTokenError("Incomplete token claims.");
  }

  if (payload.purpose !== "preview" && payload.purpose !== "whatsapp") {
    throw new InvalidTokenError("Unsupported token purpose.");
  }

  return payload;
}

/**
 * Derives the canonical public base origin for external links.
 */
export function getCanonicalPublicOrigin(): string {
  const origin = (process.env.NEXTAUTH_URL ?? "").trim().replace(/\/+$/, "");
  if (origin !== "") {
    try {
      const parsed = new URL(origin);
      if (!parsed.protocol.startsWith("http")) {
        throw new Error();
      }
      return origin;
    } catch {
      if (process.env.NODE_ENV === "production") {
        throw new MediaConfigurationError(
          "NEXTAUTH_URL is not a valid HTTP/HTTPS URL.",
        );
      }
    }
  }

  if (process.env.NODE_ENV === "production") {
    throw new MediaConfigurationError(
      "NEXTAUTH_URL is required in production for canonical media URLs.",
    );
  }

  return "http://localhost:3000";
}

/**
 * Builds the full HTTPS URL with the signed access token.
 */
export function buildMediaContentUrl(params: {
  mediaId: string;
  tenantId: string;
  clinicId: string;
  purpose: MediaTokenPurpose;
  ttlSeconds?: number;
}): string {
  const token = generateMediaToken(params);
  const origin = getCanonicalPublicOrigin();
  return `${origin}/api/media/${params.mediaId}/content?token=${encodeURIComponent(token)}`;
}

/**
 * Sanitizes an original filename for safe usage in download URLs and Content-Disposition headers.
 * Strips path traversal sequences, CR/LF, NUL, and control characters to prevent header injection.
 * Replaces whitespace with hyphens and guarantees a `.pdf` extension for document delivery.
 */
export function sanitizeDownloadFileName(
  fileName?: string | null,
  fallback = "document.pdf",
): string {
  if (!fileName || typeof fileName !== "string") {
    return fallback;
  }

  // 1. Strip newlines, carriage returns, null bytes, and control characters
  let clean = fileName
    .replace(/[\r\n\0]/g, "")
    .replace(/[\x00-\x1F\x7F]/g, "")
    .trim();

  // 2. Extract final segment (strip directory paths posix / win32)
  const segments = clean.split(/[/\\]+/);
  clean = segments[segments.length - 1]?.trim() ?? "";

  // 3. Remove leading dots and path traversal patterns
  clean = clean.replace(/\.\.+/g, ".").replace(/^[.]+/, "");

  // 4. Remove quotes and backslashes to protect HTTP headers
  clean = clean.replace(/["\\]/g, "");

  // 5. Replace sequences of spaces or unsafe characters with hyphens
  clean = clean.replace(/\s+/g, "-");

  // 6. Keep unicode letters/numbers, dot, hyphen, and underscore
  clean = clean.replace(/[^\p{L}\p{N}._-]/gu, "");

  // 7. Extract base name and extension
  const extMatch = /\.([a-zA-Z0-9]+)$/.exec(clean);
  let base = clean;
  let ext = ".pdf";
  if (extMatch) {
    ext = `.${extMatch[1].toLowerCase()}`;
    base = clean.slice(0, -extMatch[0].length);
  }

  // Strip trailing/leading punctuation from base
  base = base.replace(/^[._-]+|[._-]+$/g, "");
  if (!base) {
    return fallback;
  }

  // Limit base length to 80 chars
  if (base.length > 80) {
    base = base.slice(0, 80).replace(/[._-]+$/, "");
  }

  // Ensure ext is .pdf for documents
  if (ext !== ".pdf") {
    ext = ".pdf";
  }

  return `${base}${ext}`;
}

/**
 * Generates an RFC 6266 and RFC 5987 compliant Content-Disposition header.
 * Provides an ASCII fallback for legacy clients and filename* with UTF-8 encoding.
 */
export function buildContentDispositionHeader(fileName: string): string {
  const safeName = sanitizeDownloadFileName(fileName);
  // ASCII fallback: replace non-ASCII characters with underscore and strip quotes
  const asciiFallback = safeName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "");
  // RFC 5987 percent-encoded UTF-8
  const utf8Encoded = encodeURIComponent(safeName);

  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${utf8Encoded}`;
}

/**
 * Builds the full HTTPS URL for secure document delivery with the token in a path
 * segment and the sanitized document filename as the final segment ending in `.pdf`.
 *
 * Example: https://medcare.sitecraf.com/api/media/[id]/document/[token]/Document-Test.pdf
 */
export function buildDocumentContentUrl(params: {
  mediaId: string;
  tenantId: string;
  clinicId: string;
  originalFileName: string;
  purpose: MediaTokenPurpose;
  ttlSeconds?: number;
}): string {
  const token = generateMediaToken({
    mediaId: params.mediaId,
    tenantId: params.tenantId,
    clinicId: params.clinicId,
    purpose: params.purpose,
    ttlSeconds: params.ttlSeconds,
  });
  const origin = getCanonicalPublicOrigin();
  const safeFileName = sanitizeDownloadFileName(params.originalFileName, "document.pdf");
  return `${origin}/api/media/${params.mediaId}/document/${token}/${encodeURIComponent(safeFileName)}`;
}

