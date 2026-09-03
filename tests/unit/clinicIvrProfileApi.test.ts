import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionError, ScopeError } from "@/lib/rbac";

const mocks = vi.hoisted(() => ({
  requireActor: vi.fn(),
  requireModule: vi.fn(),
  getProfile: vi.fn(),
  replaceProfile: vi.fn(),
  resetProfile: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireActor: mocks.requireActor,
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));

vi.mock("@/lib/features", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/features")>();
  return { ...actual, requireModule: mocks.requireModule };
});

vi.mock("@/lib/telephony/ivrProfile", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/telephony/ivrProfile")>();
  return {
    ...actual,
    getClinicIvrProfileForActor: mocks.getProfile,
    replaceClinicIvrProfileForActor: mocks.replaceProfile,
    resetClinicIvrProfileForActor: mocks.resetProfile,
  };
});

import {
  DELETE,
  GET,
  PUT,
} from "@/app/api/clinics/[id]/telephony/ivr-profile/route";

const ACTOR = { userId: "user-a", tenantId: "tenant-a" };
const context = { params: Promise.resolve({ id: "clinic-a" }) };
const PROFILE = {
  clinicId: "clinic-a",
  source: "default" as const,
  greetingTemplate: "Welcome to {clinicName}.",
  language: "en-US" as const,
  voice: "WOMAN" as const,
  items: [
    {
      digit: 1,
      label: "tomorrow slots",
      action: "TOMORROW_SLOTS" as const,
      position: 0,
      enabled: true,
    },
  ],
  updatedAt: null,
};

function body(overrides: Record<string, unknown> = {}) {
  return {
    greetingTemplate: PROFILE.greetingTemplate,
    language: PROFILE.language,
    voice: PROFILE.voice,
    items: PROFILE.items,
    ...overrides,
  };
}

function put(payload: unknown) {
  return PUT(
    new Request(
      "https://app.example/api/clinics/clinic-a/telephony/ivr-profile",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    ),
    context,
  );
}

describe("clinic IVR profile management API", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.requireActor.mockResolvedValue(ACTOR);
    mocks.requireModule.mockResolvedValue(undefined);
    mocks.getProfile.mockResolvedValue(PROFILE);
    mocks.replaceProfile.mockResolvedValue({ ...PROFILE, source: "custom" });
    mocks.resetProfile.mockResolvedValue(PROFILE);
  });

  it("authenticates, gates the ivr module, and scopes GET to the route id", async () => {
    const response = await GET(new Request("https://app.example"), context);
    expect(response.status).toBe(200);
    expect(mocks.requireModule).toHaveBeenCalledWith(ACTOR, "ivr");
    expect(mocks.getProfile).toHaveBeenCalledWith(ACTOR, "clinic-a");
    expect(JSON.stringify(await response.json())).not.toMatch(
      /plivoNumber|phoneNumber|authToken|webhook/i,
    );
  });

  it("validates and delegates a complete PUT without body-controlled scope", async () => {
    const response = await put(body());
    expect(response.status).toBe(200);
    expect(mocks.replaceProfile).toHaveBeenCalledWith(
      ACTOR,
      "clinic-a",
      expect.objectContaining({
        greetingTemplate: PROFILE.greetingTemplate,
        items: PROFILE.items,
      }),
    );
  });

  it.each(["tenantId", "clinicId", "profileId", "unknown"])(
    "rejects strict-body field %s before calling the service",
    async (field) => {
      const response = await put(body({ [field]: "attacker" }));
      expect(response.status).toBe(400);
      expect(mocks.replaceProfile).not.toHaveBeenCalled();
    },
  );

  it("resets only through the clinic-scoped DELETE service", async () => {
    const response = await DELETE(
      new Request("https://app.example", { method: "DELETE" }),
      context,
    );
    expect(response.status).toBe(200);
    expect(mocks.resetProfile).toHaveBeenCalledWith(ACTOR, "clinic-a");
  });

  it("returns 403 when a visible clinic lacks management permission", async () => {
    mocks.replaceProfile.mockRejectedValueOnce(
      new PermissionError("clinic:edit"),
    );
    expect((await put(body())).status).toBe(403);
  });

  it("keeps cross-tenant and out-of-scope clinics non-enumerable", async () => {
    mocks.getProfile.mockRejectedValueOnce(new ScopeError());
    const response = await GET(new Request("https://app.example"), {
      params: Promise.resolve({ id: "clinic-other" }),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      success: false,
      error: "Not found.",
    });
  });
});
