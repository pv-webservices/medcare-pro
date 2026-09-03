import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getMediaStorageRoot,
  resolveSafeStoragePath,
  buildRelativeStoragePath,
  StorageError,
} from "@/lib/mediaStorage";
import { generateMediaToken } from "@/lib/mediaSecurity";
import { GET, HEAD } from "@/app/api/media/[id]/content/route";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    mediaAsset: {
      findFirst: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";

describe("mediaStorage path safety", () => {
  it("resolves valid relative paths inside root", () => {
    const root = getMediaStorageRoot();
    const safePath = resolveSafeStoragePath("tenant-1/clinic-1/2026/09/file.jpg");
    expect(safePath.startsWith(root)).toBe(true);
  });

  it("prevents path traversal using ..", () => {
    expect(() =>
      resolveSafeStoragePath("../../../etc/passwd"),
    ).toThrow(StorageError);
  });

  it("prevents absolute paths", () => {
    expect(() =>
      resolveSafeStoragePath(path.resolve("/etc/shadow")),
    ).toThrow(StorageError);
  });

  it("buildRelativeStoragePath strips dangerous characters from tenant and clinic IDs", () => {
    const rel = buildRelativeStoragePath({
      tenantId: "../evil/tenant",
      clinicId: "../../evil/clinic",
      storedFileName: "file.jpg",
      date: new Date("2026-09-03T12:00:00Z"),
    });

    expect(rel).not.toContain("..");
    expect(rel).toContain("2026/09/file.jpg");
  });
});

describe("GET & HEAD /api/media/[id]/content", () => {
  const testDir = path.join(process.cwd(), ".private_media_test");
  const testFileRel = "tenant-1/clinic-1/2026/09/test-image.jpg";
  let testFileAbs: string;
  const fileContent = Buffer.from("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ");

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
    const req = new Request("http://localhost:3000/api/media/media-1/content");
    const res = await GET(req, { params: Promise.resolve({ id: "media-1" }) });
    expect(res.status).toBe(401);
  });

  it("rejects request with invalid token with 403", async () => {
    const req = new Request("http://localhost:3000/api/media/media-1/content?token=invalid.token");
    const res = await GET(req, { params: Promise.resolve({ id: "media-1" }) });
    expect(res.status).toBe(403);
  });

  it("rejects request when token mediaId does not match URL id", async () => {
    const token = generateMediaToken({
      mediaId: "media-A",
      tenantId: "tenant-1",
      clinicId: "clinic-1",
      purpose: "whatsapp",
    });

    const req = new Request(`http://localhost:3000/api/media/media-B/content?token=${token}`);
    const res = await GET(req, { params: Promise.resolve({ id: "media-B" }) });
    expect(res.status).toBe(403);
  });

  it("returns 404 when media record is not found in database", async () => {
    const token = generateMediaToken({
      mediaId: "media-1",
      tenantId: "tenant-1",
      clinicId: "clinic-1",
      purpose: "whatsapp",
    });

    vi.mocked(prisma.mediaAsset.findFirst).mockResolvedValueOnce(null);

    const req = new Request(`http://localhost:3000/api/media/media-1/content?token=${token}`);
    const res = await GET(req, { params: Promise.resolve({ id: "media-1" }) });
    expect(res.status).toBe(404);
  });

  it("HEAD request returns 200 with headers and no body", async () => {
    const token = generateMediaToken({
      mediaId: "media-1",
      tenantId: "tenant-1",
      clinicId: "clinic-1",
      purpose: "whatsapp",
    });

    vi.mocked(prisma.mediaAsset.findFirst).mockResolvedValueOnce({
      id: "media-1",
      storagePath: testFileRel,
      mimeType: "image/jpeg",
      fileSize: fileContent.length,
    } as never);

    const req = new Request(`http://localhost:3000/api/media/media-1/content?token=${token}`);
    const res = await HEAD(req, { params: Promise.resolve({ id: "media-1" }) });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Content-Length")).toBe(String(fileContent.length));
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await res.text()).toBe("");
  });

  it("GET request returns 200 with full file stream", async () => {
    const token = generateMediaToken({
      mediaId: "media-1",
      tenantId: "tenant-1",
      clinicId: "clinic-1",
      purpose: "whatsapp",
    });

    vi.mocked(prisma.mediaAsset.findFirst).mockResolvedValueOnce({
      id: "media-1",
      storagePath: testFileRel,
      mimeType: "image/jpeg",
      fileSize: fileContent.length,
    } as never);

    const req = new Request(`http://localhost:3000/api/media/media-1/content?token=${token}`);
    const res = await GET(req, { params: Promise.resolve({ id: "media-1" }) });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Length")).toBe(String(fileContent.length));
    const receivedBuffer = Buffer.from(await res.arrayBuffer());
    expect(receivedBuffer.equals(fileContent)).toBe(true);
  });

  it("Range request returns 206 Partial Content", async () => {
    const token = generateMediaToken({
      mediaId: "media-1",
      tenantId: "tenant-1",
      clinicId: "clinic-1",
      purpose: "whatsapp",
    });

    vi.mocked(prisma.mediaAsset.findFirst).mockResolvedValueOnce({
      id: "media-1",
      storagePath: testFileRel,
      mimeType: "video/mp4",
      fileSize: fileContent.length,
    } as never);

    const req = new Request(`http://localhost:3000/api/media/media-1/content?token=${token}`, {
      headers: { Range: "bytes=0-9" },
    });
    const res = await GET(req, { params: Promise.resolve({ id: "media-1" }) });

    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe(`bytes 0-9/${fileContent.length}`);
    expect(res.headers.get("Content-Length")).toBe("10");
    const receivedText = await res.text();
    expect(receivedText).toBe("0123456789");
  });

  it("Invalid Range request returns 416 Range Not Satisfiable", async () => {
    const token = generateMediaToken({
      mediaId: "media-1",
      tenantId: "tenant-1",
      clinicId: "clinic-1",
      purpose: "whatsapp",
    });

    vi.mocked(prisma.mediaAsset.findFirst).mockResolvedValueOnce({
      id: "media-1",
      storagePath: testFileRel,
      mimeType: "video/mp4",
      fileSize: fileContent.length,
    } as never);

    const req = new Request(`http://localhost:3000/api/media/media-1/content?token=${token}`, {
      headers: { Range: "bytes=999-1000" },
    });
    const res = await GET(req, { params: Promise.resolve({ id: "media-1" }) });

    expect(res.status).toBe(416);
    expect(res.headers.get("Content-Range")).toBe(`bytes */${fileContent.length}`);
  });
});
