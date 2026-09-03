import { describe, expect, it } from "vitest";
import {
  detectMagicBytes,
  validateMediaUpload,
  MediaValidationError,
} from "@/lib/mediaValidation";

describe("detectMagicBytes", () => {
  it("detects valid JPEG", () => {
    const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    const detected = detectMagicBytes(jpegBuffer);
    expect(detected).toEqual({ mimeType: "image/jpeg", extension: ".jpg" });
  });

  it("detects valid PNG", () => {
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const detected = detectMagicBytes(pngBuffer);
    expect(detected).toEqual({ mimeType: "image/png", extension: ".png" });
  });

  it("detects valid WebP", () => {
    const webpBuffer = Buffer.concat([
      Buffer.from("RIFF"),
      Buffer.alloc(4),
      Buffer.from("WEBP"),
      Buffer.alloc(10),
    ]);
    const detected = detectMagicBytes(webpBuffer);
    expect(detected).toEqual({ mimeType: "image/webp", extension: ".webp" });
  });

  it("detects valid PDF", () => {
    const pdfBuffer = Buffer.from("%PDF-1.7\nSample document");
    const detected = detectMagicBytes(pdfBuffer);
    expect(detected).toEqual({ mimeType: "application/pdf", extension: ".pdf" });
  });

  it("detects valid MP4", () => {
    const mp4Buffer = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x18]),
      Buffer.from("ftypisom"),
      Buffer.alloc(10),
    ]);
    const detected = detectMagicBytes(mp4Buffer);
    expect(detected).toEqual({ mimeType: "video/mp4", extension: ".mp4" });
  });

  it("rejects Windows PE executable (MZ)", () => {
    const exeBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    expect(detectMagicBytes(exeBuffer)).toBeNull();
  });

  it("rejects Linux ELF executable", () => {
    const elfBuffer = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
    expect(detectMagicBytes(elfBuffer)).toBeNull();
  });

  it("rejects ZIP archive (PK..)", () => {
    const zipBuffer = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
    expect(detectMagicBytes(zipBuffer)).toBeNull();
  });

  it("rejects SVG XML", () => {
    const svgBuffer = Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\"><circle/></svg>");
    expect(detectMagicBytes(svgBuffer)).toBeNull();
  });

  it("rejects HTML document", () => {
    const htmlBuffer = Buffer.from("<!DOCTYPE html><html><body>Dangerous</body></html>");
    expect(detectMagicBytes(htmlBuffer)).toBeNull();
  });

  it("rejects shell script with shebang", () => {
    const shBuffer = Buffer.from("#!/bin/bash\necho hello");
    expect(detectMagicBytes(shBuffer)).toBeNull();
  });
});

describe("validateMediaUpload", () => {
  const validJpegHead = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

  it("succeeds for valid JPEG within size limit", () => {
    const result = validateMediaUpload({
      fileName: "prescription.jpg",
      bufferHead: validJpegHead,
      fileSizeBytes: 500_000,
    });
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.mediaType).toBe("IMAGE");
    expect(result.extension).toBe(".jpg");
    expect(result.originalFileName).toBe("prescription.jpg");
  });

  it("fails when an executable is renamed to .jpg", () => {
    const fakeJpeg = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00]);
    expect(() =>
      validateMediaUpload({
        fileName: "malware.jpg",
        bufferHead: fakeJpeg,
        fileSizeBytes: 500_000,
      }),
    ).toThrow(MediaValidationError);
  });

  it("fails when SVG is renamed to .png", () => {
    const fakePng = Buffer.from("<svg width=\"100\" height=\"100\"></svg>");
    expect(() =>
      validateMediaUpload({
        fileName: "logo.png",
        bufferHead: fakePng,
        fileSizeBytes: 5_000,
      }),
    ).toThrow(MediaValidationError);
  });

  it("fails when file extension does not match real content (e.g. PDF renamed to .jpg)", () => {
    const realPdf = Buffer.from("%PDF-1.4\nTest");
    expect(() =>
      validateMediaUpload({
        fileName: "document.jpg",
        bufferHead: realPdf,
        fileSizeBytes: 50_000,
      }),
    ).toThrow(/extension.*does not match/);
  });

  it("fails when file exceeds size limit", () => {
    // 15 MB image exceeds 10 MB default limit
    expect(() =>
      validateMediaUpload({
        fileName: "huge.jpg",
        bufferHead: validJpegHead,
        fileSizeBytes: 15 * 1024 * 1024,
      }),
    ).toThrow(/exceeds the maximum allowed limit/);
  });

  it("sanitizes path traversal in originalFileName", () => {
    const result = validateMediaUpload({
      fileName: "../../etc/passwd.jpg",
      bufferHead: validJpegHead,
      fileSizeBytes: 200_000,
    });
    expect(result.originalFileName).toBe("passwd.jpg");
  });

  it("preserves unicode characters in filename", () => {
    const result = validateMediaUpload({
      fileName: "आफ्टरकेयर पर्ची - 2026.jpg",
      bufferHead: validJpegHead,
      fileSizeBytes: 200_000,
    });
    expect(result.originalFileName).toBe("आफ्टरकेयर पर्ची - 2026.jpg");
  });
});
