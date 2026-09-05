import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionError, ScopeError, type ActorContext } from "@/lib/rbac";

const mocks = vi.hoisted(() => ({
  assertCanManage: vi.fn(),
  prune: vi.fn(),
  configFindUnique: vi.fn(),
  callFindMany: vi.fn(),
  callCount: vi.fn(),
}));

vi.mock("@/lib/telephony/access", () => ({
  assertActorCanManageTelephony: mocks.assertCanManage,
}));
vi.mock("@/lib/telephony/callObservability", () => ({
  pruneProductionCallDiagnosticsForClinic: mocks.prune,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    clinicTelephonyConfig: { findUnique: mocks.configFindUnique },
    clinicTelephonyCall: {
      findMany: mocks.callFindMany,
      count: mocks.callCount,
    },
  },
}));
vi.mock("@/lib/telephony/clinicConfig", () => ({
  DEFAULT_CLINIC_TIMEZONE: "Asia/Kolkata",
}));

import {
  PHONE_DIAGNOSTICS_INCOMPLETE_AFTER_MS,
  PHONE_DIAGNOSTICS_RECENT_LIMIT,
  PHONE_DIAGNOSTICS_WINDOW_HOURS,
  getPhoneDiagnosticsForActor,
} from "@/lib/telephony/callDiagnostics";

const ACTOR: ActorContext = { userId: "user-a", tenantId: "tenant-a" };
const NOW = new Date("2026-09-02T12:00:00.000Z");

function counts(recent: number, incomplete = 0, reception = 0, urgent = 0) {
  mocks.callCount
    .mockResolvedValueOnce(recent)
    .mockResolvedValueOnce(incomplete)
    .mockResolvedValueOnce(reception)
    .mockResolvedValueOnce(urgent);
}

