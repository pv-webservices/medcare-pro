import crypto from "node:crypto";
import type { MediaAccessTokenPayload, MediaTokenPurpose } from "@/lib/mediaTypes";

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
    throw new Error(
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

  return payload;
}

/**
 * Derives the canonical public base origin for external links.
 */
export function getCanonicalPublicOrigin(): string {
  const origin = (process.env.NEXTAUTH_URL ?? "").trim().replace(/\/+$/, "");
  if (origin !== "") {
    return origin;
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
