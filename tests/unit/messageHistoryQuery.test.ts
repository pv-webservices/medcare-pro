import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActorContext } from "@/lib/rbac";
import { PermissionError } from "@/lib/rbac";

vi.mock("@/lib/session", () => ({
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    whatsappMessage: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rbac")>();
  return {
    ...actual,
    accessibleClinicScope: vi.fn(),
  };
});

import { prisma } from "@/lib/prisma";
import { accessibleClinicScope } from "@/lib/rbac";
import { listMessagesForActor } from "@/lib/whatsappMessages";

describe("listMessagesForActor query filtering", () => {
  const actor: ActorContext = {
    userId: "user-1",
    tenantId: "tenant-1",
  };

  const sampleDbRow = {
    id: "msg-1",
    templateName: "Appointment Reminder",
    status: "sent",
    failureReason: null,
    providerMessageId: "WID-123",
    sentAt: new Date("2026-09-03T12:00:00Z"),
    clinic: { name: "Central Clinic" },
    patient: {
      name: "Yogesh Kumar",
      patientCode: "P-001",
      mobileNumber: "919876543210",
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queries with tenant scope and ordering by sentAt desc before take limit", async () => {
    vi.mocked(accessibleClinicScope).mockResolvedValueOnce({ scope: "all" });
    vi.mocked(prisma.whatsappMessage.findMany).mockResolvedValueOnce([sampleDbRow] as never);

    const result = await listMessagesForActor(actor);

    expect(prisma.whatsappMessage.findMany).toHaveBeenCalledWith({
      where: {
        clinic: { tenantId: "tenant-1" },
      },
      orderBy: { sentAt: "desc" },
      take: 100,
      select: expect.any(Object),
    });

    expect(result).toHaveLength(1);
    expect(result[0].patientName).toBe("Yogesh Kumar");
    expect(result[0].clinicName).toBe("Central Clinic");
  });

  it("applies sentFrom and sentToExclusive in Prisma WHERE clause", async () => {
    vi.mocked(accessibleClinicScope).mockResolvedValueOnce({ scope: "all" });
    vi.mocked(prisma.whatsappMessage.findMany).mockResolvedValueOnce([sampleDbRow] as never);

    const sentFrom = new Date("2026-09-03T00:00:00.000Z");
    const sentToExclusive = new Date("2026-09-04T00:00:00.000Z");

    await listMessagesForActor(actor, {
      clinicId: "clinic-A",
      sentFrom,
      sentToExclusive,
    });

    expect(prisma.whatsappMessage.findMany).toHaveBeenCalledWith({
      where: {
        clinic: { tenantId: "tenant-1" },
        clinicId: "clinic-A",
        sentAt: {
          gte: sentFrom,
          lt: sentToExclusive,
        },
      },
      orderBy: { sentAt: "desc" },
      take: 100,
      select: expect.any(Object),
    });
  });

  it("applies sentFrom only when sentToExclusive is omitted", async () => {
    vi.mocked(accessibleClinicScope).mockResolvedValueOnce({ scope: "all" });
    vi.mocked(prisma.whatsappMessage.findMany).mockResolvedValueOnce([] as never);

    const sentFrom = new Date("2026-09-01T00:00:00.000Z");

    await listMessagesForActor(actor, { sentFrom });

    expect(prisma.whatsappMessage.findMany).toHaveBeenCalledWith({
      where: {
        clinic: { tenantId: "tenant-1" },
        sentAt: {
          gte: sentFrom,
        },
      },
      orderBy: { sentAt: "desc" },
      take: 100,
      select: expect.any(Object),
    });
  });

  it("enforces clinic reachability restrictions for scoped actors", async () => {
    vi.mocked(accessibleClinicScope).mockResolvedValueOnce({
      scope: "clinics",
      clinicIds: ["clinic-permitted-1", "clinic-permitted-2"],
    });
    vi.mocked(prisma.whatsappMessage.findMany).mockResolvedValueOnce([] as never);

    await listMessagesForActor(actor, {
      clinicId: "clinic-permitted-1",
      sentFrom: new Date("2026-09-02T00:00:00.000Z"),
    });

    expect(prisma.whatsappMessage.findMany).toHaveBeenCalledWith({
      where: {
        clinic: { tenantId: "tenant-1" },
        clinicId: {
          in: ["clinic-permitted-1"],
        },
        sentAt: {
          gte: new Date("2026-09-02T00:00:00.000Z"),
        },
      },
      orderBy: { sentAt: "desc" },
      take: 100,
      select: expect.any(Object),
    });
  });

  it("throws PermissionError when actor has no clinic scope", async () => {
    vi.mocked(accessibleClinicScope).mockResolvedValueOnce({ scope: "none" });

    await expect(listMessagesForActor(actor)).rejects.toThrow(PermissionError);
    expect(prisma.whatsappMessage.findMany).not.toHaveBeenCalled();
  });
});
