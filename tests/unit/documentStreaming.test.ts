import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateMediaToken } from "@/lib/mediaSecurity";
import { GET, HEAD } from "@/app/api/media/[id]/document/[token]/[filename]/route";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    mediaAsset: {
      findFirst: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";

describe("GET & HEAD /api/media/[id]/document/[token]/[filename]", () => {
  const testDir = path.join(process.cwd(), ".private_document_test");
  const testFileRel = "tenant-1/clinic-1/2026/09/test-doc.pdf";
  let testFileAbs: string;
  const fileContent = Buffer.from("%PDF-1.4 Mock PDF content for unit testing 1234567890");

  beforeEach(async () => {
    process.env.MEDIA_STORAGE_ROOT = testDir;
    testFileAbs = path.join(testDir, testFileRel);
    await fs.promises.mkdir(path.dirname(testFileAbs), { recursive: true });
    await fs.promises.writeFile(testFileAbs, fileContent);
  });

  afterEach(async () => {
    await fs.promises.rm(testDir, { recursive: true, force: true }).catch(() => {});
    delete process.env.MEDIA_STORAGE_ROOT;
    vi.clearAllMocks();
  });

  it("rejects request without token with 401", async () => {
    const req = new Request("http://localhost:3000/api/media/media-doc-1/document//doc.pdf");
    const res = await GET(req, {
      params: Promise.resolve({
        id: "media-doc-1",
        token: "",
        filename: "doc.pdf",
      }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects request with invalid token with 403", async () => {
    const req = new Request(
      "http://localhost:3000/api/media/media-doc-1/document/invalid.token/doc.pdf",
    );
    const res = await GET(req, {
      params: Promise.resolve({
        id: "media-doc-1",
        token: "invalid.token",
        filename: "doc.pdf",
      }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects request when token mediaId does not match URL id", async () => {
    const token = generateMediaToken({
      mediaId: "media-A",
      tenantId: "tenant-1",
      clinicId: "clinic-1",
      purpose: "whatsapp",
    });

    const req = new Request(
      `http://localhost:3000/api/media/media-B/document/${token}/doc.pdf`,
    );
    const res = await GET(req, {
      params: Promise.resolve({
        id: "media-B",
        token,
        filename: "doc.pdf",
      }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 404 when media record is not found in database", async () => {
    const token = generateMediaToken({
      mediaId: "media-doc-1",
      tenantId: "tenant-1",
      clinicId: "clinic-1",
      purpose: "whatsapp",
    });

    vi.mocked(prisma.mediaAsset.findFirst).mockResolvedValueOnce(null);

    const req = new Request(
      `http://localhost:3000/api/media/media-doc-1/document/${token}/doc.pdf`,
    );
    const res = await GET(req, {
      params: Promise.resolve({
        id: "media-doc-1",
        token,
        filename: "doc.pdf",
      }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 when mediaAsset is not a DOCUMENT or not application/pdf", async () => {
    const token = generateMediaToken({
      mediaId: "media-doc-1",
      tenantId: "tenant-1",
      clinicId: "clinic-1",
      purpose: "whatsapp",
    });

    vi.mocked(prisma.mediaAsset.findFirst).mockResolvedValueOnce({
      id: "media-doc-1",
      storagePath: testFileRel,
      mimeType: "image/jpeg",
      mediaType: "IMAGE",
      fileSize: fileContent.length,
      originalFileName: "image.jpg",
    } as never);

    const req = new Request(
      `http://localhost:3000/api/media/media-doc-1/document/${token}/doc.pdf`,
    );
    const res = await GET(req, {
      params: Promise.resolve({
        id: "media-doc-1",
        token,
        filename: "doc.pdf",
      }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 when physical file does not exist on disk", async () => {
    const token = generateMediaToken({
      mediaId: "media-doc-1",
      tenantId: "tenant-1",
      clinicId: "clinic-1",
      purpose: "whatsapp",
    });

    vi.mocked(prisma.mediaAsset.findFirst).mockResolvedValueOnce({
      id: "media-doc-1",
      storagePath: "tenant-1/clinic-1/2026/09/nonexistent.pdf",
      mimeType: "application/pdf",
      mediaType: "DOCUMENT",
      fileSize: fileContent.length,
      originalFileName: "test.pdf",
    } as never);

    const req = new Request(
      `http://localhost:3000/api/media/media-doc-1/document/${token}/test.pdf`,
    );
    const res = await GET(req, {
      params: Promise.resolve({
        id: "media-doc-1",
        token,
        filename: "test.pdf",
      }),
    });
    expect(res.status).toBe(404);
  });

  it("GET request returns 200 with PDF content, Content-Type, and Content-Disposition", async () => {
    const token = generateMediaToken({
      mediaId: "media-doc-1",
      tenantId: "tenant-1",
      clinicId: "clinic-1",
      purpose: "whatsapp",
    });

    vi.mocked(prisma.mediaAsset.findFirst).mockResolvedValueOnce({
      id: "media-doc-1",
      storagePath: testFileRel,
      mimeType: "application/pdf",
      mediaType: "DOCUMENT",
      fileSize: fileContent.length,
      originalFileName: "Document Test.pdf",
    } as never);

    const req = new Request(
      `http://localhost:3000/api/media/media-doc-1/document/${token}/Document-Test.pdf`,
    );
    const res = await GET(req, {
      params: Promise.resolve({
        id: "media-doc-1",
        token,
        filename: "Document-Test.pdf",
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="Document-Test.pdf"; filename*=UTF-8\'\'Document-Test.pdf',
    );
    expect(res.headers.get("Content-Length")).toBe(String(fileContent.length));
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");

    const receivedBuffer = Buffer.from(await res.arrayBuffer());
    expect(receivedBuffer.equals(fileContent)).toBe(true);
  });

  it("HEAD request returns 200 with identical metadata headers and empty body", async () => {
    const token = generateMediaToken({
      mediaId: "media-doc-1",
      tenantId: "tenant-1",
      clinicId: "clinic-1",
      purpose: "whatsapp",
    });

    vi.mocked(prisma.mediaAsset.findFirst).mockResolvedValueOnce({
      id: "media-doc-1",
      storagePath: testFileRel,
      mimeType: "application/pdf",
      mediaType: "DOCUMENT",
      fileSize: fileContent.length,
      originalFileName: "Document Test.pdf",
    } as never);

    const req = new Request(
      `http://localhost:3000/api/media/media-doc-1/document/${token}/Document-Test.pdf`,
    );
    const res = await HEAD(req, {
      params: Promise.resolve({
        id: "media-doc-1",
        token,
        filename: "Document-Test.pdf",
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain('filename="Document-Test.pdf"');
    expect(res.headers.get("Content-Length")).toBe(String(fileContent.length));
    expect(await res.text()).toBe("");
  });

  it("Range request returns 206 Partial Content", async () => {
    const token = generateMediaToken({
      mediaId: "media-doc-1",
      tenantId: "tenant-1",
      clinicId: "clinic-1",
      purpose: "whatsapp",
    });

    vi.mocked(prisma.mediaAsset.findFirst).mockResolvedValueOnce({
      id: "media-doc-1",
      storagePath: testFileRel,
      mimeType: "application/pdf",
      mediaType: "DOCUMENT",
      fileSize: fileContent.length,
      originalFileName: "doc.pdf",
    } as never);

    const req = new Request(
      `http://localhost:3000/api/media/media-doc-1/document/${token}/doc.pdf`,
      { headers: { Range: "bytes=0-9" } },
    );
    const res = await GET(req, {
      params: Promise.resolve({
        id: "media-doc-1",
        token,
        filename: "doc.pdf",
      }),
    });

    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe(`bytes 0-9/${fileContent.length}`);
    expect(res.headers.get("Content-Length")).toBe("10");
    const receivedBuffer = Buffer.from(await res.arrayBuffer());
    expect(receivedBuffer.equals(fileContent.subarray(0, 10))).toBe(true);
  });
});