describe("actor-scoped phone diagnostics", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.assertCanManage.mockResolvedValue(undefined);
    mocks.prune.mockResolvedValue(true);
    mocks.configFindUnique.mockResolvedValue({ timezone: "Asia/Kolkata" });
    mocks.callFindMany.mockResolvedValue([]);
  });

  it("returns a no-data health state when no production calls were observed", async () => {
    counts(0);
    const view = await getPhoneDiagnosticsForActor(ACTOR, "clinic-a", NOW);
    expect(view).toEqual({
      window: { hours: 24 },
      timezone: "Asia/Kolkata",
      health: {
        status: "no-data",
        recentCalls: 0,
        incompleteCalls: 0,
        receptionFailures: 0,
        urgentTransferFailures: 0,
      },
      recentCalls: [],
    });
    expect(mocks.assertCanManage).toHaveBeenCalledWith(ACTOR, "clinic-a");
    expect(mocks.prune).toHaveBeenCalledWith("clinic-a", NOW);
  });

  it("returns healthy sanitized recent activity in clinic timezone", async () => {
    counts(1);
    mocks.callFindMany.mockResolvedValue([{
      id: "internal-row-a",
      callerNumber: "+919876544821",
      callerLast4: "4821",
      status: "COMPLETED",
      initialRoute: "IVR",
      startedAt: new Date("2026-09-02T10:00:00.000Z"),
      endedAt: new Date("2026-09-02T10:02:05.000Z"),
      durationSeconds: 125,
      events: [
        { eventType: "CALL_RECEIVED" },
        { eventType: "MAIN_MENU_APPOINTMENT_BOOKING" },
        { eventType: "BOOKING_FOLLOW_UP_CREATED" },
        { eventType: "CALL_COMPLETED" },
      ],
    }]);

    const view = await getPhoneDiagnosticsForActor(ACTOR, "clinic-a", NOW);
    expect(view.health.status).toBe("healthy");
    expect(view.recentCalls[0]).toEqual({
      id: "internal-row-a",
      startedAt: "2026-09-02T10:00:00.000Z",
      endedAt: "2026-09-02T10:02:05.000Z",
      durationSeconds: 125,
      callerNumber: "+919876544821",
      callerLabel: "9876544821",
      status: "COMPLETED",
      initialRoute: "IVR",
      highlights: [
        "Call received",
        "Appointment booking selected",
        "Booking follow-up requested",
        "Call ended",
      ],
    });
    const serialized = JSON.stringify(view);
    expect(serialized).not.toMatch(
      /providerCallUuid|providerNumber|receptionNumber|urgentNumber|Digits|patient|hangupCause/i,
    );
  });

  it("renders historical last-four-only rows without fabricating a number", async () => {
    counts(1);
    mocks.callFindMany.mockResolvedValue([{
      id: "historical-row",
      callerNumber: null,
      callerLast4: "4821",
      status: "COMPLETED",
      initialRoute: "IVR",
      startedAt: new Date("2026-09-02T10:00:00.000Z"),
      endedAt: new Date("2026-09-02T10:01:00.000Z"),
      durationSeconds: 60,
      events: [],
    }]);

    expect((await getPhoneDiagnosticsForActor(ACTOR, "clinic-a", NOW)).recentCalls[0])
      .toMatchObject({ callerNumber: null, callerLabel: "Caller ending in 4821" });
  });

  it.each([
    ["stale active call", 1, 1, 0, 0],
    ["reception issue", 1, 0, 1, 0],
    ["urgent transfer issue", 1, 0, 0, 1],
  ])("returns attention for a %s", async (_label, recent, incomplete, reception, urgent) => {
    counts(recent, incomplete, reception, urgent);
    expect((await getPhoneDiagnosticsForActor(ACTOR, "clinic-a", NOW)).health.status).toBe("attention");
  });

  it("derives INCOMPLETE only after ten minutes without mutating storage", async () => {
    counts(2, 1);
    mocks.callFindMany.mockResolvedValue([
      {
        id: "fresh",
        callerNumber: null,
        callerLast4: null,
        status: "ACTIVE",
        initialRoute: "RECEPTION",
        startedAt: new Date(NOW.getTime() - PHONE_DIAGNOSTICS_INCOMPLETE_AFTER_MS + 1),
        endedAt: null,
        durationSeconds: null,
        events: [],
      },
      {
        id: "stale",
        callerNumber: null,
        callerLast4: null,
        status: "ACTIVE",
        initialRoute: "IVR",
        startedAt: new Date(NOW.getTime() - PHONE_DIAGNOSTICS_INCOMPLETE_AFTER_MS),
        endedAt: null,
        durationSeconds: null,
        events: [],
      },
    ]);
    const view = await getPhoneDiagnosticsForActor(ACTOR, "clinic-a", NOW);
    expect(view.recentCalls.map((call) => call.status)).toEqual(["ACTIVE", "INCOMPLETE"]);
    expect(view.recentCalls[0].callerLabel).toBe("Caller number unavailable");
  });

  it("uses the exact clinic/window bounds and never combines All Clinics", async () => {
    counts(4);
    await getPhoneDiagnosticsForActor(ACTOR, "clinic-a", NOW);
    expect(mocks.callFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        clinicId: "clinic-a",
        startedAt: {
          gte: new Date(NOW.getTime() - PHONE_DIAGNOSTICS_WINDOW_HOURS * 60 * 60 * 1000),
        },
      },
      take: PHONE_DIAGNOSTICS_RECENT_LIMIT,
    }));
    for (const invocation of mocks.callCount.mock.calls) {
      expect(invocation[0].where.clinicId).toBe("clinic-a");
    }
  });

  it.each([new ScopeError(), new PermissionError("clinic:edit")])(
    "does not query or prune when the telephony boundary rejects access",
    async (error) => {
      mocks.assertCanManage.mockRejectedValueOnce(error);
      await expect(getPhoneDiagnosticsForActor(ACTOR, "clinic-b", NOW)).rejects.toBe(error);
      expect(mocks.prune).not.toHaveBeenCalled();
      expect(mocks.callFindMany).not.toHaveBeenCalled();
    },
  );
});
