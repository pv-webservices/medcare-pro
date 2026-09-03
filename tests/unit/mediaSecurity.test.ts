import { describe, expect, it } from "vitest";
import {
  generateMediaToken,
  verifyMediaToken,
  buildMediaContentUrl,
  InvalidTokenError,
} from "@/lib/mediaSecurity";

describe("mediaSecurity tokens", () => {
  const baseParams = {
    mediaId: "media-asset-123",
    tenantId: "tenant-alpha",
    clinicId: "clinic-main",
    purpose: "preview" as const,
  };

  it("generates a valid token that verifies correctly", () => {
    const token = generateMediaToken(baseParams);
    const payload = verifyMediaToken(token);

    expect(payload.v).toBe(1);
    expect(payload.mediaId).toBe("media-asset-123");
    expect(payload.tenantId).toBe("tenant-alpha");
    expect(payload.clinicId).toBe("clinic-main");
    expect(payload.purpose).toBe("preview");
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("rejects an expired token", () => {
    const expiredToken = generateMediaToken({
      ...baseParams,
      ttlSeconds: -10, // already in the past
    });

    expect(() => verifyMediaToken(expiredToken)).toThrow(InvalidTokenError);
  });

  it("rejects a modified token signature", () => {
    const token = generateMediaToken(baseParams);
    const [payload, sig] = token.split(".");
    // Tamper with signature
    const tamperedToken = `${payload}.${sig.slice(0, -2)}xx`;

    expect(() => verifyMediaToken(tamperedToken)).toThrow(InvalidTokenError);
  });

  it("rejects a modified payload", () => {
    const token = generateMediaToken(baseParams);
    const [, sig] = token.split(".");
    const fakePayload = Buffer.from(
      JSON.stringify({
        v: 1,
        mediaId: "hacked-id",
        tenantId: "tenant-alpha",
        clinicId: "clinic-main",
        purpose: "preview",
        exp: Math.floor(Date.now() / 1000) + 1000,
      }),
    )
      .toString("base64")
      .replace(/=/g, "");

    const forgedToken = `${fakePayload}.${sig}`;
    expect(() => verifyMediaToken(forgedToken)).toThrow(InvalidTokenError);
  });

  it("produces different TTLs for preview and whatsapp purposes", () => {
    const previewToken = generateMediaToken({
      ...baseParams,
      purpose: "preview",
    });
    const whatsappToken = generateMediaToken({
      ...baseParams,
      purpose: "whatsapp",
    });

    const previewPayload = verifyMediaToken(previewToken);
    const whatsappPayload = verifyMediaToken(whatsappToken);

    // WhatsApp TTL (1 hour default) is significantly longer than preview (5 min default)
    expect(whatsappPayload.exp - previewPayload.exp).toBeGreaterThanOrEqual(3000);
  });

  it("builds canonical HTTPS url with token query parameter", () => {
    const url = buildMediaContentUrl({
      ...baseParams,
      purpose: "whatsapp",
    });

    expect(url).toContain("/api/media/media-asset-123/content?token=");
    const parsed = new URL(url);
    const tokenParam = parsed.searchParams.get("token");
    expect(tokenParam).toBeTruthy();

    const payload = verifyMediaToken(tokenParam!);
    expect(payload.mediaId).toBe("media-asset-123");
    expect(payload.purpose).toBe("whatsapp");
  });

  it("rejects token with unsupported purpose", () => {
    const fakeToken = generateMediaToken({
      ...baseParams,
      purpose: "preview",
    });
    const [, sig] = fakeToken.split(".");
    const forged = Buffer.from(
      JSON.stringify({
        v: 1,
        mediaId: "media-asset-123",
        tenantId: "tenant-alpha",
        clinicId: "clinic-main",
        purpose: "unsupported-hack",
        exp: Math.floor(Date.now() / 1000) + 600,
      }),
    )
      .toString("base64")
      .replace(/=/g, "");
    expect(() => verifyMediaToken(`${forged}.${sig}`)).toThrow(InvalidTokenError);
  });

  it("throws MediaConfigurationError in production when MEDIA_ACCESS_SECRET is missing", () => {
    const env = process.env as Record<string, string | undefined>;
    const origEnv = env.NODE_ENV;
    const origSecret = env.MEDIA_ACCESS_SECRET;
    try {
      env.NODE_ENV = "production";
      delete env.MEDIA_ACCESS_SECRET;
      expect(() => generateMediaToken(baseParams)).toThrow("MEDIA_ACCESS_SECRET is required in production");
    } finally {
      env.NODE_ENV = origEnv;
      if (origSecret !== undefined) env.MEDIA_ACCESS_SECRET = origSecret;
    }
  });

  it("throws MediaConfigurationError in production when NEXTAUTH_URL is invalid", () => {
    const env = process.env as Record<string, string | undefined>;
    const origEnv = env.NODE_ENV;
    const origUrl = env.NEXTAUTH_URL;
    const origSecret = env.MEDIA_ACCESS_SECRET;
    try {
      env.NODE_ENV = "production";
      env.MEDIA_ACCESS_SECRET = "production-test-secret-with-sufficient-entropy-123456789";
      env.NEXTAUTH_URL = "not-a-valid-url";
      expect(() => buildMediaContentUrl(baseParams)).toThrow("NEXTAUTH_URL is not a valid HTTP/HTTPS URL.");
    } finally {
      env.NODE_ENV = origEnv;
      if (origUrl !== undefined) env.NEXTAUTH_URL = origUrl;
      else delete env.NEXTAUTH_URL;
      if (origSecret !== undefined) env.MEDIA_ACCESS_SECRET = origSecret;
      else delete env.MEDIA_ACCESS_SECRET;
    }
  });
});

