import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionError, ScopeError, type ActorContext } from "@/lib/rbac";
import type { ClinicBusinessHoursDay } from "@/lib/telephony/businessHours";
import { CLINIC_BUSINESS_WEEKDAYS } from "@/lib/telephony/businessHours";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  moduleLock: vi.fn(),
  findUnique: vi.fn(),
  getHours: vi.fn(),
}));

vi.mock("@/lib/telephony/access", () => ({
  assertActorCanManageTelephony: mocks.authorize,
}));

vi.mock("@/lib/features", () => ({
  moduleLock: mocks.moduleLock,
  MODULE_FEATURES: { clinics: "clinics" },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    clinicTelephonyConfig: { findUnique: mocks.findUnique },
  },
}));

vi.mock("@/lib/telephony/clinicConfig", () => ({
  DEFAULT_CLINIC_TELEPHONY_ROUTING_MODE: "AFTER_HOURS",
  DEFAULT_CLINIC_TIMEZONE: "Asia/Kolkata",
}));

vi.mock("@/lib/telephony/businessHours", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/telephony/businessHours")>();
  return {
    ...actual,
    getClinicBusinessHoursForTrustedClinic: mocks.getHours,
  };
});

import { getDashboardCallHandlingForActor } from "@/lib/telephony/dashboardCallHandling";
import { resolveCallHandlingEffectiveState } from "@/lib/telephony/dashboardCallHandlingState";
import { isReceptionDestinationAvailable } from "@/lib/telephony/reception";

const ACTOR: ActorContext = { userId: "user-a", tenantId: "tenant-a" };
const NOW = new Date("2026-08-31T07:00:00.000Z");

function week(
  open: Partial<
    Record<(typeof CLINIC_BUSINESS_WEEKDAYS)[number], [string, string]>
  > = { MONDAY: ["09:00", "18:00"] },
): ClinicBusinessHoursDay[] {
  return CLINIC_BUSINESS_WEEKDAYS.map((dayOfWeek) => {
    const interval = open[dayOfWeek];
    return interval
      ? {
          dayOfWeek,
          isClosed: false,
          openTime: interval[0],
          closeTime: interval[1],
        }
      : { dayOfWeek, isClosed: true, openTime: null, closeTime: null };
  });
}

const STORED = {
  enabled: true,
  plivoNumber: "+919000000001",
  publicPhoneNumber: "+919000000003",
  receptionPhoneNumber: "+919000000002",
  timezone: "Asia/Kolkata",
  routingMode: "AUTO" as const,
  updatedAt: new Date("2026-08-31T06:00:00.000Z"),
};

describe("dashboard call-handling server read model", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.authorize.mockResolvedValue(undefined);
    mocks.moduleLock.mockResolvedValue(null);
    mocks.findUnique.mockResolvedValue(STORED);
    mocks.getHours.mockResolvedValue(week());
  });

  it("loads only the selected clinic and resolves AUTO-open to reception", async () => {
    const model = await getDashboardCallHandlingForActor(
      ACTOR,
      "clinic-b",
      NOW,
    );

    expect(mocks.authorize).toHaveBeenCalledWith(ACTOR, "clinic-b");
    expect(mocks.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clinicId: "clinic-b" } }),
    );
    expect(mocks.getHours).toHaveBeenCalledWith("clinic-b");
    expect(model).toMatchObject({
      clinicId: "clinic-b",
      enabled: true,
      routingMode: "AUTO",
      effectiveRoute: "RECEPTION",
      isOpen: true,
      receptionAvailable: true,
      canManage: true,
    });
  });

  it("returns a narrow model without provider or clinic phone numbers", async () => {
    const model = await getDashboardCallHandlingForActor(
      ACTOR,
      "clinic-a",
      NOW,
    );
    const serialized = JSON.stringify(model);

    expect(serialized).not.toContain("plivoNumber");
    expect(serialized).not.toContain("publicPhoneNumber");
    expect(serialized).not.toContain("receptionPhoneNumber");
    expect(serialized).not.toContain("urgentPhoneNumber");
    expect(serialized).not.toContain("+91900000000");
  });

  it("renders a visible clinic read-only when clinic:edit is absent", async () => {
    mocks.authorize.mockRejectedValueOnce(new PermissionError("clinic:edit"));

    const model = await getDashboardCallHandlingForActor(
      ACTOR,
      "clinic-a",
      NOW,
    );

    expect(model.canManage).toBe(false);
    expect(mocks.findUnique).toHaveBeenCalledOnce();
  });

  it("does not expose controls when the clinics module is unavailable", async () => {
    mocks.moduleLock.mockResolvedValueOnce("plan");
    expect(
      (await getDashboardCallHandlingForActor(ACTOR, "clinic-a", NOW))
        .canManage,
    ).toBe(false);
  });

  it("fails closed for cross-tenant or out-of-scope clinics", async () => {
    mocks.authorize.mockRejectedValueOnce(new ScopeError());

    await expect(
      getDashboardCallHandlingForActor(ACTOR, "clinic-other", NOW),
    ).rejects.toBeInstanceOf(ScopeError);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("treats a missing config as a hard-disabled safe default", async () => {
    mocks.findUnique.mockResolvedValueOnce(null);
    mocks.getHours.mockResolvedValueOnce([]);

    const model = await getDashboardCallHandlingForActor(
      ACTOR,
      "clinic-a",
      NOW,
    );
    expect(model).toMatchObject({
      enabled: false,
      routingMode: "AFTER_HOURS",
      effectiveRoute: null,
      hasRegularHours: false,
      receptionAvailable: false,
    });
  });
});

