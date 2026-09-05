import {
  ClinicTelephonyCallEventType,
  ClinicTelephonyCallInitialRoute,
  ClinicTelephonyCallMenuSource,
  ClinicTelephonyRoutingMode,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_PRODUCTION_CALL_DURATION_SECONDS,
  PRODUCTION_CALL_RETENTION_MS,
  callerLast4,
  completeObservedProductionCall,
  eventForMainMenuAction,
  normalizeProductionCallDuration,
  observeInboundProductionCall,
  observeProductionCallEvents,
  pruneProductionCallDiagnosticsForClinic,
} from "@/lib/telephony/callObservability";

function createClient() {
  return {
    clinicTelephonyCall: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    clinicTelephonyCallEvent: {
      createMany: vi.fn(),
    },
  };
}

const NOW = new Date("2026-09-02T12:00:00.000Z");
const CALL_UUID = "4f7b0f40-4c0a-11ef-b5d8-0242ac120002";

describe("production call observability", () => {
  beforeEach(() => vi.restoreAllMocks());

  it.each([
    ["+919876543210", "3210"],
    ["919876543210", "3210"],
    ["not-a-number", null],
    ["9876543210", "3210"],
    [null, null],
  ])("stores only the safe last four digits for %j", (value, expected) => {
    expect(callerLast4(value)).toBe(expected);
  });

  it.each([
    ["0", 0],
    ["45", 45],
    [String(MAX_PRODUCTION_CALL_DURATION_SECONDS), MAX_PRODUCTION_CALL_DURATION_SECONDS],
    ["-1", null],
    ["1.5", null],
    [String(MAX_PRODUCTION_CALL_DURATION_SECONDS + 1), null],
    ["n/a", null],
    [undefined, null],
  ])("bounds provider duration %j", (value, expected) => {
    expect(normalizeProductionCallDuration(value)).toBe(expected);
  });

  it("maps every main-menu result to a closed semantic event", () => {
    expect([
      eventForMainMenuAction("tomorrow-slots"),
      eventForMainMenuAction("appointment-booking"),
      eventForMainMenuAction("urgent-assistance"),
      eventForMainMenuAction("clinic-information"),
      eventForMainMenuAction("repeat-menu"),
      eventForMainMenuAction("invalid-input"),
    ]).toEqual([
      "MAIN_MENU_TOMORROW_SLOTS",
      "MAIN_MENU_APPOINTMENT_BOOKING",
      "MAIN_MENU_URGENT_ASSISTANCE",
      "MAIN_MENU_CLINIC_INFORMATION",
      "MAIN_MENU_REPEAT",
      "MAIN_MENU_INVALID_INPUT",
    ]);
  });

  it("stores the normalized caller number and first-occurrence events", async () => {
    const client = createClient();
    client.clinicTelephonyCall.deleteMany.mockResolvedValue({ count: 0 });
    client.clinicTelephonyCall.create.mockResolvedValue({ id: "call-row-a" });

    await expect(observeInboundProductionCall({
      clinicId: "clinic-a",
      providerCallUuid: CALL_UUID,
      callerNumber: "+919876543210",
      routingModeAtStart: ClinicTelephonyRoutingMode.AUTO,
      initialRoute: ClinicTelephonyCallInitialRoute.IVR,
      phoneMenuSource: ClinicTelephonyCallMenuSource.CUSTOM,
      events: [
        ClinicTelephonyCallEventType.ROUTED_TO_IVR,
        ClinicTelephonyCallEventType.ROUTED_TO_IVR,
      ],
      now: NOW,
      client: client as never,
    })).resolves.toBe("recorded");

    const data = client.clinicTelephonyCall.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      clinicId: "clinic-a",
      providerCallUuid: CALL_UUID,
      callerNumber: "+919876543210",
      callerLast4: "3210",
      routingModeAtStart: "AUTO",
      initialRoute: "IVR",
      phoneMenuSource: "CUSTOM",
    });
    expect(data.events.create.map((event: { eventType: string }) => event.eventType)).toEqual([
      "CALL_RECEIVED",
      "ROUTED_TO_IVR",
    ]);
    expect(data).not.toHaveProperty("from");
  });

  it("never persists malformed provider caller input as a phone number", async () => {
    const client = createClient();
    client.clinicTelephonyCall.deleteMany.mockResolvedValue({ count: 0 });
    client.clinicTelephonyCall.create.mockResolvedValue({ id: "call-row-a" });

    await observeInboundProductionCall({
      clinicId: "clinic-a",
      providerCallUuid: CALL_UUID,
      callerNumber: "caller=+91 98765 43210",
      routingModeAtStart: ClinicTelephonyRoutingMode.AUTO,
      initialRoute: ClinicTelephonyCallInitialRoute.IVR,
      events: [],
      now: NOW,
      client: client as never,
    });

    expect(client.clinicTelephonyCall.create.mock.calls[0][0].data).toMatchObject({
      callerNumber: null,
      callerLast4: null,
    });
  });

  it("ignores malformed CallUUID without touching storage", async () => {
    const client = createClient();
    await expect(observeInboundProductionCall({
      clinicId: "clinic-a",
      providerCallUuid: "short",
      callerNumber: "+919876543210",
      routingModeAtStart: ClinicTelephonyRoutingMode.AUTO,
      initialRoute: ClinicTelephonyCallInitialRoute.IVR,
      events: [],
      client: client as never,
    })).resolves.toBe("invalid-call");
    expect(client.clinicTelephonyCall.deleteMany).not.toHaveBeenCalled();
    expect(client.clinicTelephonyCall.create).not.toHaveBeenCalled();
  });

  it("deduplicates retried Answer callbacks and verifies clinic ownership", async () => {
    const client = createClient();
    client.clinicTelephonyCall.deleteMany.mockResolvedValue({ count: 0 });
    client.clinicTelephonyCall.create.mockRejectedValue({ code: "P2002" });
    client.clinicTelephonyCall.findUnique.mockResolvedValue({
      id: "call-row-a",
      clinicId: "clinic-a",
    });
    client.clinicTelephonyCall.update.mockResolvedValue({ id: "call-row-a" });

    await expect(observeInboundProductionCall({
      clinicId: "clinic-a",
      providerCallUuid: CALL_UUID,
      callerNumber: "+919876543210",
      routingModeAtStart: ClinicTelephonyRoutingMode.OPEN,
      initialRoute: ClinicTelephonyCallInitialRoute.RECEPTION,
      events: [ClinicTelephonyCallEventType.ROUTED_TO_RECEPTION],
      now: NOW,
      client: client as never,
    })).resolves.toBe("recorded");
    expect(client.clinicTelephonyCall.update).toHaveBeenCalledWith({
      where: { id: "call-row-a" },
      data: { lastActivityAt: NOW },
      select: { id: true },
    });

    client.clinicTelephonyCall.findUnique.mockResolvedValueOnce({
      id: "call-row-b",
      clinicId: "clinic-b",
    });
    await expect(observeInboundProductionCall({
      clinicId: "clinic-a",
      providerCallUuid: CALL_UUID,
      callerNumber: null,
      routingModeAtStart: ClinicTelephonyRoutingMode.AUTO,
      initialRoute: ClinicTelephonyCallInitialRoute.IVR,
      events: [],
      client: client as never,
    })).resolves.toBe("clinic-mismatch");
    expect(client.clinicTelephonyCall.update).toHaveBeenCalledTimes(1);
  });

  it("contains call and event persistence failures", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const client = createClient();
    client.clinicTelephonyCall.deleteMany.mockRejectedValue(new Error("offline"));
    client.clinicTelephonyCall.create.mockRejectedValue(new Error("offline"));
    await expect(observeInboundProductionCall({
      clinicId: "clinic-a",
      providerCallUuid: CALL_UUID,
      callerNumber: "+919876543210",
      routingModeAtStart: ClinicTelephonyRoutingMode.AUTO,
      initialRoute: ClinicTelephonyCallInitialRoute.IVR,
      events: [],
      client: client as never,
    })).resolves.toBe("write-failed");

    client.clinicTelephonyCall.findUnique.mockRejectedValue(new Error("offline"));
    await expect(observeProductionCallEvents({
      clinicId: "clinic-a",
      providerCallUuid: CALL_UUID,
      events: [ClinicTelephonyCallEventType.MAIN_MENU_CLINIC_INFORMATION],
      client: client as never,
    })).resolves.toBe("write-failed");
  });

  it("records semantic events once against a same-clinic call", async () => {
    const client = createClient();
    client.clinicTelephonyCall.findUnique.mockResolvedValue({
      id: "call-row-a",
      clinicId: "clinic-a",
    });
    client.clinicTelephonyCall.update.mockResolvedValue({ id: "call-row-a" });
    client.clinicTelephonyCallEvent.createMany.mockResolvedValue({ count: 1 });

    await expect(observeProductionCallEvents({
      clinicId: "clinic-a",
      providerCallUuid: CALL_UUID,
      events: [
        ClinicTelephonyCallEventType.MAIN_MENU_CLINIC_INFORMATION,
        ClinicTelephonyCallEventType.MAIN_MENU_CLINIC_INFORMATION,
      ],
      now: NOW,
      client: client as never,
    })).resolves.toBe("recorded");
    expect(client.clinicTelephonyCallEvent.createMany).toHaveBeenCalledWith({
      data: [{
        callId: "call-row-a",
        eventType: "MAIN_MENU_CLINIC_INFORMATION",
        occurredAt: NOW,
      }],
      skipDuplicates: true,
    });
    expect(JSON.stringify(client.clinicTelephonyCallEvent.createMany.mock.calls)).not.toContain("Digits");
  });

  it("does not add events to unknown or cross-clinic calls", async () => {
    const client = createClient();
    client.clinicTelephonyCall.findUnique.mockResolvedValueOnce(null);
    await expect(observeProductionCallEvents({
      clinicId: "clinic-a",
      providerCallUuid: CALL_UUID,
      events: [ClinicTelephonyCallEventType.RECEPTION_FAILED],
      client: client as never,
    })).resolves.toBe("unknown-call");
    client.clinicTelephonyCall.findUnique.mockResolvedValueOnce({
      id: "call-row-b",
      clinicId: "clinic-b",
    });
    await expect(observeProductionCallEvents({
      clinicId: "clinic-a",
      providerCallUuid: CALL_UUID,
      events: [ClinicTelephonyCallEventType.RECEPTION_FAILED],
      client: client as never,
    })).resolves.toBe("clinic-mismatch");
    expect(client.clinicTelephonyCallEvent.createMany).not.toHaveBeenCalled();
  });

  it("completes a call idempotently with a bounded duration", async () => {
    const client = createClient();
    client.clinicTelephonyCall.findUnique.mockResolvedValue({
      id: "call-row-a",
      clinicId: "clinic-a",
      status: "ACTIVE",
    });
    client.clinicTelephonyCall.updateMany.mockResolvedValue({ count: 1 });
    client.clinicTelephonyCallEvent.createMany.mockResolvedValue({ count: 1 });

    await expect(completeObservedProductionCall({
      clinicId: "clinic-a",
      providerCallUuid: CALL_UUID,
      duration: "125",
      now: NOW,
      client: client as never,
    })).resolves.toBe("recorded");
    expect(client.clinicTelephonyCall.updateMany).toHaveBeenCalledWith({
      where: { id: "call-row-a", clinicId: "clinic-a", status: "ACTIVE" },
      data: {
        status: "COMPLETED",
        endedAt: NOW,
        lastActivityAt: NOW,
        durationSeconds: 125,
      },
    });
    expect(client.clinicTelephonyCallEvent.createMany).toHaveBeenCalledWith({
      data: [{
        callId: "call-row-a",
        eventType: "CALL_COMPLETED",
        occurredAt: NOW,
      }],
      skipDuplicates: true,
    });

    client.clinicTelephonyCall.findUnique.mockResolvedValueOnce({
      id: "call-row-a",
      clinicId: "clinic-a",
      status: "COMPLETED",
    });
    await completeObservedProductionCall({
      clinicId: "clinic-a",
      providerCallUuid: CALL_UUID,
      duration: "999",
      client: client as never,
    });
    expect(client.clinicTelephonyCall.updateMany).toHaveBeenCalledTimes(1);
  });

  it("prunes only old rows in the requested clinic", async () => {
    const client = createClient();
    client.clinicTelephonyCall.deleteMany.mockResolvedValue({ count: 2 });
    await expect(pruneProductionCallDiagnosticsForClinic(
      "clinic-a",
      NOW,
      client as never,
    )).resolves.toBe(true);
    expect(client.clinicTelephonyCall.deleteMany).toHaveBeenCalledWith({
      where: {
        clinicId: "clinic-a",
        startedAt: { lt: new Date(NOW.getTime() - PRODUCTION_CALL_RETENTION_MS) },
      },
    });
  });
});
