import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError } from "@/lib/apiHandler";
import { ScopeError } from "@/lib/rbac";

vi.mock("@/lib/session", () => ({
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    whatsappTemplate: {
      findFirst: vi.fn(),
    },
    mediaAsset: {
      findFirst: vi.fn(),
      count: vi.fn(),
      delete: vi.fn(),
    },
    whatsappTemplateMedia: {
      upsert: vi.fn(),
      deleteMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock("@/lib/rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rbac")>();
  return {
    ...actual,
    requirePermission: vi.fn().mockResolvedValue(undefined),
    assertClinicInTenant: vi.fn().mockResolvedValue(undefined),
    can: vi.fn().mockResolvedValue(true),
  };
});

import { prisma } from "@/lib/prisma";
import {
  bindTemplateMedia,
  removeTemplateMedia,
} from "@/lib/whatsappTemplateMedia";
import { deleteMediaForActor, generateMediaPreviewUrlForActor } from "@/lib/mediaAssets";

describe("whatsappTemplateMedia binding", () => {
  const actor = { userId: "user-1", tenantId: "tenant-1" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("binds media asset to template for a specific clinic", async () => {
    vi.mocked(prisma.whatsappTemplate.findFirst).mockResolvedValueOnce({
      id: "tmpl-1",
    } as never);

    vi.mocked(prisma.mediaAsset.findFirst).mockResolvedValueOnce({
      id: "asset-1",
      clinicId: "clinic-A",
      originalFileName: "alpha-reminder.jpg",
      mimeType: "image/jpeg",
      mediaType: "IMAGE",
      fileSize: 1000,
      createdAt: new Date(),
      lastUsedAt: null,
    } as never);

    vi.mocked(prisma.whatsappTemplateMedia.upsert).mockResolvedValueOnce({
      id: "binding-1",
      templateId: "tmpl-1",
      clinicId: "clinic-A",
      mediaAsset: {
        id: "asset-1",
        clinicId: "clinic-A",
        originalFileName: "alpha-reminder.jpg",
        mimeType: "image/jpeg",
        mediaType: "IMAGE",
        fileSize: 1000,
        createdAt: new Date(),
        lastUsedAt: null,
      },
    } as never);

    const result = await bindTemplateMedia(actor, {
      templateId: "tmpl-1",
      clinicId: "clinic-A",
      mediaAssetId: "asset-1",
    });

    expect(result.templateId).toBe("tmpl-1");
    expect(result.clinicId).toBe("clinic-A");
    expect(result.mediaAsset.id).toBe("asset-1");
    expect(prisma.whatsappTemplateMedia.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          templateId_clinicId: { templateId: "tmpl-1", clinicId: "clinic-A" },
        },
      }),
    );
  });

  it("rejects binding if media asset belongs to a different clinic", async () => {
    vi.mocked(prisma.whatsappTemplate.findFirst).mockResolvedValueOnce({
      id: "tmpl-1",
    } as never);

    // Media asset query checks clinicId: input.clinicId -> returns null if mismatch
    vi.mocked(prisma.mediaAsset.findFirst).mockResolvedValueOnce(null);

    await expect(
      bindTemplateMedia(actor, {
        templateId: "tmpl-1",
        clinicId: "clinic-A",
        mediaAssetId: "asset-from-clinic-B",
      }),
    ).rejects.toThrow(ScopeError);
  });

  it("removes media attachment from template while leaving media asset untouched", async () => {
    vi.mocked(prisma.whatsappTemplate.findFirst).mockResolvedValueOnce({
      id: "tmpl-1",
    } as never);

    vi.mocked(prisma.whatsappTemplateMedia.deleteMany).mockResolvedValueOnce({
      count: 1,
    } as never);

    const result = await removeTemplateMedia(actor, {
      templateId: "tmpl-1",
      clinicId: "clinic-A",
    });

    expect(result.removed).toBe(true);
    expect(prisma.whatsappTemplateMedia.deleteMany).toHaveBeenCalledWith({
      where: {
        templateId: "tmpl-1",
        clinicId: "clinic-A",
        tenantId: "tenant-1",
      },
    });
    // mediaAsset.delete should NOT be called
    expect(prisma.mediaAsset.delete).not.toHaveBeenCalled();
  });

  it("blocks deletion of a media asset when referenced by an active template", async () => {
    vi.mocked(prisma.mediaAsset.findFirst).mockResolvedValueOnce({
      id: "asset-1",
      clinicId: "clinic-A",
      storagePath: "tenant-1/clinic-A/2026/09/file.jpg",
    } as never);

    // Active template binding exists
    vi.mocked(prisma.whatsappTemplateMedia.count).mockResolvedValueOnce(1);

    await expect(deleteMediaForActor(actor, "asset-1")).rejects.toThrow(ConflictError);
    expect(prisma.mediaAsset.delete).not.toHaveBeenCalled();
  });

  it("generates preview url with matching configurable TTL", async () => {
    const origTtl = process.env.MEDIA_PREVIEW_URL_TTL_SECONDS;
    try {
      process.env.MEDIA_PREVIEW_URL_TTL_SECONDS = "600";
      vi.mocked(prisma.mediaAsset.findFirst).mockResolvedValueOnce({
        id: "asset-preview-1",
        clinicId: "clinic-A",
        originalFileName: "doc.pdf",
        mimeType: "application/pdf",
        mediaType: "DOCUMENT",
        fileSize: 2048,
        createdAt: new Date(),
        lastUsedAt: null,
      } as never);

      const result = await generateMediaPreviewUrlForActor(actor, "asset-preview-1");
      expect(result.ttlSeconds).toBe(600);
      expect(result.url).toContain("/api/media/asset-preview-1/content?token=");
    } finally {
      if (origTtl !== undefined) process.env.MEDIA_PREVIEW_URL_TTL_SECONDS = origTtl;
      else delete process.env.MEDIA_PREVIEW_URL_TTL_SECONDS;
    }
  });

  it("denies preview URL generation when asset does not exist or is out of scope", async () => {
    vi.mocked(prisma.mediaAsset.findFirst).mockResolvedValueOnce(null);
    await expect(generateMediaPreviewUrlForActor(actor, "unknown-asset")).rejects.toThrow(ScopeError);
  });
});
