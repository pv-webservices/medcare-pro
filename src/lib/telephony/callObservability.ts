import {
  ClinicTelephonyCallEventType,
  type ClinicTelephonyCallInitialRoute,
  type ClinicTelephonyCallMenuSource,
  type ClinicTelephonyRoutingMode,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizePlivoCallUuid } from "@/lib/telephony/bookingIdentity";
import { normalizePlivoCallerNumber } from "@/lib/telephony/phoneNumber";
import type { MainMenuAction } from "@/lib/telephony/routing";

export const PRODUCTION_CALL_RETENTION_DAYS = 30;
export const PRODUCTION_CALL_RETENTION_MS =
  PRODUCTION_CALL_RETENTION_DAYS * 24 * 60 * 60 * 1000;
export const MAX_PRODUCTION_CALL_DURATION_SECONDS = 24 * 60 * 60;

type ObservabilityClient = Pick<
  typeof prisma,
  "clinicTelephonyCall" | "clinicTelephonyCallEvent"
>;

export type ProductionCallObservationResult =
  | "recorded"
  | "invalid-call"
  | "unknown-call"
  | "clinic-mismatch"
  | "write-failed";

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function safeObservabilityError(
  operation: string,
  callId?: string,
): void {
  console.error("Production call observability write failed.", {
    operation,
    ...(callId ? { callId } : {}),
  });
}

function uniqueEvents(
  events: readonly ClinicTelephonyCallEventType[],
): ClinicTelephonyCallEventType[] {
  return [...new Set(events)];
}

export function callerLast4(value: unknown): string | null {
  const caller = normalizePlivoCallerNumber(value);
  return caller ? caller.slice(-4) : null;
}

export function normalizeProductionCallDuration(
  value: unknown,
): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) return null;
  const duration = Number(value.trim());
  return Number.isSafeInteger(duration) &&
    duration >= 0 &&
    duration <= MAX_PRODUCTION_CALL_DURATION_SECONDS
    ? duration
    : null;
}

export function eventForMainMenuAction(
  action: MainMenuAction,
): ClinicTelephonyCallEventType {
  switch (action) {
    case "tomorrow-slots":
      return ClinicTelephonyCallEventType.MAIN_MENU_TOMORROW_SLOTS;
    case "appointment-booking":
      return ClinicTelephonyCallEventType.MAIN_MENU_APPOINTMENT_BOOKING;
    case "urgent-assistance":
      return ClinicTelephonyCallEventType.MAIN_MENU_URGENT_ASSISTANCE;
    case "clinic-information":
      return ClinicTelephonyCallEventType.MAIN_MENU_CLINIC_INFORMATION;
    case "repeat-menu":
      return ClinicTelephonyCallEventType.MAIN_MENU_REPEAT;
    case "invalid-input":
      return ClinicTelephonyCallEventType.MAIN_MENU_INVALID_INPUT;
  }
}

/** Clinic-scoped and best-effort: one clinic's traffic never prunes another. */
export async function pruneProductionCallDiagnosticsForClinic(
  clinicId: string,
  now = new Date(),
  client: ObservabilityClient = prisma,
): Promise<boolean> {
  try {
    await client.clinicTelephonyCall.deleteMany({
      where: {
        clinicId,
        startedAt: {
          lt: new Date(now.getTime() - PRODUCTION_CALL_RETENTION_MS),
        },
      },
    });
    return true;
  } catch {
    safeObservabilityError("retention-prune");
    return false;
  }
}

/**
 * Establishes the production-call record only after the route has already
 * verified V3, resolved validated `To`, and selected the canonical route.
 * Every failure is contained so telemetry cannot replace valid call XML.
 */
