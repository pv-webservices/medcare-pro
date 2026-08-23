import { formatClockTime, formatDateOnly } from "@/lib/dates";
import {
  notifyAppointmentBooked,
  notifyAppointmentCancelled,
  notifyAppointmentNoShow,
  notifyAppointmentRescheduled,
  type AppointmentEventInput,
} from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import type { ActorContext } from "@/lib/rbac";

/**
 * Raising a feed item for something that happened to an appointment — AP-8.
 *
 * WHY THIS MODULE EXISTS RATHER THAN FOUR CALLS TO lib/notifications.ts. The
 * events happen inside AP-3's booking path and AP-4's lifecycle paths, and
 * those functions do not carry the clinic name, the doctor's name or a
 * formatted slot — only ids and a Date. Widening their selects to fetch three
 * strings that only a notification needs would make every check-in and cancel
 * pay for joins the action itself has no use for. So the lookup lives here, on
 * the notification side of the line, and each call site is one line.
 *
 * NOTHING HERE MAY FAIL THE ACTION THAT CAUSED IT. Every function is called
 * AFTER the business transaction has committed and swallows its own errors, the
 * same contract `recordNotification` already keeps. A booking that succeeded
 * must not turn into an error on screen because a feed row could not be
 * written — and the audit trail, which is the record that must be complete, is
 * written inside the transaction and is unaffected by anything here.
 */

/** What the feed needs, gathered in one read. */
async function loadEventInput(
  appointmentId: string,
  tenantId: string,
): Promise<AppointmentEventInput | null> {
  const row = await prisma.appointment.findFirst({
    // Tenant-scoped even though every caller has already proven scope: this is
    // the query that turns an id into a person's name, and it must never be
    // able to name somebody from another organisation.
    where: { id: appointmentId, tenantId },
    select: {
      id: true,
      clinicId: true,
      name: true,
      slotStart: true,
      clinic: { select: { name: true } },
      doctor: { select: { name: true } },
    },
  });

  if (!row) {
    return null;
  }

  return {
    appointmentId: row.id,
    clinicId: row.clinicId,
    clinicName: row.clinic.name,
    patientName: row.name,
    doctorName: row.doctor.name,
    // Read back the way the whole app reads a slot: wall-clock tagged UTC.
    slotDate: formatDateOnly(row.slotStart),
    slotTime: formatClockTime(row.slotStart),
  };
}

/** Runs `write` against the appointment's facts, or gives up quietly. */
async function withEventInput(
  actor: ActorContext,
  appointmentId: string,
  write: (input: AppointmentEventInput) => Promise<void>,
): Promise<void> {
  try {
    const input = await loadEventInput(appointmentId, actor.tenantId);
    if (!input) return;
    await write(input);
  } catch (error: unknown) {
    console.error(
      `Could not record appointment notification (${appointmentId})`,
      error,
    );
  }
}

export async function notifyAppointmentBookedById(
  actor: ActorContext,
  appointmentId: string,
): Promise<void> {
  await withEventInput(actor, appointmentId, (input) =>
    notifyAppointmentBooked(actor, input),
  );
}

export async function notifyAppointmentCancelledById(
  actor: ActorContext,
  appointmentId: string,
  reason?: string | null,
): Promise<void> {
  await withEventInput(actor, appointmentId, (input) =>
    notifyAppointmentCancelled(actor, input, reason),
  );
}

export async function notifyAppointmentNoShowById(
  actor: ActorContext,
  appointmentId: string,
): Promise<void> {
  await withEventInput(actor, appointmentId, (input) =>
    notifyAppointmentNoShow(actor, input),
  );
}

/**
 * The replacement's id, not the original's — a reader following this item wants
 * the slot the patient is now expected at. The slot it moved FROM has to be
 * passed in, because by the time this runs the original row is RESCHEDULED and
 * its own slot is no longer the interesting one.
 */
export async function notifyAppointmentRescheduledById(
  actor: ActorContext,
  replacementAppointmentId: string,
  previous: { slotStart: Date },
): Promise<void> {
  await withEventInput(actor, replacementAppointmentId, (input) =>
    notifyAppointmentRescheduled(actor, input, {
      slotDate: formatDateOnly(previous.slotStart),
      slotTime: formatClockTime(previous.slotStart),
    }),
  );
}
