import { beforeEach, describe, expect, it, vi } from "vitest";
import { FeatureError } from "@/lib/featureResolution";
import { PermissionError, ScopeError, type ActorContext } from "@/lib/rbac";

const mocks = vi.hoisted(() => ({
  requireActor: vi.fn(),
  requireModule: vi.fn(),
  getDiagnostics: vi.fn(),
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
vi.mock("@/lib/telephony/callDiagnostics", () => ({
  getPhoneDiagnosticsForActor: mocks.getDiagnostics,
}));

import { GET } from "@/app/api/clinics/[id]/telephony/diagnostics/route";

const ACTOR: ActorContext = { userId: "user-a", tenantId: "tenant-a" };
const VIEW = {
  window: { hours: 24 },
  timezone: "Asia/Kolkata",
  health: {
    status: "healthy",
    recentCalls: 1,
    incompleteCalls: 0,
    receptionFailures: 0,
    urgentTransferFailures: 0,
  },
  recentCalls: [{
    id: "internal-row-a",
    startedAt: "2026-09-02T10:00:00.000Z",
    endedAt: "2026-09-02T10:01:00.000Z",
    durationSeconds: 60,
    callerLabel: "Caller ending in 4821",
    status: "COMPLETED",
    initialRoute: "IVR",
    highlights: ["Call received", "Call ended"],
  }],
} as const;

function context(id = "clinic-a") {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/clinics/[id]/telephony/diagnostics", () => {
  beforeEach(() => {
    mocks.requireActor.mockReset().mockResolvedValue(ACTOR);
    mocks.requireModule.mockReset().mockResolvedValue(undefined);
    mocks.getDiagnostics.mockReset().mockResolvedValue(VIEW);
  });

  it("requires authentication before module or diagnostic reads", async () => {
    mocks.requireActor.mockRejectedValueOnce(new mocks.UnauthenticatedError());
    const response = await GET(new Request("https://app.example/api/test"), context());
    expect(response.status).toBe(401);
    expect(mocks.requireModule).not.toHaveBeenCalled();
    expect(mocks.getDiagnostics).not.toHaveBeenCalled();
  });

  it("keeps the IVR module boundary", async () => {
    mocks.requireModule.mockRejectedValueOnce(new FeatureError("ivr", "entitlement"));
    const response = await GET(new Request("https://app.example/api/test"), context());
    expect(response.status).toBe(403);
    expect(mocks.getDiagnostics).not.toHaveBeenCalled();
  });

  it.each([
    [new ScopeError(), 404],
    [new PermissionError("clinic:edit"), 403],
  ])("preserves tenant/clinic management authorization", async (error, status) => {
    mocks.getDiagnostics.mockRejectedValueOnce(error);
    const response = await GET(new Request("https://app.example/api/test"), context("clinic-b"));
    expect(response.status).toBe(status);
  });

  it("uses only the URL clinic even when query scope is attacker-controlled", async () => {
    const response = await GET(
      new Request("https://app.example/api/clinics/clinic-a/telephony/diagnostics?clinicId=clinic-b&tenantId=tenant-b"),
      context("clinic-a"),
    );
    expect(response.status).toBe(200);
    expect(mocks.requireModule).toHaveBeenCalledWith(ACTOR, "ivr");
    expect(mocks.getDiagnostics).toHaveBeenCalledWith(ACTOR, "clinic-a");
  });

  it("returns only the sanitized diagnostics contract", async () => {
    const response = await GET(new Request("https://app.example/api/test"), context());
    expect(response.status).toBe(200);
    const serialized = JSON.stringify(await response.json());
    expect(serialized).toContain("Caller ending in 4821");
    expect(serialized).not.toMatch(
      /providerCallUuid|providerNumber|receptionNumber|urgentNumber|authId|authToken|Digits|raw|payload|patient|hangupCause|DialBLegUUID|\+919876544821/i,
    );
  });

  it("cannot enumerate a direct object through another clinic URL", async () => {
    mocks.getDiagnostics.mockRejectedValueOnce(new ScopeError());
    const response = await GET(
      new Request("https://app.example/api/clinics/clinic-b/telephony/diagnostics?callId=internal-row-a"),
      context("clinic-b"),
    );
    expect(response.status).toBe(404);
    expect(mocks.getDiagnostics).toHaveBeenCalledWith(ACTOR, "clinic-b");
  });
});
