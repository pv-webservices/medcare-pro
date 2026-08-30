import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError } from "@/lib/apiHandler";
import { PermissionError, ScopeError, type ActorContext } from "@/lib/rbac";

const mocks = vi.hoisted(() => ({
  requireActor: vi.fn(),
  requireModule: vi.fn(),
  getConfig: vi.fn(),
  updateConfig: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireActor: mocks.requireActor,
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));

vi.mock("@/lib/features", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/features")>();
  return { ...actual, requireModule: mocks.requireModule };
});

vi.mock("@/lib/telephony/clinicConfig", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/telephony/clinicConfig")>();
  return {
    ...actual,
    getClinicTelephonyConfigForActor: mocks.getConfig,
    updateClinicTelephonyConfigForActor: mocks.updateConfig,
  };
});

import {
  GET,
  PATCH,
} from "@/app/api/clinics/[clinicId]/telephony/route";

const ACTOR: ActorContext = { userId: "user-a", tenantId: "tenant-a" };
const CONFIG = {
  clinicId: "clinic-a",
  enabled: false,
  plivoNumber: null,
  publicPhoneNumber: null,
  receptionPhoneNumber: null,
  urgentPhoneNumber: null,
  timezone: "Asia/Kolkata",
  createdAt: null,
  updatedAt: null,
};

function context(clinicId = "clinic-a") {
  return { params: Promise.resolve({ clinicId }) };
}

function patchRequest(body: unknown): Request {
  return new Request("https://medcare.example/api/clinics/clinic-a/telephony", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("clinic telephony configuration API", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.requireActor.mockResolvedValue(ACTOR);
    mocks.requireModule.mockResolvedValue(undefined);
    mocks.getConfig.mockResolvedValue(CONFIG);
    mocks.updateConfig.mockResolvedValue({
      ...CONFIG,
      enabled: true,
      plivoNumber: "+14155550101",
    });
  });

  it("allows an authorized clinic editor to GET and PATCH", async () => {
    const getResponse = await GET(
      new Request("https://medcare.example/api/clinics/clinic-a/telephony"),
      context(),
    );
    const patchResponse = await PATCH(
      patchRequest({ enabled: true, plivoNumber: "+14155550101" }),
      context(),
    );

    expect(getResponse.status).toBe(200);
    expect(patchResponse.status).toBe(200);
    expect(mocks.getConfig).toHaveBeenCalledWith(ACTOR, "clinic-a");
    expect(mocks.updateConfig).toHaveBeenCalledWith(ACTOR, "clinic-a", {
      enabled: true,
      plivoNumber: "+14155550101",
    });
  });

  it.each([
    ["another tenant", "clinic-c"],
    ["outside a clinic-scoped role", "clinic-b"],
  ])("returns non-enumerable 404 for %s", async (_case, clinicId) => {
    mocks.getConfig.mockRejectedValueOnce(new ScopeError());

    const response = await GET(
      new Request(`https://medcare.example/api/clinics/${clinicId}/telephony`),
      context(clinicId),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      success: false,
      error: "Not found.",
    });
  });

  it("returns 403 when the clinic is visible but edit permission is absent", async () => {
    mocks.getConfig.mockRejectedValueOnce(new PermissionError("clinic:edit"));

    const response = await GET(
      new Request("https://medcare.example/api/clinics/clinic-a/telephony"),
      context(),
    );

    expect(response.status).toBe(403);
  });

  it.each(["tenantId", "clinicId"])(
    "strictly rejects PATCH scope field %s",
    async (field) => {
      const response = await PATCH(
        patchRequest({ enabled: false, [field]: "attacker-controlled" }),
        context(),
      );

      expect(response.status).toBe(400);
      expect(mocks.updateConfig).not.toHaveBeenCalled();
    },
  );

  it("returns a generic conflict for a duplicate provider number", async () => {
    mocks.updateConfig.mockRejectedValueOnce(
      new ConflictError("That provider number is already assigned."),
    );

    const response = await PATCH(
      patchRequest({ plivoNumber: "+14155550101" }),
      context(),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      success: false,
      error: "That provider number is already assigned.",
    });
  });
});
