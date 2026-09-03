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
});
