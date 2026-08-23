import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  accessibleClinicScope,
  PermissionError,
  type ActorContext,
  type ClinicScope,
} from "@/lib/rbac";

/**
 * Notifications — PRD §6.7 (FR-7.1, FR-7.2).
 *
 * FR-7.1: a modification to a patient, doctor or clinic record raises a
 * notification for Admin/Owner. The permission is `notification:read`, which
 * the seeded Staff role deliberately does not hold — a receptionist causes
 * these events, they do not review them.
 *
 * Two properties worth knowing before changing anything here:
 *
 *   - **Writes never fail the action that caused them.** `recordNotification`
 *     swallows its own errors and is called AFTER the business transaction has
 *     committed, never inside it. A notification is a convenience feed, not an
 *     audit record; `registration_edit_log` is the thing PRD §9 requires to be
 *     atomic, and rolling back a receptionist's save because a feed row failed
 *     to insert would be the wrong trade.
 *   - **`read` is one flag per notification, shared by the whole account.** The
 *     PRD's `notifications` table has no user column, so one Admin marking an
 *     item read marks it read for every Admin. That is the specified data
 *     model, not an oversight in this module — per-user read state would need a
 *     new table and a PRD change.
 */

/**
 * Format is `<record>.<action>`, matching the example types in the schema.
 *
 * WHICH APPOINTMENT EVENTS ARE HERE, AND WHICH ARE DELIBERATELY NOT — AP-8.
 * The feed is what an Admin reviews, not a log of everything the desk does;
 * `audit_logs` is the complete record. So:
 *
 *   booked, cancelled, missed, moved   ARE here. Each is a change to the day's
 *                                      plan that somebody other than the person
 *                                      who did it may need to know about.
 *   checked in                         is NOT. It happens to every patient who
 *                                      turns up, several times an hour, and
 *                                      tells an Admin nothing — it would bury
 *                                      the four events above.
 *   converted                          is NOT, because it already raises
 *                                      `registration.created` (see AP-5's
 *                                      convertAppointmentToRegistration). One
 *                                      event must not produce two feed items
 *                                      saying the same thing.
 */
export const NOTIFICATION_TYPES = [
  "clinic.created",
  "clinic.updated",
  "doctor.created",
  "doctor.updated",
  "registration.created",
  "registration.updated",
  "appointment.created",
  "appointment.cancelled",
  "appointment.no_show",
  "appointment.rescheduled",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Shown as the item's category chip. PRD vocabulary, not generic words. */
export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  "clinic.created": "Clinic added",
  "clinic.updated": "Clinic updated",
  "doctor.created": "Doctor added",
  "doctor.updated": "Doctor updated",
  "registration.created": "Registration added",
  "registration.updated": "Registration updated",
  // AP-8. An Appointment is a slot booked in a doctor's day, not a
  // Registration — the vocabulary rule in .claude/skills/admin-dashboard-ui.
  "appointment.created": "Appointment booked",
  "appointment.cancelled": "Appointment cancelled",
  "appointment.no_show": "Appointment missed",
  "appointment.rescheduled": "Appointment moved",
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export const notificationFilterSchema = z.object({
  status: z.enum(["all", "unread"]).optional(),
  clinicId: z.string().trim().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
});

export type NotificationFilters = z.infer<typeof notificationFilterSchema>;

/**
 * Either a specific set of ids or every notification the actor can see.
 *
 * Exactly one of `ids` / `all` — a body carrying both is a client bug, and
 * silently preferring one would make "Mark all as read" quietly do less than it
 * says.
 */
export const markNotificationsSchema = z
  .object({
    ids: z.array(z.string().trim().min(1).max(64)).min(1).max(MAX_LIMIT).optional(),
    all: z.literal(true).optional(),
    read: z.boolean(),
  })
  .refine((value) => (value.ids === undefined) !== (value.all === undefined), {
    message: "Send either a list of notification ids or all: true.",
  });

export type MarkNotificationsInput = z.infer<typeof markNotificationsSchema>;

export interface NotificationRecord {
  id: string;
  type: string;
  /** Falls back to the raw type, so a row written by a newer version still renders. */
  typeLabel: string;
  message: string;
  clinicId: string | null;
  clinicName: string | null;
  relatedRecordId: string | null;
  /** Deep link to the changed record, or null when the type has no page. */
  href: string | null;
  read: boolean;
  createdAt: Date;
}

export interface NotificationFeed {
  items: NotificationRecord[];
  /** Unread across everything the actor can see, not just the returned page. */
  unreadCount: number;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

interface RecordNotificationInput {
  tenantId: string;
  /** Null is reserved for account-wide events; today every type names a clinic. */
  clinicId: string | null;
  type: NotificationType;
  message: string;
  relatedRecordId: string | null;
}

/**
 * Inserts one notification, never throwing.
 *
 * Deliberately swallowing: every call site is a post-commit side effect of a
 * save the user already completed. Surfacing a failure here would turn a
 * successful registration into an error on screen. The failure is logged so it
 * is still visible server-side.
 */
async function recordNotification(input: RecordNotificationInput): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        tenantId: input.tenantId,
        clinicId: input.clinicId,
        type: input.type,
        message: input.message,
        relatedRecordId: input.relatedRecordId,
      },
    });
  } catch (error: unknown) {
    console.error(`Could not record notification (${input.type})`, error);
  }
}