describe("dashboard call-handling effective states", () => {
  it.each([
    [
      "AUTO + open",
      { routingMode: "AUTO", isOpen: true, hasRegularHours: true },
      "Open · Calls going to reception",
      "RECEPTION",
    ],
    [
      "AUTO + closed",
      { routingMode: "AUTO", isOpen: false, hasRegularHours: true },
      "Closed · Phone menu active",
      "IVR",
    ],
    [
      "AUTO + no hours",
      { routingMode: "AUTO", isOpen: false, hasRegularHours: false },
      "Business hours not configured · Phone menu active",
      "IVR",
    ],
    [
      "OPEN",
      { routingMode: "OPEN", isOpen: false, hasRegularHours: true },
      "Manual override · Reception",
      "RECEPTION",
    ],
    [
      "AFTER_HOURS",
      { routingMode: "AFTER_HOURS", isOpen: true, hasRegularHours: true },
      "Manual override · Phone menu",
      "IVR",
    ],
  ] as const)("derives %s", (_case, input, status, effectiveRoute) => {
    expect(
      resolveCallHandlingEffectiveState({
        enabled: true,
        receptionAvailable: true,
        ...input,
      }),
    ).toMatchObject({ status, effectiveRoute });
  });

  it("represents a requested but unsafe reception route as IVR fallback", () => {
    expect(
      resolveCallHandlingEffectiveState({
        enabled: true,
        routingMode: "OPEN",
        isOpen: false,
        hasRegularHours: true,
        receptionAvailable: false,
      }),
    ).toMatchObject({
      status: "Reception unavailable · Phone menu active",
      effectiveRoute: "IVR",
    });
  });

  it("keeps hard-disabled telephony distinct from a routing mode", () => {
    expect(
      resolveCallHandlingEffectiveState({
        enabled: false,
        routingMode: "OPEN",
        isOpen: true,
        hasRegularHours: true,
        receptionAvailable: true,
      }),
    ).toMatchObject({
      status: "Disabled",
      effectiveRoute: null,
      supportingText: "Call automation is disabled for this clinic.",
    });
  });
});

describe("canonical reception availability", () => {
  const safe = {
    providerNumber: "+919000000001",
    publicPhoneNumber: "+919000000003",
    receptionPhoneNumber: "+919000000002",
  };

  it("accepts the same safe destination used by live routing", () => {
    expect(isReceptionDestinationAvailable(safe)).toBe(true);
  });

  it.each([
    ["missing", { ...safe, receptionPhoneNumber: null }],
    ["provider loop", { ...safe, receptionPhoneNumber: safe.providerNumber }],
    ["public loop", { ...safe, receptionPhoneNumber: safe.publicPhoneNumber }],
    ["invalid", { ...safe, receptionPhoneNumber: "not-a-number" }],
    ["non-Indian", { ...safe, receptionPhoneNumber: "+14155550100" }],
  ])("rejects a %s reception destination", (_case, input) => {
    expect(isReceptionDestinationAvailable(input)).toBe(false);
  });
});
