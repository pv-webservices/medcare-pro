import { z } from "zod";
import { BadRequestError, ConflictError } from "@/lib/apiHandler";
import { getAppointmentForActor } from "@/lib/appointmentLifecycle";
import {
  NO_PATIENT_MESSAGE,
  reminderRefusal,
  reminderTemplateValues,
} from "@/lib/appointmentReminderRules";
import { isAppointmentStatus } from "@/lib/appointmentRules";
import { formatClockTime, formatDateOnly } from "@/lib/dates";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { prisma } from "@/lib/prisma";
import { requirePermission, ScopeError, type ActorContext } from "@/lib/rbac";
import { deliverTemplate, type MessageStatus } from "@/lib/whatsappMessages";
import { getTemplateForActor } from "@/lib/whatsappTemplates";
import { renderTemplate } from "@/lib/whatsappTemplateText";
import { readWhatsappConfig } from "@/lib/whatsapp";

/**
 * Sending an approved reminder about one appointment — AP-8.
 *
 * WHAT THIS STAGE COULD NOT DO, AND WHY. `whatsapp_messages.patient_id` is NOT
 * NULL with a foreign key to `patients`, and an Appointment carries only a
 * snapshot of who it is for — `patientId` stays null until AP-5 converts it.
 * So a reminder can only be recorded, and therefore only sent, for a booking
 * that already has a patient record: one booked for an existing patient, or one
 * already converted. A first-visit booking is refused with the reason in
 * NO_PATIENT_MESSAGE rather than being silently skipped. Reaching those
 * patients needs a nullable `patient_id` and an `appointment_id` column, which
 * is a migration on a table holding real send history and was deliberately left
 * out of this stage.
 *
 * ONE SEND, NOT A BATCH. lib/whatsappMessages.ts sends to a list of patients
 * chosen at the Messages screen; this sends about one appointment from the
 * appointment's own page. Both go through `deliverTemplate`, which is that
 * module's own per-recipient path extracted rather than copied — so the
 * not-on-WhatsApp pre-check, the number normalisation and the history row are
 * identical, and a compliance rule cannot end up true of one path only.
 *
 * NO FREE TEXT, as everywhere else: the body is an approved template chosen by
 * id, and this module has no vocabulary for a caller-supplied message.
 */

export const sendAppointmentReminderSchema = z.object({
  templateId: z.string().trim().min(1, "Choose a template.").max(64),
});

export type SendAppointmentReminderInput = z.infer<
  typeof sendAppointmentReminderSchema
>;

export interface AppointmentReminderResult {
  appointmentId: string;
  templateName: string;
  status: MessageStatus;
  /** The gateway's reason when it refused, shown verbatim. */
  failureReason: string | null;
  /** What actually went out, after substitution — echoed back for the toast. */
  preview: string;
}

/**
 * Sends one reminder, or refuses with a reason the desk can act on.
 *
 * ORDER MATTERS, and it is the order every AP-4/AP-5 mutation uses:
 *   1. the module gate, so an unentitled organisation is refused first;
 *   2. the scoped read, which 404s an appointment this actor cannot see;
 *   3. `message:send` AT THIS APPOINTMENT'S CLINIC — not `appointment:*`.
 *      Reminding a patient is a messaging act, and the front desk that books
 *      appointments is not automatically the desk allowed to message patients.
 *   4. the advisory refusals, status before patient record;
 *   5. the gateway configuration, last, because a cancelled appointment is
 *      cancelled whether or not WhatsApp is set up.
 */
export async function sendAppointmentReminder(
  actor: ActorContext,
  appointmentId: string,
  input: SendAppointmentReminderInput,
): Promise<AppointmentReminderResult> {
  await requireModule(actor, MODULE_FEATURES.appointments);

  const appointment = await getAppointmentForActor(actor, appointmentId);

  await requirePermission(actor, "message:send", appointment.clinicId);

  if (!isAppointmentStatus(appointment.status)) {
    throw new ConflictError(
      "This appointment is in a state this version does not recognise.",
    );
  }

  const refusal = reminderRefusal(
    appointment.status,
    appointment.patientId !== null,
  );

  if (refusal) {
    // A 400, not a 409: nothing raced here. The appointment is simply not one
    // a reminder is for, and retrying the same request would refuse the same
    // way — which is what distinguishes this from a conflict.
    throw new BadRequestError(refusal);
  }

  // Unreachable — `reminderRefusal` returns NO_PATIENT_MESSAGE for exactly this
  // case and has just been checked. Written as a narrowing the compiler can
  // verify rather than an `as string` it cannot: if the rule above is ever
  // relaxed, this refuses instead of inserting a null into a NOT NULL column.
  const { patientId } = appointment;
  if (patientId === null) {
    throw new BadRequestError(NO_PATIENT_MESSAGE);
  }

  // AFTER the refusals, and that order is deliberate. Both can be wrong at
  // once, and "this appointment is cancelled" answers what the person actually
  // clicked, where "WhatsApp is not configured" sends them to fix an
  // environment variable that would not have helped. Throws with the precise
  // reason — missing key vs missing sending device — when it is the real
  // problem.
  readWhatsappConfig();

  const template = await getTemplateForActor(actor, input.templateId);

  const facts = await loadReminderFacts(actor, appointmentId);

  const values = reminderTemplateValues(facts);

  const outcome = await deliverTemplate(template, {
    // From the row loaded inside the actor's scope, never from the client.
    patientId,
    clinicId: appointment.clinicId,
    // The APPOINTMENT's number, not the patient record's. The desk may have
    // taken a different contact when the slot was booked, and that is the one
    // the patient gave for this booking.
    mobileNumber: appointment.mobileNumber,
    values,
  });

  return {
    appointmentId,
    templateName: template.name,
    status: outcome.status,
    failureReason: outcome.failureReason,
    // The same substitution `deliverTemplate` just ran, on the same values, so
    // the confirmation cannot describe something other than what went out.
    preview: renderTemplate(template.body, values),
  };
}

/**
 * The names behind the ids, for the placeholders.
 *
 * A second query rather than widening APPOINTMENT_ROW_SELECT: that select is
 * AP-4's and is used by every lifecycle mutation, so adding four relations to
 * it would make every check-in and cancel pay for joins only a reminder needs.
 * Scope is not re-derived here — `getAppointmentForActor` has already proven
 * this row is the actor's, and this reads the same id.
 */
async function loadReminderFacts(actor: ActorContext, appointmentId: string) {
  const row = await prisma.appointment.findFirst({
    where: { id: appointmentId, tenantId: actor.tenantId },
    select: {
      name: true,
      slotStart: true,
      clinic: { select: { name: true } },
      doctor: { select: { name: true, department: true } },
      appointmentType: { select: { name: true } },
      patient: { select: { patientCode: true } },
    },
  });

  if (!row) {
    // Cannot normally happen: the row was read a moment ago, inside scope.
    throw new ScopeError();
  }

  return {
    patientName: row.name,
    patientCode: row.patient?.patientCode ?? null,
    clinicName: row.clinic.name,
    doctorName: row.doctor.name,
    department: row.doctor.department,
    serviceName: row.appointmentType.name,
    // Read back exactly the way the rest of the app reads a slot: wall-clock
    // time tagged UTC, so the reminder quotes the hour the desk booked.
    slotDate: formatDateOnly(row.slotStart),
    slotTime: formatClockTime(row.slotStart),
  };
}

