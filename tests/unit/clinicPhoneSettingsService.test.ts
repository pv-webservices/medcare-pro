import { beforeEach, describe, expect, it, vi } from "vitest";
import { BadRequestError } from "@/lib/apiHandler";
import { ScopeError, type ActorContext } from "@/lib/rbac";

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  updateConfig: vi.fn(),
  getHours: vi.fn(),
  getProfile: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));

vi.mock("@/lib/telephony/clinicConfig", () => ({
  getClinicTelephonyConfigForActor: mocks.getConfig,
  updateClinicTelephonyConfigForActor: mocks.updateConfig,
}));

vi.mock("@/lib/telephony/businessHours", () => ({
  getClinicBusinessHoursForActor: mocks.getHours,
}));

vi.mock("@/lib/telephony/ivrProfile", () => ({
  getClinicIvrProfileForActor: mocks.getProfile,
}));

import {
  getClinicPhoneSettingsForActor,
  updateClinicPhoneSettingsForActor,
} from "@/lib/telephony/clinicPhoneSettings";

const ACTOR: ActorContext = { userId: "user-a", tenantId: "tenant-a" };
const CONFIG = {
  clinicId: "clinic-a",
  enabled: true,
  plivoNumber: "+919000000001",
  publicPhoneNumber: "+919000000002",
  receptionPhoneNumber: "+919000000003",
  urgentPhoneNumber: "+919000000004",
  timezone: "Asia/Kolkata",
  routingMode: "AUTO" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("safe clinic phone settings service", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.getConfig.mockResolvedValue(CONFIG);
    mocks.getHours.mockResolvedValue({ clinicId: "clinic-a", hours: [] });
    mocks.getProfile.mockResolvedValue({
      clinicId: "clinic-a",
      source: "default",
      items: [{ action: "URGENT_ASSISTANCE", enabled: true }],
    });
    mocks.updateConfig.mockResolvedValue(CONFIG);
  });

  it("returns only clinic-safe fields and semantic service state", async () => {
    const result = await getClinicPhoneSettingsForActor(
      ACTOR,
      "clinic-a",
      new Date("2026-09-07T06:00:00.000Z"),
    );
    expect(Object.keys(result).sort()).toEqual([
      "clinicId",
      "effectiveRoute",
      "phoneMenuSource",
      "publicPhoneNumber",
      "readiness",
      "receptionPhoneNumber",
      "routingMode",
      "serviceStatus",
      "timezone",
      "urgentPhoneNumber",
    ]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("plivoNumber");
    expect(serialized).not.toContain(CONFIG.plivoNumber);
    expect(serialized).not.toMatch(/authToken|authId|webhook|signature/i);
    expect(result.serviceStatus).toBe("active");
  });

  it("keeps every read scoped through the canonical actor services", async () => {
    await getClinicPhoneSettingsForActor(ACTOR, "clinic-b");
    expect(mocks.getConfig).toHaveBeenCalledWith(ACTOR, "clinic-b");
    expect(mocks.getHours).toHaveBeenCalledWith(ACTOR, "clinic-b");
    expect(mocks.getProfile).toHaveBeenCalledWith(ACTOR, "clinic-b");
  });

  it("uses the runtime-equivalent default fallback for malformed custom menus", async () => {
    mocks.getProfile.mockResolvedValueOnce({
      clinicId: "clinic-a",
      source: "custom",
      greetingTemplate: "<invalid>",
      language: "unknown",
      voice: "ROBOT",
      items: [],
    });
    const result = await getClinicPhoneSettingsForActor(ACTOR, "clinic-a");
    expect(result.phoneMenuSource).toBe("default");
    expect(result.readiness.urgentTransfer.status).toBe("ready");
  });

  it("cannot inspect another tenant when canonical authorization rejects", async () => {
    mocks.getConfig.mockRejectedValueOnce(new ScopeError());
    await expect(
      getClinicPhoneSettingsForActor(ACTOR, "clinic-other"),
    ).rejects.toBeInstanceOf(ScopeError);
  });

  it("passes only the allowlisted clinic fields to the audited update service", async () => {
    await updateClinicPhoneSettingsForActor(ACTOR, "clinic-a", {
      publicPhoneNumber: "+919000000005",
      receptionPhoneNumber: "+919000000006",
      urgentPhoneNumber: null,
      timezone: "Asia/Dubai",
    });
    expect(mocks.updateConfig).toHaveBeenCalledWith(ACTOR, "clinic-a", {
      publicPhoneNumber: "+919000000005",
      receptionPhoneNumber: "+919000000006",
      urgentPhoneNumber: null,
      timezone: "Asia/Dubai",
    });
    const forwarded = JSON.stringify(mocks.updateConfig.mock.calls[0][2]);
    expect(forwarded).not.toMatch(/plivoNumber|enabled|routingMode/);
  });

  it.each([
    ["Reception", { receptionPhoneNumber: CONFIG.plivoNumber }],
    ["Reception", { receptionPhoneNumber: CONFIG.publicPhoneNumber }],
    ["Urgent", { urgentPhoneNumber: CONFIG.plivoNumber }],
    ["Urgent", { urgentPhoneNumber: CONFIG.publicPhoneNumber }],
  ])("rejects a %s routing loop without disclosing the conflicting number", async (label, input) => {
    await expect(
      updateClinicPhoneSettingsForActor(ACTOR, "clinic-a", input),
    ).rejects.toEqual(
      new BadRequestError(
        `${label} cannot use this number because it conflicts with the clinic's phone routing setup.`,
      ),
    );
    expect(mocks.updateConfig).not.toHaveBeenCalled();
  });

  it("sanitizes a provider-aware conflict raised after a concurrent system change", async () => {
    mocks.updateConfig.mockRejectedValueOnce(
      new BadRequestError("Reception number must not match the provider number."),
    );
    await expect(
      updateClinicPhoneSettingsForActor(ACTOR, "clinic-a", {
        receptionPhoneNumber: "+919000000006",
      }),
    ).rejects.toEqual(
      new BadRequestError(
        "A call destination conflicts with the clinic's phone routing setup.",
      ),
    );
  });
});
