import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    patient: { findMany: vi.fn() },
    whatsappMessage: { findMany: vi.fn(), create: vi.fn() },
    whatsappTemplateMedia: { findUnique: vi.fn().mockResolvedValue(null) },
    mediaAsset: { update: vi.fn().mockResolvedValue({}) },
  },
}));

vi.mock("@/lib/whatsapp", () => ({
  sendMedia: vi.fn(),
  sendText: vi.fn(),
  checkNumber: vi.fn(),
  readWhatsappConfig: vi.fn(),
  WhatsappNotConfiguredError: class WhatsappNotConfiguredError extends Error {},
  MEDIA_TYPES: ["image", "video", "audio", "document"],
}));

vi.mock("@/lib/whatsappProviderConfig", () => ({
  resolveWhatsappConfigForClinic: vi.fn(),
}));

vi.mock("@/lib/clinicScope", () => ({
  clinicWhereForActor: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/lib/rbac", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rbac")>()),
  assertClinicInTenant: vi.fn().mockResolvedValue(undefined),
  requirePermission: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/whatsappTemplates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/whatsappTemplates")>()),
  assertCanSendSomewhere: vi.fn().mockResolvedValue(undefined),
  getTemplateForActor: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { checkNumber, sendText } from "@/lib/whatsapp";
import { resolveWhatsappConfigForClinic } from "@/lib/whatsappProviderConfig";
import { requirePermission, type ActorContext } from "@/lib/rbac";
import { getTemplateForActor, type TemplateRecord } from "@/lib/whatsappTemplates";
import {
  ALREADY_SENT_TODAY_REASON,
  listPatientsSentTemplateToday,
  sendToPatients,
  todaySendWindow,
} from "@/lib/whatsappMessages";

const actor = { userId: "user-1", tenantId: "tenant-1" } as unknown as ActorContext;

const template: TemplateRecord = {
  id: "tmpl-1",
  name: "Follow-up reminder",
  body: "Hi {patientName}",
  footer: null,
  mediaType: null,
  mediaUrl: null,
  placeholders: ["patientName"],
};

function patientRow(id: string, name: string, mobileNumber: string) {
  return {
    id,
    name,
    patientCode: `PT-2026-${id}`,
    mobileNumber,
    clinicId: "clinic-A",
    clinic: { name: "Alpha Clinic" },
    registrations: [],
  };
}

describe("todaySendWindow", () => {
  it("spans the Asia/Kolkata calendar day, not the UTC one", () => {
    // 20:00 UTC on 26 Sep is already 01:30 on 27 Sep in India.
    const { start, end } = todaySendWindow(new Date("2026-09-26T20:00:00.000Z"));

    expect(start.toISOString()).toBe("2026-09-26T18:30:00.000Z");
    expect(end.toISOString()).toBe("2026-09-27T18:30:00.000Z");
  });
});

describe("sendToPatients — one template per patient per day", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getTemplateForActor).mockResolvedValue(template);
    vi.mocked(resolveWhatsappConfigForClinic).mockResolvedValue({
      deviceId: "device-1",
      sender: "919999999999",
    } as never);
    vi.mocked(checkNumber).mockResolvedValue({ checked: true, exists: true } as never);
    vi.mocked(sendText).mockResolvedValue({
      ok: true,
      providerMessageId: "MSG-1",
      message: "sent",
    });
    vi.mocked(prisma.patient.findMany).mockResolvedValue([
      patientRow("0001", "Ramesh Kumar", "9800000001"),
      patientRow("0002", "Sunita Devi", "9800000002"),
    ] as never);
  });

  it("skips a patient who already received this template today and sends the rest", async () => {
    vi.mocked(prisma.whatsappMessage.findMany).mockResolvedValue([
      { patientId: "0001" },
    ] as never);

    const result = await sendToPatients(actor, {
      templateId: "tmpl-1",
      patientIds: ["0001", "0002"],
    });

    expect(result).toMatchObject({ sent: 1, failed: 0, skipped: 1 });
    expect(result.results.find((row) => row.patientId === "0001")).toMatchObject({
      status: "skipped",
      failureReason: ALREADY_SENT_TODAY_REASON,
    });
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendText).mock.calls[0][0].to).toBe("919800000002");
    // A skip is not an attempt, so it leaves no history row.
    expect(prisma.whatsappMessage.create).toHaveBeenCalledTimes(1);
  });

  it("only counts successful sends of the same template today, within the tenant", async () => {
    vi.mocked(prisma.whatsappMessage.findMany).mockResolvedValue([]);

    await sendToPatients(actor, { templateId: "tmpl-1", patientIds: ["0001", "0002"] });

    const where = vi.mocked(prisma.whatsappMessage.findMany).mock.calls[0][0]?.where;
    expect(where).toMatchObject({
      templateName: "Follow-up reminder",
      status: "sent",
      clinic: { tenantId: "tenant-1" },
      patientId: { in: ["0001", "0002"] },
    });
    expect(where?.sentAt).toMatchObject({
      gte: expect.any(Date),
      lt: expect.any(Date),
    });
    expect(sendText).toHaveBeenCalledTimes(2);
  });
});

describe("listPatientsSentTemplateToday", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getTemplateForActor).mockResolvedValue(template);
  });

  it("requires message:send in the clinic and scopes the lookup to it", async () => {
    vi.mocked(prisma.whatsappMessage.findMany).mockResolvedValue([
      { patientId: "0001" },
    ] as never);

    const ids = await listPatientsSentTemplateToday(actor, "tmpl-1", "clinic-A");

    expect(ids).toEqual(["0001"]);
    expect(requirePermission).toHaveBeenCalledWith(actor, "message:send", "clinic-A");
    expect(vi.mocked(prisma.whatsappMessage.findMany).mock.calls[0][0]?.where).toMatchObject({
      clinicId: "clinic-A",
      clinic: { tenantId: "tenant-1" },
      templateName: "Follow-up reminder",
      status: "sent",
    });
  });

  it("does not query messages when the permission check fails", async () => {
    vi.mocked(requirePermission).mockRejectedValueOnce(new Error("forbidden"));

    await expect(
      listPatientsSentTemplateToday(actor, "tmpl-1", "clinic-B"),
    ).rejects.toThrow("forbidden");
    expect(prisma.whatsappMessage.findMany).not.toHaveBeenCalled();
  });
});