/**
 * The acting user's name, for the "by whom" half of the message.
 *
 * Scoped by tenant as well as id: a stale session naming a user from another
 * account must not resolve to that person's name.
 */
async function actorName(actor: ActorContext): Promise<string> {
  try {
    const user = await prisma.user.findFirst({
      where: { id: actor.userId, tenantId: actor.tenantId },
      select: { name: true },
    });
    return user?.name ?? "a user";
  } catch {
    return "a user";
  }
}

export interface ClinicEventInput {
  clinicId: string;
  clinicName: string;
}

export async function notifyClinicCreated(
  actor: ActorContext,
  clinic: ClinicEventInput,
): Promise<void> {
  await recordNotification({
    tenantId: actor.tenantId,
    clinicId: clinic.clinicId,
    type: "clinic.created",
    message: `${clinic.clinicName} was added by ${await actorName(actor)}.`,
    relatedRecordId: clinic.clinicId,
  });
}

export async function notifyClinicUpdated(
  actor: ActorContext,
  clinic: ClinicEventInput,
): Promise<void> {
  await recordNotification({
    tenantId: actor.tenantId,
    clinicId: clinic.clinicId,
    type: "clinic.updated",
    message: `${clinic.clinicName}'s details were updated by ${await actorName(actor)}.`,
    relatedRecordId: clinic.clinicId,
  });
}

export interface DoctorEventInput {
  doctorId: string;
  doctorName: string;
  clinicId: string;
  clinicName: string;
}

export async function notifyDoctorCreated(
  actor: ActorContext,
  doctor: DoctorEventInput,
): Promise<void> {
  await recordNotification({
    tenantId: actor.tenantId,
    clinicId: doctor.clinicId,
    type: "doctor.created",
    message: `${doctor.doctorName} was added to ${doctor.clinicName} by ${await actorName(actor)}.`,
    relatedRecordId: doctor.doctorId,
  });
}

export async function notifyDoctorUpdated(
  actor: ActorContext,
  doctor: DoctorEventInput,
): Promise<void> {
  await recordNotification({
    tenantId: actor.tenantId,
    clinicId: doctor.clinicId,
    type: "doctor.updated",
    message: `${doctor.doctorName}'s details were updated in ${doctor.clinicName} by ${await actorName(actor)}.`,
    relatedRecordId: doctor.doctorId,
  });
}

export interface RegistrationEventInput {
  registrationId: string;
  clinicId: string;
  clinicName: string;
  patientName: string;
  patientCode: string;
  /** True when this visit also created the patient record (FR-3.1). */
  isNewPatient: boolean;
}

export async function notifyRegistrationCreated(
  actor: ActorContext,
  registration: RegistrationEventInput,
): Promise<void> {
  const who = await actorName(actor);
  // A first visit and a follow-up read very differently to an Admin scanning
  // the feed, so they are worded as the different events they are.
  const message = registration.isNewPatient
    ? `New patient ${registration.patientName} (${registration.patientCode}) was registered at ${registration.clinicName} by ${who}.`
    : `A follow-up visit for ${registration.patientName} (${registration.patientCode}) was recorded at ${registration.clinicName} by ${who}.`;

  await recordNotification({
    tenantId: actor.tenantId,
    clinicId: registration.clinicId,
    type: "registration.created",
    message,
    relatedRecordId: registration.registrationId,
  });
}

/**
 * FR-7.1's core case: an existing patient record was changed.
 *
 * `changedLabels` comes from the same diff that writes
 * `registration_edit_log`, so the feed names exactly the fields the audit trail
 * recorded — the two can never disagree about what changed.
 */
export async function notifyRegistrationUpdated(
  actor: ActorContext,
  registration: RegistrationEventInput,
  changedLabels: readonly string[],
): Promise<void> {
  const fields =
    changedLabels.length === 0 ? "" : ` Changed: ${changedLabels.join(", ")}.`;

  await recordNotification({
    tenantId: actor.tenantId,
    clinicId: registration.clinicId,
    type: "registration.updated",
    message:
      `${registration.patientName}'s registration (${registration.patientCode}) at ` +
      `${registration.clinicName} was updated by ${await actorName(actor)}.${fields}`,
    relatedRecordId: registration.registrationId,
  });
}

