import { ClinicTelephonyCallEventType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ActorContext } from "@/lib/rbac";
import { assertActorCanManageTelephony } from "@/lib/telephony/access";
import {
  type PhoneDiagnosticsView,
  type ProductionCallDiagnosticView,
} from "@/lib/telephony/callDiagnosticsContract";
import { DEFAULT_CLINIC_TIMEZONE } from "@/lib/telephony/clinicConfig";
import { pruneProductionCallDiagnosticsForClinic } from "@/lib/telephony/callObservability";

export const PHONE_DIAGNOSTICS_WINDOW_HOURS = 24;
export const PHONE_DIAGNOSTICS_RECENT_LIMIT = 10;
export const PHONE_DIAGNOSTICS_INCOMPLETE_AFTER_MS = 10 * 60 * 1000;

const EVENT_LABELS: Readonly<Record<ClinicTelephonyCallEventType, string>> = {
  CALL_RECEIVED: "Call received",
  ROUTED_TO_RECEPTION: "Routed to reception",
  ROUTED_TO_IVR: "Routed to phone menu",
  MAIN_MENU_TOMORROW_SLOTS: "Tomorrow's availability selected",
  MAIN_MENU_APPOINTMENT_BOOKING: "Appointment booking selected",
  MAIN_MENU_URGENT_ASSISTANCE: "Urgent assistance selected",
  MAIN_MENU_CLINIC_INFORMATION: "Clinic information selected",
  MAIN_MENU_REPEAT: "Phone menu repeated",
  MAIN_MENU_INVALID_INPUT: "Invalid menu selection",
  MENU_REVISION_REFRESHED: "Updated phone menu replayed",
  APPOINTMENTS_UNAVAILABLE: "Appointments unavailable",
  RECEPTION_CONNECTED: "Reception connected",
  RECEPTION_FAILED: "Reception connection failed",
  RECEPTION_FALLBACK_TO_IVR: "Continued in phone menu",
  URGENT_TRANSFER_CONNECTED: "Urgent transfer connected",
  URGENT_TRANSFER_FAILED: "Urgent transfer failed",
  URGENT_TRANSFER_UNAVAILABLE: "Urgent transfer unavailable",
  BOOKING_FOLLOW_UP_CREATED: "Booking follow-up requested",
  CALL_COMPLETED: "Call ended",
};

function toCallView(
  call: {
    id: string;
    callerLast4: string | null;
    status: "ACTIVE" | "COMPLETED";
    initialRoute: "RECEPTION" | "IVR" | null;
    startedAt: Date;
    endedAt: Date | null;
    durationSeconds: number | null;
    events: readonly { eventType: ClinicTelephonyCallEventType }[];
  },
  staleBefore: Date,
): ProductionCallDiagnosticView {
  const status =
    call.status === "ACTIVE" && call.startedAt <= staleBefore
      ? "INCOMPLETE"
      : call.status;
  return Object.freeze({
    id: call.id,
    startedAt: call.startedAt.toISOString(),
    endedAt: call.endedAt?.toISOString() ?? null,
    durationSeconds: call.durationSeconds,
    callerLabel: call.callerLast4
      ? `Caller ending in ${call.callerLast4}`
      : "Caller number unavailable",
    status,
    initialRoute: call.initialRoute,
    highlights: Object.freeze(
      call.events.map((event) => EVENT_LABELS[event.eventType]),
    ),
  });
}

export async function getPhoneDiagnosticsForActor(
  actor: ActorContext,
  clinicId: string,
  now = new Date(),
): Promise<PhoneDiagnosticsView> {
  await assertActorCanManageTelephony(actor, clinicId);
  await pruneProductionCallDiagnosticsForClinic(clinicId, now);

  const windowStart = new Date(
    now.getTime() - PHONE_DIAGNOSTICS_WINDOW_HOURS * 60 * 60 * 1000,
  );
  const staleBefore = new Date(
    now.getTime() - PHONE_DIAGNOSTICS_INCOMPLETE_AFTER_MS,
  );
  const [config, recentCalls, recentCount, incompleteCalls, receptionFailures, urgentFailures] =
    await Promise.all([
      prisma.clinicTelephonyConfig.findUnique({
        where: { clinicId },
        select: { timezone: true },
      }),
      prisma.clinicTelephonyCall.findMany({
        where: { clinicId, startedAt: { gte: windowStart } },
        orderBy: [{ startedAt: "desc" }, { id: "desc" }],
        take: PHONE_DIAGNOSTICS_RECENT_LIMIT,
        select: {
          id: true,
          callerLast4: true,
          status: true,
          initialRoute: true,
          startedAt: true,
          endedAt: true,
          durationSeconds: true,
          events: {
            orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
            select: { eventType: true },
          },
        },
      }),
      prisma.clinicTelephonyCall.count({
        where: { clinicId, startedAt: { gte: windowStart } },
      }),
      prisma.clinicTelephonyCall.count({
        where: {
          clinicId,
          status: "ACTIVE",
          startedAt: { gte: windowStart, lte: staleBefore },
        },
      }),
      prisma.clinicTelephonyCall.count({
        where: {
          clinicId,
          startedAt: { gte: windowStart },
          events: {
            some: {
              eventType: {
                in: [
                  ClinicTelephonyCallEventType.RECEPTION_FAILED,
                  ClinicTelephonyCallEventType.RECEPTION_FALLBACK_TO_IVR,
                ],
              },
            },
          },
        },
      }),
      prisma.clinicTelephonyCall.count({
        where: {
          clinicId,
          startedAt: { gte: windowStart },
          events: {
            some: {
              eventType: {
                in: [
                  ClinicTelephonyCallEventType.URGENT_TRANSFER_FAILED,
                  ClinicTelephonyCallEventType.URGENT_TRANSFER_UNAVAILABLE,
                ],
              },
            },
          },
        },
      }),
    ]);

  const healthStatus =
    recentCount === 0
      ? "no-data"
      : incompleteCalls > 0 || receptionFailures > 0 || urgentFailures > 0
        ? "attention"
        : "healthy";

  return Object.freeze({
    window: Object.freeze({ hours: PHONE_DIAGNOSTICS_WINDOW_HOURS }),
    timezone: config?.timezone ?? DEFAULT_CLINIC_TIMEZONE,
    health: Object.freeze({
      status: healthStatus,
      recentCalls: recentCount,
      incompleteCalls,
      receptionFailures,
      urgentTransferFailures: urgentFailures,
    }),
    recentCalls: Object.freeze(
      recentCalls.map((call) => toCallView(call, staleBefore)),
    ),
  });
}
