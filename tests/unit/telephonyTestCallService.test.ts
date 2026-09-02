import { beforeEach, describe, expect, it, vi } from "vitest";
import { BadRequestError, ConflictError } from "@/lib/apiHandler";
import { RateLimitError } from "@/lib/rateLimit";
import { PermissionError, ScopeError, type ActorContext } from "@/lib/rbac";

const mocks = vi.hoisted(() => ({
  assertManage: vi.fn(),
  getPhoneSettings: vi.fn(),
  writeAudit: vi.fn(),
  configFindUnique: vi.fn(),
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  count: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));
vi.mock("@/lib/telephony/access", () => ({
  assertActorCanManageTelephony: mocks.assertManage,
}));
vi.mock("@/lib/telephony/clinicPhoneSettings", () => ({
  getClinicPhoneSettingsForActor: mocks.getPhoneSettings,
}));
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: {
    CLINIC_TELEPHONY_TEST_CALL_STARTED:
      "CLINIC_TELEPHONY_TEST_CALL_STARTED",
  },
  writeAuditLog: mocks.writeAudit,
}));
vi.mock("@/lib/prisma", () => {
  const clinicTelephonyTestCall = {
    findFirst: mocks.findFirst,
    findUnique: mocks.findUnique,
    count: mocks.count,
    create: mocks.create,
    update: mocks.update,
    updateMany: mocks.updateMany,
  };
  const prisma = {
    clinicTelephonyConfig: { findUnique: mocks.configFindUnique },
    clinicTelephonyTestCall,
    $transaction: mocks.transaction,
  };
  return { prisma };
});

import {
  bindAndTransitionTelephonyTestCallCallback,
  getTelephonyTestCallForActor,
  getTelephonyTestCallPanelForActor,
  resolveTelephonyTestCallStatusTransition,
  startTelephonyTestCallForActor,
  TelephonyTestCallCallbackError,
  TelephonyTestCallProviderError,
  TELEPHONY_TEST_CALL_DAILY_LIMIT,
} from "@/lib/telephony/testCall";

const ACTOR: ActorContext = { userId: "user-a", tenantId: "tenant-a" };
const NOW = new Date("2026-09-02T12:00:00.000Z");
const ENVIRONMENT = {
  PLIVO_AUTH_ID: "synthetic-auth-id",
  PLIVO_AUTH_TOKEN: "synthetic-token",
  PLIVO_TEST_CALL_DESTINATION: "+14155550123",
};
const READY_SETTINGS = {
  clinicId: "clinic-a",
  serviceStatus: "active",
  readiness: {
    phoneService: { status: "ready" },
    phoneMenu: { status: "ready" },
  },
};

function attempt(overrides: Record<string, unknown> = {}) {
  return {
    id: "test-call-a",
    clinicId: "clinic-a",
    requestedByUserId: "user-a",
    status: "REQUESTED",
    providerRequestUuid: null as string | null,
    providerCallUuid: null as string | null,
    destinationLast4: "0123",
    activeClinicId: "clinic-a",
    expiresAt: new Date(NOW.getTime() + 300_000),
    answeredAt: null,
    completedAt: null,
    failureCategory: null,
    createdAt: NOW,
    updatedAt: NOW,
    clinic: { name: "Sharma Clinic" },
    ...overrides,
  };
}