// ---------------------------------------------------------------------------
// Appointments — AP-8
// ---------------------------------------------------------------------------

/**
 * What every appointment notification names.
 *
 * The patient's NAME and nothing else about them. No mobile number, no address,
 * no age — the feed is a list of things that happened, read by Admins across a
 * whole account, and the appointment itself already carries the contact details
 * behind `appointment:read`. Same discipline as the registration messages above.
 */
export interface AppointmentEventInput {
  appointmentId: string;
  clinicId: string;
  clinicName: string;
  patientName: string;
  doctorName: string;
  /** "YYYY-MM-DD", already read back off the slot by the caller. */
  slotDate: string;
  /** "HH:mm", likewise. */
  slotTime: string;
}

/**
 * "2026-12-21 at 09:00".
 *
 * ISO rather than "21 Dec 2026" on purpose: this string is STORED in
 * `notifications.message` and read back months later, so it must not depend on
 * the server's locale at the moment it was written. Screens format their own
 * dates; a stored sentence cannot be reformatted after the fact.
 */
function slotPhrase(appointment: AppointmentEventInput): string {
  return `${appointment.slotDate} at ${appointment.slotTime}`;
}

export async function notifyAppointmentBooked(
  actor: ActorContext,
  appointment: AppointmentEventInput,
): Promise<void> {
  await recordNotification({
    tenantId: actor.tenantId,
    clinicId: appointment.clinicId,
    type: "appointment.created",
    message:
      `${appointment.patientName} was booked with ${appointment.doctorName} at ` +
      `${appointment.clinicName} on ${slotPhrase(appointment)} by ${await actorName(actor)}.`,
    relatedRecordId: appointment.appointmentId,
  });
}

/**
 * The reason is included when the desk gave one — it is the whole reason the
 * cancel endpoint accepts a note, and an Admin scanning the feed should not
 * have to open the appointment to learn why it went.
 */
export async function notifyAppointmentCancelled(
  actor: ActorContext,
  appointment: AppointmentEventInput,
  reason?: string | null,
): Promise<void> {
  const trimmed = reason?.trim();

  await recordNotification({
    tenantId: actor.tenantId,
    clinicId: appointment.clinicId,
    type: "appointment.cancelled",
    message:
      `${appointment.patientName}'s appointment with ${appointment.doctorName} at ` +
      `${appointment.clinicName} on ${slotPhrase(appointment)} was cancelled by ` +
      `${await actorName(actor)}.${trimmed ? ` Reason: ${trimmed}` : ""}`,
    relatedRecordId: appointment.appointmentId,
  });
}

export async function notifyAppointmentNoShow(
  actor: ActorContext,
  appointment: AppointmentEventInput,
): Promise<void> {
  await recordNotification({
    tenantId: actor.tenantId,
    clinicId: appointment.clinicId,
    type: "appointment.no_show",
    message:
      `${appointment.patientName} did not attend their appointment with ` +
      `${appointment.doctorName} at ${appointment.clinicName} on ` +
      `${slotPhrase(appointment)}. Recorded by ${await actorName(actor)}.`,
    relatedRecordId: appointment.appointmentId,
  });
}

/**
 * Names both slots, and points at the NEW appointment.
 *
 * A reschedule leaves the original row behind as RESCHEDULED and creates a
 * replacement (AP-4). The useful link is the one the patient is now expected
 * at, so `appointmentId` here is the replacement's.
 */
