import { describe, expect, it } from "vitest";
import {
  generateMediaToken,
  verifyMediaToken,
  buildMediaContentUrl,
  buildDocumentContentUrl,
  sanitizeDownloadFileName,
  buildContentDispositionHeader,
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

  describe("sanitizeDownloadFileName", () => {
    it("preserves safe filename and replaces spaces with hyphens", () => {
      expect(sanitizeDownloadFileName("Document Test.pdf")).toBe("Document-Test.pdf");
      expect(sanitizeDownloadFileName("Blood Report 2026.pdf")).toBe("Blood-Report-2026.pdf");
    });

    it("prevents directory traversal attacks", () => {
      expect(sanitizeDownloadFileName("../../secret.pdf")).toBe("secret.pdf");
      expect(sanitizeDownloadFileName("..\\..\\secret.pdf")).toBe("secret.pdf");
      expect(sanitizeDownloadFileName("/var/log/secret.pdf")).toBe("secret.pdf");
    });

    it("prevents header injection via CR/LF and control characters", () => {
      const injected = "foo\r\nX-Test: injected\nbar.pdf";
      const sanitized = sanitizeDownloadFileName(injected);
      expect(sanitized).not.toContain("\r");
      expect(sanitized).not.toContain("\n");
      expect(sanitized).toBe("fooX-Test-injectedbar.pdf");
    });

    it("handles unicode and preserves accented characters", () => {
      expect(sanitizeDownloadFileName("Patient Résumé.pdf")).toBe("Patient-Résumé.pdf");
    });

    it("strips double quotes and backslashes", () => {
      expect(sanitizeDownloadFileName('"quoted".pdf')).toBe("quoted.pdf");
      expect(sanitizeDownloadFileName('a\\b\\"c.pdf')).toBe("c.pdf");
    });

    it("truncates excessively long base names while preserving .pdf", () => {
      const longName = "a".repeat(120) + ".pdf";
      const sanitized = sanitizeDownloadFileName(longName);
      expect(sanitized.endsWith(".pdf")).toBe(true);
      expect(sanitized.length).toBeLessThanOrEqual(84); // 80 base + .pdf
    });

    it("falls back cleanly on empty or invalid inputs", () => {
      expect(sanitizeDownloadFileName("")).toBe("document.pdf");
      expect(sanitizeDownloadFileName(null)).toBe("document.pdf");
      expect(sanitizeDownloadFileName("   ")).toBe("document.pdf");
      expect(sanitizeDownloadFileName("...")).toBe("document.pdf");
    });

    it("ensures extension is .pdf", () => {
      expect(sanitizeDownloadFileName("notes.txt")).toBe("notes.pdf");
      expect(sanitizeDownloadFileName("noextension")).toBe("noextension.pdf");
    });
  });

  describe("buildContentDispositionHeader", () => {
    it("builds standard RFC 6266 and RFC 5987 header", () => {
      const header = buildContentDispositionHeader("Document Test.pdf");
      expect(header).toBe(
        'attachment; filename="Document-Test.pdf"; filename*=UTF-8\'\'Document-Test.pdf',
      );
    });

    it("provides ASCII fallback and encoded filename* for unicode names", () => {
      const header = buildContentDispositionHeader("Patient Résumé.pdf");
      expect(header).toContain('attachment; filename="Patient-R_sum_.pdf"');
      expect(header).toContain("filename*=UTF-8''Patient-R%C3%A9sum%C3%A9.pdf");
    });
  });

  describe("buildDocumentContentUrl", () => {
    it("builds full HTTPS URL ending in safe .pdf filename without query token", () => {
      const url = buildDocumentContentUrl({
        mediaId: "asset-doc-1",
        tenantId: "tenant-1",
        clinicId: "clinic-A",
        originalFileName: "Lab Results Test.pdf",
        purpose: "whatsapp",
      });

      expect(url).toMatch(
        /^http:\/\/localhost:3000\/api\/media\/asset-doc-1\/document\/[^/]+\/Lab-Results-Test\.pdf$/,
      );
      expect(url).not.toContain("?token=");

      // Verify the token extracted from the path segment
      const parts = url.split("/");
      const token = parts[parts.length - 2];
      const payload = verifyMediaToken(token);
      expect(payload.mediaId).toBe("asset-doc-1");
      expect(payload.tenantId).toBe("tenant-1");
      expect(payload.clinicId).toBe("clinic-A");
      expect(payload.purpose).toBe("whatsapp");
    });
  });
});

