import { beforeEach, describe, expect, it, vi } from "vitest";
import { FeatureError } from "@/lib/featureResolution";
import { PermissionError, ScopeError, type ActorContext } from "@/lib/rbac";

const mocks = vi.hoisted(() => ({
  requireActor: vi.fn(),
  requireModule: vi.fn(),
  getPanel: vi.fn(),
  start: vi.fn(),
  getAttempt: vi.fn(),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));

vi.mock("@/lib/session", () => ({
  requireActor: mocks.requireActor,
  UnauthenticatedError: mocks.UnauthenticatedError,
}));
vi.mock("@/lib/features", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/features")>();
  return { ...actual, requireModule: mocks.requireModule };
});
vi.mock("@/lib/telephony/testCall", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/telephony/testCall")>();
  return {
    ...actual,
    getTelephonyTestCallPanelForActor: mocks.getPanel,
    startTelephonyTestCallForActor: mocks.start,
    getTelephonyTestCallForActor: mocks.getAttempt,
  };
});

import {
  GET as getPanel,
  POST as startCall,
} from "@/app/api/clinics/[id]/telephony/test-call/route";
import { GET as getStatus } from "@/app/api/clinics/[id]/telephony/test-call/[testCallId]/route";
import { TelephonyTestCallProviderError } from "@/lib/telephony/testCall";

const ACTOR: ActorContext = { userId: "user-a", tenantId: "tenant-a" };
const ATTEMPT = {
  id: "test-call-a",
  status: "REQUESTED",
  destinationLabel: "Test number ending in 0123",
  createdAt: "2026-09-02T12:00:00.000Z",
  answeredAt: null,
  completedAt: null,
  message: "Starting the controlled test call.",
};
const PANEL = {
  available: true,
  destinationLabel: "Test number ending in 0123",
  unavailableReason: null,
  latestAttempt: null,
};

function context(id = "clinic-a") {
  return { params: Promise.resolve({ id }) };
}

function statusContext(id = "clinic-a", testCallId = "test-call-a") {
  return { params: Promise.resolve({ id, testCallId }) };
}

function post(body?: unknown, clinicId = "clinic-a") {
  const options: RequestInit = { method: "POST" };
  if (body !== undefined) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(body);
  }
  return startCall(
    new Request(
      `https://app.example/api/clinics/${clinicId}/telephony/test-call`,
      options,
    ),
    context(clinicId),
  );
}

describe("controlled telephony test-call actor APIs", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((value) => {
      if (typeof value === "function" && "mockReset" in value) {
        (value as ReturnType<typeof vi.fn>).mockReset();
      }
    });
    mocks.requireActor.mockResolvedValue(ACTOR);
    mocks.requireModule.mockResolvedValue(undefined);
    mocks.getPanel.mockResolvedValue(PANEL);
    mocks.start.mockResolvedValue(ATTEMPT);
    mocks.getAttempt.mockResolvedValue(ATTEMPT);
  });

  it("rejects unauthenticated POST before module or provider work", async () => {
    mocks.requireActor.mockRejectedValueOnce(new mocks.UnauthenticatedError());
    const response = await post();
    expect(response.status).toBe(401);
    expect(mocks.requireModule).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("respects the IVR module lock", async () => {
    mocks.requireModule.mockRejectedValueOnce(
      new FeatureError("ivr", "entitlement"),
    );
    const response = await post({});
    expect(response.status).toBe(403);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("accepts only an empty body and scopes start to the URL clinic", async () => {
    const response = await post({}, "clinic-a");
    expect(response.status).toBe(201);
    expect(mocks.requireModule).toHaveBeenCalledWith(ACTOR, "ivr");
    expect(mocks.start).toHaveBeenCalledWith(
      ACTOR,
      "clinic-a",
      "https://app.example/api/clinics/clinic-a/telephony/test-call",
    );
  });

  it("also accepts no request body", async () => {
    expect((await post()).status).toBe(201);
  });

  it.each([
    ["destination", { to: "+14155550199" }],
    ["caller ID", { From: "+919000000009" }],
    ["clinic scope", { clinicId: "clinic-b" }],
    ["tenant scope", { tenantId: "tenant-b" }],
    ["unknown field", { anything: true }],
  ])("strictly rejects browser-supplied %s", async (_name, body) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it.each([
    [new ScopeError(), 404],
    [new PermissionError("clinic:edit"), 403],
  ])("preserves tenant/scope and management permission boundaries", async (error, status) => {
    mocks.start.mockRejectedValueOnce(error);
    const response = await post({});
    expect(response.status).toBe(status);
  });

  it("returns a safe provider failure without raw details", async () => {
    mocks.start.mockRejectedValueOnce(new TelephonyTestCallProviderError());
    const response = await post({});
    expect(response.status).toBe(502);
    const serialized = JSON.stringify(await response.json());
    expect(serialized).toContain("could not be started");
    expect(serialized).not.toMatch(/auth|token|plivoNumber|provider response/i);
  });

  it("returns only sanitized panel and attempt views", async () => {
    const panelResponse = await getPanel(
      new Request("https://app.example/api/test"),
      context(),
    );
    const statusResponse = await getStatus(
      new Request("https://app.example/api/test/status"),
      statusContext(),
    );
    expect(panelResponse.status).toBe(200);
    expect(statusResponse.status).toBe(200);
    expect(mocks.getAttempt).toHaveBeenCalledWith(
      ACTOR,
      "clinic-a",
      "test-call-a",
    );
    const serialized = JSON.stringify([
      await panelResponse.json(),
      await statusResponse.json(),
    ]);
    expect(serialized).not.toMatch(
      /plivoNumber|providerCallUuid|providerRequestUuid|authId|authToken|14155550123/i,
    );
  });

  it("does not enumerate an attempt through a different clinic", async () => {
    mocks.getAttempt.mockRejectedValueOnce(new ScopeError());
    const response = await getStatus(
      new Request("https://app.example/api/test/status"),
      statusContext("clinic-b", "test-call-a"),
    );
    expect(response.status).toBe(404);
  });
});