export async function observeInboundProductionCall(input: {
  clinicId: string;
  providerCallUuid: unknown;
  callerNumber: unknown;
  routingModeAtStart: ClinicTelephonyRoutingMode;
  initialRoute: ClinicTelephonyCallInitialRoute;
  phoneMenuSource?: ClinicTelephonyCallMenuSource | null;
  events: readonly ClinicTelephonyCallEventType[];
  now?: Date;
  client?: ObservabilityClient;
}): Promise<ProductionCallObservationResult> {
  const providerCallUuid = normalizePlivoCallUuid(input.providerCallUuid);
  if (!providerCallUuid) return "invalid-call";
  const now = input.now ?? new Date();
  const client = input.client ?? prisma;
  await pruneProductionCallDiagnosticsForClinic(input.clinicId, now, client);

  try {
    const events = uniqueEvents([
      ClinicTelephonyCallEventType.CALL_RECEIVED,
      ...input.events,
    ]);
    await client.clinicTelephonyCall.create({
      data: {
        clinicId: input.clinicId,
        providerCallUuid,
        callerLast4: callerLast4(input.callerNumber),
        routingModeAtStart: input.routingModeAtStart,
        initialRoute: input.initialRoute,
        phoneMenuSource: input.phoneMenuSource ?? null,
        startedAt: now,
        lastActivityAt: now,
        events: {
          create: events.map((eventType) => ({ eventType, occurredAt: now })),
        },
      },
      select: { id: true },
    });
    return "recorded";
  } catch (error: unknown) {
    if (!isUniqueConstraintError(error)) {
      safeObservabilityError("call-create");
      return "write-failed";
    }
    try {
      const existing = await client.clinicTelephonyCall.findUnique({
        where: { providerCallUuid },
        select: { id: true, clinicId: true },
      });
      if (!existing) return "write-failed";
      if (existing.clinicId !== input.clinicId) return "clinic-mismatch";
      await client.clinicTelephonyCall.update({
        where: { id: existing.id },
        data: { lastActivityAt: now },
        select: { id: true },
      });
      return "recorded";
    } catch {
      safeObservabilityError("call-retry");
      return "write-failed";
    }
  }
}

/** Records first-occurrence semantic events for a previously observed call. */
export async function observeProductionCallEvents(input: {
  clinicId: string;
  providerCallUuid: unknown;
  events: readonly ClinicTelephonyCallEventType[];
  phoneMenuSource?: ClinicTelephonyCallMenuSource;
  now?: Date;
  client?: ObservabilityClient;
}): Promise<ProductionCallObservationResult> {
  const providerCallUuid = normalizePlivoCallUuid(input.providerCallUuid);
  if (!providerCallUuid) return "invalid-call";
  const client = input.client ?? prisma;
  const now = input.now ?? new Date();

  try {
    const call = await client.clinicTelephonyCall.findUnique({
      where: { providerCallUuid },
      select: { id: true, clinicId: true },
    });
    if (!call) return "unknown-call";
    if (call.clinicId !== input.clinicId) return "clinic-mismatch";
    await client.clinicTelephonyCall.update({
      where: { id: call.id },
      data: {
        lastActivityAt: now,
        ...(input.phoneMenuSource
          ? { phoneMenuSource: input.phoneMenuSource }
          : {}),
      },
      select: { id: true },
    });
    const events = uniqueEvents(input.events);
    if (events.length > 0) {
      await client.clinicTelephonyCallEvent.createMany({
        data: events.map((eventType) => ({
          callId: call.id,
          eventType,
          occurredAt: now,
        })),
        skipDuplicates: true,
      });
    }
    return "recorded";
  } catch {
    safeObservabilityError("event-create");
    return "write-failed";
  }
}

/** Completes only the call matching both the signed clinic and CallUUID. */
export async function completeObservedProductionCall(input: {
  clinicId: string;
  providerCallUuid: unknown;
  duration: unknown;
  now?: Date;
  client?: ObservabilityClient;
}): Promise<ProductionCallObservationResult> {
  const providerCallUuid = normalizePlivoCallUuid(input.providerCallUuid);
  if (!providerCallUuid) return "invalid-call";
  const client = input.client ?? prisma;
  const now = input.now ?? new Date();

  try {
    const call = await client.clinicTelephonyCall.findUnique({
      where: { providerCallUuid },
      select: { id: true, clinicId: true, status: true },
    });
    if (!call) return "unknown-call";
    if (call.clinicId !== input.clinicId) return "clinic-mismatch";
    if (call.status === "ACTIVE") {
      await client.clinicTelephonyCall.updateMany({
        where: { id: call.id, clinicId: input.clinicId, status: "ACTIVE" },
        data: {
          status: "COMPLETED",
          endedAt: now,
          lastActivityAt: now,
          durationSeconds: normalizeProductionCallDuration(input.duration),
        },
      });
    }
    await client.clinicTelephonyCallEvent.createMany({
      data: [
        {
          callId: call.id,
          eventType: ClinicTelephonyCallEventType.CALL_COMPLETED,
          occurredAt: now,
        },
      ],
      skipDuplicates: true,
    });
    return "recorded";
  } catch {
    safeObservabilityError("call-complete");
    return "write-failed";
  }
}
