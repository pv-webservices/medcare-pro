import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    whatsappTemplateMedia: {
      findUnique: vi.fn(),
    },
    whatsappMessage: {
      create: vi.fn(),
    },
    mediaAsset: {
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock("@/lib/whatsapp", () => ({
  sendMedia: vi.fn(),
  sendText: vi.fn(),
  checkNumber: vi.fn().mockResolvedValue({ checked: true, exists: true }),
  readWhatsappConfig: vi.fn(),
  WhatsappNotConfiguredError: class WhatsappNotConfiguredError extends Error {},
  MEDIA_TYPES: ["image", "video", "audio", "document"],
}));

vi.mock("@/lib/whatsappProviderConfig", () => ({
  resolveWhatsappConfigForClinic: vi.fn().mockResolvedValue({
    apiKey: "test-key",
    sender: "919999999999",
    baseUrl: "https://example.test/api",
  }),
}));

import { prisma } from "@/lib/prisma";
import { sendMedia, sendText } from "@/lib/whatsapp";
import { deliverTemplate } from "@/lib/whatsappMessages";
import type { TemplateRecord } from "@/lib/whatsappTemplates";

describe("deliverTemplate with media", () => {
  const baseTemplate: TemplateRecord = {
    id: "tmpl-1",
    name: "Appointment Reminder",
    body: "Hi {patientName}, your appointment is on {appointmentDate}.",
    footer: "MedCare Pro",
    mediaType: null,
    mediaUrl: null,
    placeholders: ["patientName", "appointmentDate"],
  };

  const deliveryTarget = {
    patientId: "patient-1",
    tenantId: "tenant-1",
    clinicId: "clinic-A",
    mobileNumber: "+919876543210",
    values: {
      patientName: "John Doe",
      appointmentDate: "04 Sep 2026",
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXTAUTH_URL = "https://medcare.example.com";
  });

  it("sends clinic-specific media attachment via /send-media with signed URL", async () => {
    vi.mocked(prisma.whatsappTemplateMedia.findUnique).mockResolvedValueOnce({
      id: "binding-1",
      templateId: "tmpl-1",
      clinicId: "clinic-A",
      mediaAsset: {
        id: "asset-123",
        tenantId: "tenant-1",
        clinicId: "clinic-A",
        mediaType: "IMAGE",
        deletedAt: null,
      },
    } as never);

    vi.mocked(sendMedia).mockResolvedValueOnce({
      ok: true,
      providerMessageId: "MSG-123",
      message: "Message sent successfully!",
    });

    const result = await deliverTemplate(baseTemplate, deliveryTarget);

    expect(result.status).toBe("sent");
    expect(sendMedia).toHaveBeenCalledTimes(1);

    const callArgs = vi.mocked(sendMedia).mock.calls[0][0];
    expect(callArgs.to).toBe("919876543210");
    expect(callArgs.mediaType).toBe("image");
    expect(callArgs.mediaUrl).toContain("https://medcare.example.com/api/media/asset-123/content?token=");

    // Records mediaAssetId in message record
    expect(prisma.whatsappMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clinicId: "clinic-A",
        patientId: "patient-1",
        mediaAssetId: "asset-123",
        templateName: "Appointment Reminder",
        status: "sent",
        providerMessageId: "MSG-123",
      }),
    });

    // Updates lastUsedAt on the asset
    expect(prisma.mediaAsset.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "asset-123" },
      }),
    );
  });

  it("correctly maps VIDEO and DOCUMENT stored media types", async () => {
    // Test VIDEO
    vi.mocked(prisma.whatsappTemplateMedia.findUnique).mockResolvedValueOnce({
      id: "binding-2",
      templateId: "tmpl-1",
      clinicId: "clinic-A",
      mediaAsset: {
        id: "asset-video",
        tenantId: "tenant-1",
        clinicId: "clinic-A",
        mediaType: "VIDEO",
        deletedAt: null,
      },
    } as never);

    vi.mocked(sendMedia).mockResolvedValueOnce({ ok: true, providerMessageId: "MSG-VID", message: "Sent" });

    await deliverTemplate(baseTemplate, deliveryTarget);
    const videoCall = vi.mocked(sendMedia).mock.calls[0][0];
    expect(videoCall.mediaType).toBe("video");
    expect(videoCall.mediaUrl).toContain("/api/media/asset-video/content?token=");

    // Test DOCUMENT
    vi.mocked(prisma.whatsappTemplateMedia.findUnique).mockResolvedValueOnce({
      id: "binding-3",
      templateId: "tmpl-1",
      clinicId: "clinic-A",
      mediaAsset: {
        id: "asset-doc",
        tenantId: "tenant-1",
        clinicId: "clinic-A",
        mediaType: "DOCUMENT",
        originalFileName: "Doctor Prescription.pdf",
        deletedAt: null,
      },
    } as never);

    vi.mocked(sendMedia).mockResolvedValueOnce({ ok: true, providerMessageId: "MSG-DOC", message: "Sent" });

    await deliverTemplate(baseTemplate, deliveryTarget);
    const docCall = vi.mocked(sendMedia).mock.calls[1][0];
    expect(docCall.mediaType).toBe("document");
    expect(docCall.mediaUrl).toMatch(
      /\/api\/media\/asset-doc\/document\/[^/]+\/Doctor-Prescription\.pdf$/,
    );
    expect(docCall.mediaUrl).not.toContain("?token=");
  });

  it("falls back to legacy template mediaUrl when no clinic media is bound", async () => {
    // No clinic media attached
    vi.mocked(prisma.whatsappTemplateMedia.findUnique).mockResolvedValueOnce(null);

    const legacyTemplate: TemplateRecord = {
      ...baseTemplate,
      mediaType: "document",
      mediaUrl: "https://legacy.example.com/brochure.pdf",
    };

    vi.mocked(sendMedia).mockResolvedValueOnce({
      ok: true,
      providerMessageId: "MSG-LEGACY",
      message: "Sent",
    });

    const result = await deliverTemplate(legacyTemplate, deliveryTarget);

    expect(result.status).toBe("sent");
    expect(sendMedia).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendMedia).mock.calls[0][0].mediaUrl).toBe(
      "https://legacy.example.com/brochure.pdf",
    );
    expect(vi.mocked(sendMedia).mock.calls[0][0].mediaType).toBe("document");

    // Message row has null mediaAssetId
    expect(prisma.whatsappMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        mediaAssetId: null,
      }),
    });
  });

  it("falls back to sendText when neither clinic media nor legacy mediaUrl exists", async () => {
    vi.mocked(prisma.whatsappTemplateMedia.findUnique).mockResolvedValueOnce(null);

    vi.mocked(sendText).mockResolvedValueOnce({
      ok: true,
      providerMessageId: "MSG-TXT",
      message: "Sent",
    });

    const result = await deliverTemplate(baseTemplate, deliveryTarget);

    expect(result.status).toBe("sent");
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendMedia).not.toHaveBeenCalled();
    expect(prisma.whatsappMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        mediaAssetId: null,
      }),
    });
  });

  it("handles media preparation errors gracefully as failed recipient outcome rather than throwing", async () => {
    vi.mocked(prisma.whatsappTemplateMedia.findUnique).mockResolvedValueOnce({
      id: "binding-broken",
      templateId: "tmpl-1",
      clinicId: "clinic-A",
      mediaAsset: {
        id: "asset-broken",
        tenantId: "tenant-1",
        clinicId: "clinic-A",
        mediaType: "IMAGE",
        deletedAt: null,
      },
    } as never);

    // Simulate provider failure during sendMedia
    vi.mocked(sendMedia).mockResolvedValueOnce({
      ok: false,
      providerMessageId: null,
      message: "Gateway media download error: 404",
    });

    const result = await deliverTemplate(baseTemplate, deliveryTarget);

    expect(result.status).toBe("failed");
    expect(result.failureReason).toBe("Gateway media download error: 404");
    expect(prisma.whatsappMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: "failed",
        failureReason: "Gateway media download error: 404",
      }),
    });
  });

  it("scopes template media strictly to the target clinic", async () => {
    // Clinic A has media
    vi.mocked(prisma.whatsappTemplateMedia.findUnique).mockResolvedValueOnce({
      id: "binding-A",
      templateId: "tmpl-1",
      clinicId: "clinic-A",
      mediaAsset: {
        id: "asset-clinic-A",
        tenantId: "tenant-1",
        clinicId: "clinic-A",
        mediaType: "IMAGE",
        deletedAt: null,
      },
    } as never);

    vi.mocked(sendMedia).mockResolvedValueOnce({ ok: true, providerMessageId: "M1", message: "Sent" });

    await deliverTemplate(baseTemplate, { ...deliveryTarget, clinicId: "clinic-A" });

    expect(prisma.whatsappTemplateMedia.findUnique).toHaveBeenCalledWith({
      where: {
        templateId_clinicId: { templateId: "tmpl-1", clinicId: "clinic-A" },
      },
      include: { mediaAsset: true },
    });
  });
});