export async function notifyAppointmentRescheduled(
  actor: ActorContext,
  appointment: AppointmentEventInput,
  previous: { slotDate: string; slotTime: string },
): Promise<void> {
  await recordNotification({
    tenantId: actor.tenantId,
    clinicId: appointment.clinicId,
    type: "appointment.rescheduled",
    message:
      `${appointment.patientName}'s appointment at ${appointment.clinicName} was moved ` +
      `from ${previous.slotDate} at ${previous.slotTime} to ${slotPhrase(appointment)} ` +
      `with ${appointment.doctorName}, by ${await actorName(actor)}.`,
    relatedRecordId: appointment.appointmentId,
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

function hrefFor(type: string, relatedRecordId: string | null): string | null {
  if (!relatedRecordId) {
    return null;
  }
  if (type.startsWith("clinic.")) return `/clinics/${relatedRecordId}`;
  if (type.startsWith("doctor.")) return `/doctors/${relatedRecordId}`;
  if (type.startsWith("registration.")) return `/registration/${relatedRecordId}`;
  // AP-8. Points at the appointment, which is still readable after it is
  // cancelled or missed — nothing in this system deletes one.
  if (type.startsWith("appointment.")) return `/appointments/${relatedRecordId}`;
  return null;
}

/**
 * The clinic half of every `where` in this module.
 *
 * A tenant-wide reader sees the whole account, including notifications with a
 * null `clinic_id`. A clinic-scoped Admin sees only their clinics' rows — the
 * null-clinic ones are account-wide events they have no reach over, so they are
 * excluded rather than shown to everyone.
 */
type ReachableScope = Exclude<ClinicScope, { scope: "none" }>;

function clinicFilter(access: ReachableScope, requestedClinicId?: string) {
  if (access.scope === "all") {
    return requestedClinicId ? { clinicId: requestedClinicId } : {};
  }

  const reachable = [...access.clinicIds];
  // A clinic outside the actor's reach narrows the result to nothing rather
  // than erroring — the same rule the revenue report follows for a stale
  // clinic selection.
  const ids = requestedClinicId
    ? reachable.filter((id) => id === requestedClinicId)
    : reachable;

  return { clinicId: { in: ids } };
}

/**
 * Resolves the actor's notification reach, throwing PermissionError (→ 403)
 * when they hold `notification:read` nowhere.
 *
 * `requirePermission` is not used here: it treats a missing clinic id as
 * "account-wide only", which would refuse a clinic-scoped Admin who legitimately
 * holds the permission inside their own clinic.
 */
async function notificationScope(actor: ActorContext): Promise<ReachableScope> {
  const access = await accessibleClinicScope(actor, "notification:read");

  if (access.scope === "none") {
    throw new PermissionError("notification:read");
  }

  return access;
}

/** FR-7.1 / FR-7.2 — the feed, unread first, then newest first. */
export async function listNotificationsForActor(
  actor: ActorContext,
  filters: NotificationFilters = {},
): Promise<NotificationFeed> {
  const access = await notificationScope(actor);
  const scoped = {
    tenantId: actor.tenantId,
    ...clinicFilter(access, filters.clinicId),
  };

  const [rows, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { ...scoped, ...(filters.status === "unread" ? { read: false } : {}) },
      // Unread first (the index on [tenant_id, read] serves this), newest first
      // within each half — an Admin opening the page wants what needs attention
      // at the top, not the chronological tail.
      orderBy: [{ read: "asc" }, { createdAt: "desc" }],
      take: filters.limit ?? DEFAULT_LIMIT,
      select: {
        id: true,
        type: true,
        message: true,
        clinicId: true,
        relatedRecordId: true,
        read: true,
        createdAt: true,
        clinic: { select: { name: true } },
      },
    }),
    // Counted over everything visible, not just this page: the nav badge must
    // not read "50" forever because the page size is 50.
    prisma.notification.count({ where: { ...scoped, read: false } }),
  ]);

  return {
    items: rows.map(({ clinic, ...row }) => ({
      ...row,
      typeLabel:
        NOTIFICATION_TYPE_LABELS[row.type as NotificationType] ?? row.type,
      clinicName: clinic?.name ?? null,
      href: hrefFor(row.type, row.relatedRecordId),
    })),
    unreadCount,
  };
}

/**
 * Unread count on its own, for the nav badge.
 *
 * Returns 0 rather than throwing for an actor without the permission: the badge
 * renders on every page, and a Staff user must not get an error shell instead
 * of their dashboard.
 */
export async function countUnreadForActor(actor: ActorContext): Promise<number> {
  const access = await accessibleClinicScope(actor, "notification:read");

  if (access.scope === "none") {
    return 0;
  }

  return prisma.notification.count({
    where: { tenantId: actor.tenantId, ...clinicFilter(access), read: false },
  });
}

// ---------------------------------------------------------------------------
// Read / unread (FR-7.2)
// ---------------------------------------------------------------------------

export interface MarkNotificationsResult {
  updated: number;
  unreadCount: number;
}

/**
 * FR-7.2 — marks notifications read or unread.
 *
 * The `where` carries the tenant and the actor's clinic reach as well as the
 * ids, so passing another account's notification id updates nothing instead of
 * flipping a row the caller cannot see. `updateMany` reports 0 in that case,
 * which the route surfaces as a normal success — the caller learns nothing
 * about whether the id exists.
 */
export async function markNotificationsForActor(
  actor: ActorContext,
  input: MarkNotificationsInput,
): Promise<MarkNotificationsResult> {
  const access = await notificationScope(actor);
  const scoped = { tenantId: actor.tenantId, ...clinicFilter(access) };

  const { count } = await prisma.notification.updateMany({
    where: {
      ...scoped,
      ...(input.ids ? { id: { in: input.ids } } : {}),
      // Skips rows already in the target state, so the count reflects real
      // changes rather than the size of the selection.
      read: !input.read,
    },
    data: { read: input.read },
  });

  const unreadCount = await prisma.notification.count({
    where: { ...scoped, read: false },
  });

  return { updated: count, unreadCount };
}
