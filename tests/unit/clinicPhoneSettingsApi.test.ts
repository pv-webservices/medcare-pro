import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionError, ScopeError, type ActorContext } from "@/lib/rbac";

const mocks = vi.hoisted(() => ({
  requireActor: vi.fn(),
  requireModule: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireActor: mocks.requireActor,
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));
vi.mock("@/lib/features", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/features")>();
  return { ...actual, requireModule: mocks.requireModule };
});
vi.mock("@/lib/telephony/clinicPhoneSettings", () => ({
  getClinicPhoneSettingsForActor: mocks.getSettings,
  updateClinicPhoneSettingsForActor: mocks.updateSettings,
}));

import {
  GET,
  PATCH,
} from "@/app/api/clinics/[id]/telephony/settings/route";

const ACTOR: ActorContext = { userId: "user-a", tenantId: "tenant-a" };
const SAFE_RESPONSE = {
  clinicId: "clinic-a",
  serviceStatus: "active",
  routingMode: "AUTO",
  effectiveRoute: "IVR",
  publicPhoneNumber: null,
  receptionPhoneNumber: null,
  urgentPhoneNumber: null,
  timezone: "Asia/Kolkata",
  phoneMenuSource: "default",
  readiness: { status: "attention" },
};

function context(id = "clinic-a") {
  return { params: Promise.resolve({ id }) };
}

function patch(body: unknown, id = "clinic-a") {
  return PATCH(
    new Request(`https://app.example/api/clinics/${id}/telephony/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    context(id),
  );
}

describe("clinic-facing phone settings API", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.requireActor.mockResolvedValue(ACTOR);
    mocks.requireModule.mockResolvedValue(undefined);
    mocks.getSettings.mockResolvedValue(SAFE_RESPONSE);
    mocks.updateSettings.mockResolvedValue(SAFE_RESPONSE);
  });

  it("gates the module and scopes safe GET to the URL clinic", async () => {
    const response = await GET(new Request("https://app.example"), context("clinic-a"));
    expect(response.status).toBe(200);
    expect(mocks.requireModule).toHaveBeenCalledWith(ACTOR, "clinics");
    expect(mocks.getSettings).toHaveBeenCalledWith(ACTOR, "clinic-a");
    expect(JSON.stringify(await response.json())).not.toMatch(
      /plivoNumber|authToken|webhook/i,
    );
  });

  it("accepts and canonicalizes only the four safe mutation fields", async () => {
    const response = await patch({
      publicPhoneNumber: " +919000000002 ",
      receptionPhoneNumber: "",
      urgentPhoneNumber: null,
      timezone: " Asia/Kolkata ",
    });
    expect(response.status).toBe(200);
    expect(mocks.updateSettings).toHaveBeenCalledWith(ACTOR, "clinic-a", {
      publicPhoneNumber: "+919000000002",
      receptionPhoneNumber: null,
      urgentPhoneNumber: null,
      timezone: "Asia/Kolkata",
    });
  });

  it.each([
    ["enabled", { enabled: false }],
    ["plivoNumber", { plivoNumber: "+919000000009" }],
    ["routingMode", { routingMode: "OPEN" }],
    ["clinicId", { publicPhoneNumber: null, clinicId: "clinic-b" }],
    ["tenantId", { publicPhoneNumber: null, tenantId: "tenant-b" }],
    ["unknown", { publicPhoneNumber: null, customField: "value" }],
  ])("strictly rejects %s", async (_case, body) => {
    const response = await patch(body);
    expect(response.status).toBe(400);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("cannot use request fields to override the URL clinic", async () => {
    await patch({ timezone: "Asia/Dubai" }, "clinic-b");
    expect(mocks.updateSettings).toHaveBeenCalledWith(
      ACTOR,
      "clinic-b",
      { timezone: "Asia/Dubai" },
    );
  });

  it.each([
    [new ScopeError(), 404],
    [new PermissionError("clinic:edit"), 403],
  ])("preserves canonical non-enumerable and edit boundaries", async (error, status) => {
    mocks.getSettings.mockRejectedValueOnce(error);
    const response = await GET(new Request("https://app.example"), context());
    expect(response.status).toBe(status);
  });
});