describe("controlled telephony test-call service", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.assertManage.mockResolvedValue(undefined);
    mocks.getPhoneSettings.mockResolvedValue(READY_SETTINGS);
    mocks.configFindUnique.mockResolvedValue({
      enabled: true,
      plivoNumber: "+919000000001",
    });
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findFirst.mockResolvedValue(null);
    mocks.count.mockResolvedValue(0);
    mocks.create.mockResolvedValue(attempt());
    mocks.update.mockImplementation(async ({ data }) => attempt(data));
    mocks.writeAudit.mockResolvedValue(undefined);
    mocks.transaction.mockImplementation(async (callback) =>
      callback({
        clinicTelephonyTestCall: {
          findFirst: mocks.findFirst,
          findUnique: mocks.findUnique,
          count: mocks.count,
          create: mocks.create,
          update: mocks.update,
          updateMany: mocks.updateMany,
        },
      }),
    );
  });

  it("creates one audited attempt and calls only the injected approved destination", async () => {
    const provider = {
      createTestCall: vi
        .fn()
        .mockResolvedValue({ requestUuid: "provider-request-a" }),
    };
    const result = await startTelephonyTestCallForActor(
      ACTOR,
      "clinic-a",
      "https://internal.example/api/clinics/clinic-a/telephony/test-call",
      { now: NOW, environment: ENVIRONMENT, provider },
    );

    expect(provider.createTestCall).toHaveBeenCalledWith({
      from: "+919000000001",
      to: "+14155550123",
      answerUrl:
        "https://internal.example/api/webhooks/plivo/test-call/answer?testCallId=test-call-a",
      ringUrl:
        "https://internal.example/api/webhooks/plivo/test-call/status?testCallId=test-call-a",
      hangupUrl:
        "https://internal.example/api/webhooks/plivo/test-call/status?testCallId=test-call-a",
      timeLimitSeconds: 120,
      ringLimitSeconds: 30,
    });
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clinicId: "clinic-a",
        requestedByUserId: "user-a",
        destinationLast4: "0123",
        activeClinicId: "clinic-a",
      }),
    });
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.anything(),
      {
        action: "CLINIC_TELEPHONY_TEST_CALL_STARTED",
        targetType: "ClinicTelephonyTestCall",
        targetId: "test-call-a",
        actorUserId: "user-a",
        actorTenantId: "tenant-a",
        afterValue: { clinicId: "clinic-a" },
      },
    );
    expect(JSON.stringify(result)).not.toMatch(
      /919000000001|14155550123|provider-request-a|auth|token/i,
    );
    expect(result.destinationLabel).toBe("Test number ending in 0123");
  });

  it.each([
    ["wrong tenant or clinic scope", new ScopeError()],
    ["clinic:read or settings:view without clinic:edit", new PermissionError("clinic:edit")],
  ])("rejects %s before database or provider work", async (_name, error) => {
    mocks.assertManage.mockRejectedValueOnce(error);
    const provider = { createTestCall: vi.fn() };
    await expect(
      startTelephonyTestCallForActor(
        ACTOR,
        "clinic-other",
        "https://app.example/api/test",
        { now: NOW, environment: ENVIRONMENT, provider },
      ),
    ).rejects.toBe(error);
    expect(mocks.configFindUnique).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(provider.createTestCall).not.toHaveBeenCalled();
  });

  it.each([
    ["missing destination", { PLIVO_AUTH_ID: "a", PLIVO_AUTH_TOKEN: "b" }],
    [
      "missing credentials",
      { PLIVO_TEST_CALL_DESTINATION: "+14155550123" },
    ],
  ])("fails closed for %s before persistence or provider use", async (_name, environment) => {
    const provider = { createTestCall: vi.fn() };
    await expect(
      startTelephonyTestCallForActor(
        ACTOR,
        "clinic-a",
        "https://app.example/api/test",
        { now: NOW, environment, provider },
      ),
    ).rejects.toEqual(
      new BadRequestError("Test calling is not available in this environment."),
    );
    expect(mocks.create).not.toHaveBeenCalled();
    expect(provider.createTestCall).not.toHaveBeenCalled();
  });

  it("rejects inactive or unprovisioned telephony before creating an attempt", async () => {
    mocks.getPhoneSettings.mockResolvedValueOnce({
      ...READY_SETTINGS,
      serviceStatus: "disabled",
      readiness: {
        ...READY_SETTINGS.readiness,
        phoneService: { status: "inactive" },
      },
    });
    await expect(
      startTelephonyTestCallForActor(
        ACTOR,
        "clinic-a",
        "https://app.example/api/test",
        { now: NOW, environment: ENVIRONMENT, provider: { createTestCall: vi.fn() } },
      ),
    ).rejects.toThrow("Phone service must be active");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("fails closed when the deployment QA destination would call the provider number", async () => {
    mocks.configFindUnique.mockResolvedValueOnce({
      enabled: true,
      plivoNumber: "+14155550123",
    });
    const provider = { createTestCall: vi.fn() };
    await expect(
      startTelephonyTestCallForActor(
        ACTOR,
        "clinic-a",
        "https://app.example/api/test",
        { now: NOW, environment: ENVIRONMENT, provider },
      ),
    ).rejects.toEqual(
      new BadRequestError("Test calling is not available in this environment."),
    );
    expect(provider.createTestCall).not.toHaveBeenCalled();
  });

  it("enforces one active attempt per clinic", async () => {
    mocks.findFirst.mockResolvedValue(attempt());
    await expect(
      startTelephonyTestCallForActor(
        ACTOR,
        "clinic-a",
        "https://app.example/api/test",
        { now: NOW, environment: ENVIRONMENT, provider: { createTestCall: vi.fn() } },
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("enforces the two-minute cooldown", async () => {
    mocks.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        attempt({ status: "FAILED", activeClinicId: null }),
      );
    await expect(
      startTelephonyTestCallForActor(
        ACTOR,
        "clinic-a",
        "https://app.example/api/test",
        { now: NOW, environment: ENVIRONMENT, provider: { createTestCall: vi.fn() } },
      ),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it("enforces both clinic and requester daily limits", async () => {
    mocks.count
      .mockResolvedValueOnce(TELEPHONY_TEST_CALL_DAILY_LIMIT)
      .mockResolvedValueOnce(TELEPHONY_TEST_CALL_DAILY_LIMIT);
    await expect(
      startTelephonyTestCallForActor(
        ACTOR,
        "clinic-a",
        "https://app.example/api/test",
        { now: NOW, environment: ENVIRONMENT, provider: { createTestCall: vi.fn() } },
      ),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it("maps the database active-key race to a safe conflict", async () => {
    mocks.create.mockRejectedValueOnce({ code: "P2002" });
    await expect(
      startTelephonyTestCallForActor(
        ACTOR,
        "clinic-a",
        "https://app.example/api/test",
        { now: NOW, environment: ENVIRONMENT, provider: { createTestCall: vi.fn() } },
      ),
    ).rejects.toEqual(
      new ConflictError("A test call is already in progress for this clinic."),
    );
  });

  it("marks a provider failure terminal without exposing the provider error", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const provider = {
      createTestCall: vi.fn().mockRejectedValue(new Error("raw provider body")),
    };
    await expect(
      startTelephonyTestCallForActor(
        ACTOR,
        "clinic-a",
        "https://app.example/api/test",
        { now: NOW, environment: ENVIRONMENT, provider },
      ),
    ).rejects.toBeInstanceOf(TelephonyTestCallProviderError);
    expect(mocks.updateMany).toHaveBeenLastCalledWith({
      where: { id: "test-call-a", activeClinicId: "clinic-a" },
      data: expect.objectContaining({
        status: "FAILED",
        failureCategory: "PROVIDER_ERROR",
        activeClinicId: null,
      }),
    });
    expect(consoleError).toHaveBeenCalledWith(
      "Plivo test call provider request failed.",
      {
        clinicId: "clinic-a",
        testCallId: "test-call-a",
        errorType: "Error",
      },
    );
    consoleError.mockRestore();
  });

  it("returns a disabled masked panel instead of throwing for inactive service", async () => {
    mocks.getPhoneSettings.mockResolvedValueOnce({
      ...READY_SETTINGS,
      serviceStatus: "not-provisioned",
    });
    const panel = await getTelephonyTestCallPanelForActor(ACTOR, "clinic-a", {
      now: NOW,
      environment: ENVIRONMENT,
    });
    expect(panel).toEqual({
      available: false,
      destinationLabel: "Test number ending in 0123",
      unavailableReason:
        "Phone service must be active before its menu can be tested.",
      latestAttempt: null,
    });
  });

  it("scopes status reads by actor, URL clinic, and attempt", async () => {
    mocks.findFirst.mockResolvedValueOnce(attempt({ status: "COMPLETED" }));
    const view = await getTelephonyTestCallForActor(
      ACTOR,
      "clinic-a",
      "test-call-a",
      NOW,
    );
    expect(mocks.assertManage).toHaveBeenCalledWith(ACTOR, "clinic-a");
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { id: "test-call-a", clinicId: "clinic-a" },
    });
    expect(view.status).toBe("COMPLETED");
    mocks.findFirst.mockResolvedValueOnce(null);
    await expect(
      getTelephonyTestCallForActor(ACTOR, "clinic-b", "test-call-a", NOW),
    ).rejects.toBeInstanceOf(ScopeError);
  });
});

describe("test-call callback correlation and monotonic lifecycle", () => {
  let row: ReturnType<typeof attempt>;

  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    row = attempt();
    mocks.transaction.mockImplementation(async (callback) =>
      callback({
        clinicTelephonyTestCall: {
          findUnique: mocks.findUnique,
          update: mocks.update,
          updateMany: mocks.updateMany,
        },
      }),
    );
    mocks.findUnique.mockImplementation(async () => ({ ...row }));
    mocks.updateMany.mockImplementation(async ({ data }) => {
      Object.assign(row, data);
      return { count: 1 };
    });
    mocks.update.mockImplementation(async ({ data }) => {
      Object.assign(row, data);
      return { ...row };
    });
  });

  it("binds the first valid CallUUID and marks the attempt answered", async () => {
    const context = await bindAndTransitionTelephonyTestCallCallback({
      testCallId: "test-call-a",
      callUuid: "call-uuid-a",
      transition: { kind: "answered" },
      now: NOW,
    });
    expect(row.providerCallUuid).toBe("call-uuid-a");
    expect(row.status).toBe("ANSWERED");
    expect(row.answeredAt).toEqual(NOW);
    expect(context.clinicId).toBe("clinic-a");
  });

  it("rejects a later mismatched CallUUID and RequestUUID", async () => {
    row.providerCallUuid = "call-uuid-a";
    row.providerRequestUuid = "request-uuid-a";
    await expect(
      bindAndTransitionTelephonyTestCallCallback({
        testCallId: "test-call-a",
        callUuid: "call-uuid-b",
        requestUuid: "request-uuid-a",
        transition: { kind: "none" },
      }),
    ).rejects.toEqual(new TelephonyTestCallCallbackError(403));
    await expect(
      bindAndTransitionTelephonyTestCallCallback({
        testCallId: "test-call-a",
        callUuid: "call-uuid-a",
        requestUuid: "request-uuid-b",
        transition: { kind: "none" },
      }),
    ).rejects.toEqual(new TelephonyTestCallCallbackError(403));
  });

  it("does not regress ANSWERED when a late ring callback arrives", async () => {
    row.status = "ANSWERED";
    row.providerCallUuid = "call-uuid-a";
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    await bindAndTransitionTelephonyTestCallCallback({
      testCallId: "test-call-a",
      callUuid: "call-uuid-a",
      transition: { kind: "ringing" },
      now: NOW,
    });
    expect(row.status).toBe("ANSWERED");
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: "test-call-a",
        activeClinicId: "clinic-a",
        status: "REQUESTED",
      },
      data: { status: "RINGING" },
    });
  });

  it("makes duplicate terminal callbacks idempotent", async () => {
    row.providerCallUuid = "call-uuid-a";
    await bindAndTransitionTelephonyTestCallCallback({
      testCallId: "test-call-a",
      callUuid: "call-uuid-a",
      transition: { kind: "completed" },
      now: NOW,
    });
    const second = await bindAndTransitionTelephonyTestCallCallback({
      testCallId: "test-call-a",
      callUuid: "call-uuid-a",
      transition: { kind: "completed" },
      now: NOW,
    });
    expect(row.status).toBe("COMPLETED");
    expect(second.terminal).toBe(true);
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: "test-call-a",
        activeClinicId: "clinic-a",
        status: { in: ["REQUESTED", "RINGING", "ANSWERED"] },
      },
      data: { status: "COMPLETED", activeClinicId: null, completedAt: NOW },
    });
  });

  it("expires an active attempt without interpreting its callback", async () => {
    row.expiresAt = new Date(NOW.getTime() - 1);
    await expect(
      bindAndTransitionTelephonyTestCallCallback({
        testCallId: "test-call-a",
        callUuid: "call-uuid-a",
        transition: { kind: "answered" },
        now: NOW,
      }),
    ).rejects.toEqual(new TelephonyTestCallCallbackError(404));
    expect(row.status).toBe("FAILED");
    expect(row.activeClinicId).toBeNull();
  });

  it("rejects an unknown attempt without mutating callback state", async () => {
    mocks.findUnique.mockResolvedValueOnce(null);
    await expect(
      bindAndTransitionTelephonyTestCallCallback({
        testCallId: "unknown-attempt",
        callUuid: "call-uuid-a",
        transition: { kind: "answered" },
        now: NOW,
      }),
    ).rejects.toEqual(new TelephonyTestCallCallbackError(404));
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("maps only the closed provider status vocabulary", () => {
    expect(resolveTelephonyTestCallStatusTransition({ Event: "Ring" })).toEqual({
      kind: "ringing",
    });
    expect(
      resolveTelephonyTestCallStatusTransition({ CallStatus: "busy" }),
    ).toEqual({ kind: "failed", failureCategory: "BUSY" });
    expect(
      resolveTelephonyTestCallStatusTransition({ CallStatus: "no-answer" }),
    ).toEqual({ kind: "failed", failureCategory: "NO_ANSWER" });
    expect(
      resolveTelephonyTestCallStatusTransition({ CallStatus: "provider-new-state" }),
    ).toEqual({ kind: "none" });
  });
});
