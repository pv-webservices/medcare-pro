import { beforeEach, describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import { PermissionError, ScopeError } from "@/lib/rbac";

vi.mock("@/lib/session", () => ({
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    clinic: {
      findFirst: vi.fn(),
    },
    userRole: {
      findMany: vi.fn(),
    },
    mediaAsset: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    whatsappTemplateMedia: {
      count: vi.fn(),
    },
  },
}));

vi.mock("@/lib/mediaStorage", () => ({
  writeUploadToTemp: vi.fn(),
  moveTempToFinal: vi.fn(),
  deletePhysicalFile: vi.fn(),
  buildRelativeStoragePath: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import {
  saveUploadedMediaAsset,
  listMediaForActor,
  getMediaForActor,
  deleteMediaForActor,
} from "@/lib/mediaAssets";

describe("Media RBAC and Multi-tenancy Scoping", () => {
  const actor = { userId: "user-1", tenantId: "tenant-alpha" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects upload when actor clinic check fails (cross-tenant clinic)", async () => {
    // Clinic not found under tenant-alpha
    vi.mocked(prisma.clinic.findFirst).mockResolvedValueOnce(null);

    await expect(
      saveUploadedMediaAsset(actor, {
        clinicId: "clinic-belonging-to-tenant-beta",
        fileName: "image.jpg",
        stream: Readable.from([Buffer.from("dummy")]),
      }),
    ).rejects.toThrow(ScopeError);
  });

  it("rejects upload when actor lacks message:template permission", async () => {
    // Clinic belongs to tenant
    vi.mocked(prisma.clinic.findFirst).mockResolvedValueOnce({
      id: "clinic-1",
    } as any);
    // User roles return only message:send, not message:template
    vi.mocked(prisma.userRole.findMany).mockResolvedValueOnce([
      {
        role: { permissions: ["message:send"] },
      },
    ] as any);

    await expect(
      saveUploadedMediaAsset(actor, {
        clinicId: "clinic-1",
        fileName: "image.jpg",
        stream: Readable.from([Buffer.from("dummy")]),
      }),
    ).rejects.toThrow(PermissionError);
  });

  it("rejects listing media if user has no messaging access in clinic", async () => {
    vi.mocked(prisma.clinic.findFirst).mockResolvedValueOnce({
      id: "clinic-1",
    } as any);
    // Neither message:template nor message:send
    vi.mocked(prisma.userRole.findMany).mockResolvedValue([
      {
        role: { permissions: ["patients:view"] },
      },
    ] as any);

    await expect(listMediaForActor(actor, "clinic-1")).rejects.toThrow(ScopeError);
  });

  it("rejects fetching media metadata if mediaId belongs to another tenant", async () => {
    // findFirst checks { id: mediaId, tenantId: actor.tenantId } -> returns null
    vi.mocked(prisma.mediaAsset.findFirst).mockResolvedValueOnce(null);

    await expect(
      getMediaForActor(actor, "foreign-tenant-media-id"),
    ).rejects.toThrow(ScopeError);
  });

  it("rejects deleting media if actor lacks message:template permission", async () => {
    vi.mocked(prisma.mediaAsset.findFirst).mockResolvedValueOnce({
      id: "asset-1",
      clinicId: "clinic-1",
      storagePath: "path/to/file.jpg",
    } as any);

    // Assert clinic belongs to tenant
    vi.mocked(prisma.clinic.findFirst).mockResolvedValueOnce({
      id: "clinic-1",
    } as any);

    // User only has message:send
    vi.mocked(prisma.userRole.findMany).mockResolvedValueOnce([
      {
        role: { permissions: ["message:send"] },
      },
    ] as any);

    await expect(deleteMediaForActor(actor, "asset-1")).rejects.toThrow(
      PermissionError,
    );
  });
});
