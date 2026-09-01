import { z } from "zod";
import {
  APPOINTMENT_STATUSES,
  MAX_APPOINTMENT_AMOUNT,
  MAX_DURATION_MINUTES,
  MIN_DURATION_MINUTES,
  OCCUPYING_STATUSES,
  canTransitionAppointment,
  isAppointmentStatus,
  isValidAppointmentAmount,
  isValidAppointmentDuration,
  type AppointmentStatus,
} from "@/lib/appointmentRules";
import { isClockTime, isDateOnly, parseDateTime } from "@/lib/dates";

/**
 * What a client may say to the appointments API — AP-3, and PURE.
 *
 * Same split AP-2 established between lib/appointmentSlots.ts and
 * lib/appointments.ts, for the same reason: the rules about what a request is
 * allowed to contain are worth testing without a database, a session or a
 * Next.js server, and lib/appointments.ts reaches all three the moment it is
 * imported. Everything here depends on zod, lib/dates.ts and
 * lib/appointmentRules.ts and nothing else.
 *
 * lib/appointments.ts and lib/appointmentTypes.ts re-export these, so callers
 * and routes import them from the domain module they already use and never need
 * to know this file exists.
 */

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/**
 * A flag that may arrive as a real boolean (a JSON body) or as text (a query
 * string).
 *
 * NOT `z.coerce.boolean()`. That is `Boolean(value)`, and `Boolean("false")` is
 * `true` — so `?includeHistory=false` would switch history ON. Matches
 * lib/auth.ts and lib/loginCode.ts, which parse their flags this way for
 * exactly this reason.
 */
const flagSchema = z
  .union([z.boolean(), z.string()])
  .transform((value) => value === true || value === "true")
  .optional();

/** Blank is how an HTML form says "no filter", so "" is accepted throughout. */
const optionalDateSchema = z
  .string()
  .trim()
  .refine((value) => value === "" || isDateOnly(value), "Choose a valid date.")
  .optional();

// ---------------------------------------------------------------------------
// Appointment type names
// ---------------------------------------------------------------------------

/**
 * The form a name is COMPARED in — never the form it is stored in.
 *
 * `toLowerCase()` rather than `toLocaleLowerCase()`: the result decides whether
 * two rows collide, and a locale-sensitive fold would make that decision depend
 * on the server's locale. The Turkish dotless i is the standard example —
 * `"I".toLocaleLowerCase("tr")` is `"ı"` — so the same two names would collide
 * on one machine and not on another.
 *
 * Interior whitespace is collapsed too, so "Follow  up" and "Follow up" are one
 * name rather than two rows a receptionist cannot tell apart in a dropdown.
 */
export function normaliseAppointmentTypeName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/** What is stored: trimmed and whitespace-collapsed, but CASE PRESERVED. */
export function displayAppointmentTypeName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

// ---------------------------------------------------------------------------
// Appointment type input
// ---------------------------------------------------------------------------

const typeNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a name for this appointment type.")
  .max(255, "That name is too long.");

const durationSchema = z.coerce
  .number()
  .refine(
    isValidAppointmentDuration,
    `Choose a whole number of minutes between ${MIN_DURATION_MINUTES} and ${MAX_DURATION_MINUTES}.`,
  );

/**
 * Stricter than lib/registrations.ts's amount rule, deliberately: that one
 * bounds the range, this one bounds the SCALE as well. A `Decimal(10, 2)` column
 * silently rounds a third decimal place, so 10.005 would be quoted to a patient
 * and stored as 10.01. A price list is set once and read many times, so it is
 * worth refusing here rather than discovering the rounding at the counter.
 */
const typeAmountSchema = z.coerce
  .number()
  .refine(
    isValidAppointmentAmount,
    `Enter an amount between 0 and ${MAX_APPOINTMENT_AMOUNT}, to at most two decimal places.`,
  );

/**
 * `clinicId` absent or null = offered at every clinic in the organisation — the
 * same nullable-clinic convention `user_roles.clinic_id` uses.
 */
const scopeSchema = z.string().trim().min(1).nullish();

export const createAppointmentTypeSchema = z.object({
  clinicId: scopeSchema,
  name: typeNameSchema,
  durationMinutes: durationSchema,
  defaultAmount: typeAmountSchema,
});

/**
 * `tenantId` and `id` are absent by construction — a type cannot be moved to
 * another organisation or given a different identity, and the way to guarantee
 * that is for the schema to have no vocabulary for it rather than a check
 * somebody could forget.
 */
export const updateAppointmentTypeSchema = z
  .object({
    clinicId: scopeSchema,
    name: typeNameSchema.optional(),
    durationMinutes: durationSchema.optional(),
    defaultAmount: typeAmountSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "No changes submitted.",
  });

export const appointmentTypeFilterSchema = z.object({
  clinicId: z.string().trim().max(64).optional(),
  /** Retired types, for the management screen. Requires appointment:type:manage. */
  includeInactive: flagSchema,
});

export type CreateAppointmentTypeInput = z.infer<
  typeof createAppointmentTypeSchema
>;
export type UpdateAppointmentTypeInput = z.infer<
  typeof updateAppointmentTypeSchema
>;
export type AppointmentTypeFilters = z.infer<typeof appointmentTypeFilterSchema>;

// ---------------------------------------------------------------------------
// Slot instants
// ---------------------------------------------------------------------------

/**
 * A slot boundary on the wire.
 *
 * Deliberately narrow. `new Date("2026-11-09 09:00")` is parsed as local time by
 * some engines and rejected by others, and this project tags wall-clock times as
 * UTC and never converts them (see lib/dates.ts). So the only accepted form is
 * an explicit-Z instant on a whole minute, and it is rebuilt through
 * `parseDateTime` — the very function AP-2 uses to generate the slot being
 * booked. The booking and the offer are therefore constructed by the same code
 * and cannot drift apart by a timezone.
 *
 * Seconds must be zero: AP-2 never offers a slot at 09:00:30, so accepting one
 * would mean accepting a boundary no availability window can align with.
 */
const SLOT_INSTANT = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::00(?:\.000)?)?Z$/;

export function parseSlotInstant(value: string): Date | null {
  const match = SLOT_INSTANT.exec(value.trim());
  if (!match) return null;

  const [, date, time] = match;
  if (!isDateOnly(date) || !isClockTime(time)) return null;

  const parsed = parseDateTime(date, time);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const slotInstantSchema = z
  .string()
  .trim()
  .refine(
    (value) => parseSlotInstant(value) !== null,
    "Use a slot time like 2026-11-09T09:00:00.000Z.",
  );

// ---------------------------------------------------------------------------
// Booking input
// ---------------------------------------------------------------------------

/**
 * Loose on purpose, and character-for-character the rule lib/registrations.ts
 * applies: international formats vary and the PRD does not fix one. Restated
 * rather than imported because that module keeps it private and is outside this
 * stage's scope to change — the two must not drift, and a unit test pins them
 * to the same shape.
 */
const mobileSchema = z
  .string()
  .trim()
  .regex(/^(\+91)?[0-9]{10}$/, "Enter a valid 10-digit Indian mobile number.")
  .max(13);

/**
 * What a booking accepts.
 *
 * WHAT IS ABSENT IS THE POINT. There is no `amount`, `status`, `activeSlotStart`,
 * `bookedById` or `tenantId` here, and zod strips unknown keys, so a client that
 * sends one is not refused — it is ignored, and the server's own value is used.
 * Each is derived in lib/appointments.ts from something the client cannot
 * influence: the price from the appointment type, the status from this being a
 * new booking, the occupancy sentinel from the status, and the booker and tenant
 * from the session.
 */
import {
  patientAddressSchema,
  patientAgeSchema,
  patientCitySchema,
  patientGenderSchema,
  patientMobileSchema,
  patientNameSchema,
} from "@/lib/patientValidation";

export const createAppointmentSchema = z.object({
  clinicId: z.string().trim().min(1, "Choose a clinic."),
  doctorId: z.string().trim().min(1, "Choose a doctor."),
  appointmentTypeId: z.string().trim().min(1, "Choose an appointment type."),

  /** An existing patient here. Absent = someone who is not a patient yet. */
  patientId: z.string().trim().min(1).nullish(),

  // Patient details — all 6 fields mandatory.
  name: patientNameSchema,
  mobileNumber: patientMobileSchema,
  age: patientAgeSchema,
  gender: patientGenderSchema,
  address: patientAddressSchema,
  city: patientCitySchema,

  slotStart: slotInstantSchema,
  slotEnd: slotInstantSchema,
});

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;

// ---------------------------------------------------------------------------
// List input
// ---------------------------------------------------------------------------

export const appointmentFilterSchema = z.object({
  clinicId: z.string().trim().max(64).optional(),
  doctorId: z.string().trim().max(64).optional(),
  /** One exact day. Takes precedence over the range if both are given. */
  date: optionalDateSchema,
  dateFrom: optionalDateSchema,
  dateTo: optionalDateSchema,
  status: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || isAppointmentStatus(value),
      "Choose a valid appointment status.",
    )
    .optional(),
  includeHistory: flagSchema,
  page: z.coerce.number().int().min(1).max(10_000).optional(),
});

export type AppointmentFilters = z.infer<typeof appointmentFilterSchema>;

/**
 * The statuses a board shows unless history is asked for.
 *
 * Exactly the occupying set: what is still going to happen, or is happening. The
 * other three are outcomes — cancelled, missed, or moved — and they are hidden
 * rather than deleted, because nothing in this system ever deletes an
 * appointment.
 */
export const ACTIVE_LIST_STATUSES: readonly AppointmentStatus[] =
  OCCUPYING_STATUSES;

/**
 * Which statuses a request may see.
 *
 * An explicit `status` wins, but only a valid one — the schema above has already
 * rejected anything that is not an AppointmentStatus, and this second check
 * means a caller reaching the function directly cannot widen the query with
 * junk either. Otherwise: the active four, unless history was asked for, in
 * which case all seven.
 */
export function resolveListStatuses(
  filters: AppointmentFilters,
): readonly AppointmentStatus[] {
  const requested = filters.status?.trim();

  if (requested && isAppointmentStatus(requested)) {
    return [requested];
  }

  return filters.includeHistory ? APPOINTMENT_STATUSES : ACTIVE_LIST_STATUSES;
}

// ---------------------------------------------------------------------------
// Lifecycle input — AP-4
// ---------------------------------------------------------------------------

/**
 * `cancellation_reason` is a TEXT column, so the database imposes no useful
 * bound. Five hundred characters is a front-desk note ("patient rang, unwell"),
 * not a case history — the appointment trail is not a clinical record and must
 * not become one.
 */
export const MAX_CANCELLATION_REASON = 500;

const reasonSchema = z
  .string()
  .trim()
  .max(MAX_CANCELLATION_REASON, "That reason is too long.")
  .optional();

/**
 * Cancelling and marking a no-show take the same body.
 *
 * Neither accepts a status: which one happened is decided by WHICH ENDPOINT was
 * called, not by a field a client can set. A single `{ status }` body would let
 * one permission check stand in front of two different outcomes, and the whole
 * point of the split is that they are different outcomes.
 */
export const cancelAppointmentSchema = z.object({
  reason: reasonSchema,
});

export type CancelAppointmentInput = z.infer<typeof cancelAppointmentSchema>;

/**
 * What a reschedule accepts, and — as with booking — what is absent is the
 * point.
 *
 * No `clinicId`: a move to another site is a different booking, not a move.
 * No `appointmentTypeId`: changing the service changes the duration and the
 * price, which is a re-book. No `amount`: the patient keeps the price they were
 * quoted. No patient fields at all, so this endpoint can never be used as an
 * unaudited back door into someone's details — correcting those is
 * `appointment:update`, which is a separate permission and a separate stage.
 *
 * `doctorId` IS accepted, because the commonest real reason to move an
 * appointment is that the original doctor has gone on leave. It is re-derived
 * against the appointment's own clinic before it is used.
 */
export const rescheduleAppointmentSchema = z.object({
  doctorId: z.string().trim().min(1).optional(),
  slotStart: slotInstantSchema,
  slotEnd: slotInstantSchema,
  reason: reasonSchema,
});

export type RescheduleAppointmentInput = z.infer<
  typeof rescheduleAppointmentSchema
>;

// ---------------------------------------------------------------------------
// Edit input — AP-9
// ---------------------------------------------------------------------------

/**
 * What a correction accepts, and — as with booking and rescheduling — what is
 * absent is the point.
 *
 * There is no `slotStart`, `slotEnd`, `doctorId`, `appointmentTypeId`,
 * `clinicId`, `patientId` or `status` here. Zod strips unknown keys, so a
 * client that sends one is not refused, it is IGNORED and the stored value
 * stands. Each omission is a rule from AP-1 rather than an oversight: the
 * times are never updated after insert (rule 2), a different doctor or service
 * is a reschedule or a re-book, a different clinic is a different booking
 * altogether, re-pointing the patient link would move the money with it at
 * conversion, and the status is decided by which endpoint was called — never
 * by a field.
 *
 * EVERY FIELD IS OPTIONAL and absent means unchanged, so this is a genuine
 * PATCH. What blank and null mean is decided in exactly one place,
 * `applyAppointmentEdit` in lib/appointmentEditRules.ts, and the shape of this
 * schema's output is checked against that module's `AppointmentEditPatch` by
 * tsc at the call site.
 *
 * A body that changes nothing is refused by the domain layer, not here: `{}`
 * and "typed the same name back again" are the same non-event, and only a diff
 * against the stored row can see the second one.
 */
export const updateAppointmentSchema = z.object({
  name: z.string().trim().min(1, "Enter the patient's name.").max(255).optional(),
  mobileNumber: mobileSchema.optional(),
  /** Explicit null clears it; absent leaves it. Blank is the client's job. */
  age: z.coerce.number().int().min(0).max(150).nullish(),
  gender: z.string().trim().max(50).optional(),
  address: z.string().trim().max(1000).optional(),
  city: z.string().trim().max(255).optional(),
  /**
   * The one commercial field a correction may touch, and the reason
   * `appointment:update` is a separate permission from `appointment:create`.
   * Bounded for range AND scale by the same rule the price list uses, because
   * this number is copied onto the Registration at conversion and becomes
   * revenue.
   */
  amount: typeAmountSchema.optional(),
});

export type UpdateAppointmentInput = z.infer<typeof updateAppointmentSchema>;

/**
 * Why a transition was refused, phrased for the person at the desk.
 *
 * PURE, and separate from the transition table itself: lib/appointmentRules.ts
 * answers whether a move is allowed and this answers how to say no, so adding a
 * message can never accidentally change what is permitted. `canTransitionAppointment`
 * remains the only authority on the first question — this function calls it
 * rather than restating it.
 *
 * The message names the CURRENT state and nothing else. It does not say who
 * cancelled it or when; the appointment itself carries that, under
 * `appointment:read`.
 */
export function appointmentTransitionRefusal(
  from: AppointmentStatus,
  to: AppointmentStatus,
): string | null {
  if (canTransitionAppointment(from, to)) {
    return null;
  }

  if (from === to) {
    return ALREADY_IN_STATE[from];
  }

  return `${TERMINAL_PHRASE[from] ?? `This appointment is ${STATE_PHRASE[from]}`}, so it cannot be ${TARGET_PHRASE[to]}.`;
}

/** Re-doing something already done is a conflict, not a silent success. */
const ALREADY_IN_STATE: Readonly<Record<AppointmentStatus, string>> = {
  SCHEDULED: "This appointment is already booked.",
  CONFIRMED: "This appointment is already confirmed.",
  CHECKED_IN: "This patient is already checked in.",
  CONVERTED: "This appointment has already been converted to a registration.",
  CANCELLED: "This appointment is already cancelled.",
  NO_SHOW: "This appointment is already marked as a no-show.",
  RESCHEDULED: "This appointment has already been moved to another slot.",
};

const STATE_PHRASE: Readonly<Record<AppointmentStatus, string>> = {
  SCHEDULED: "booked",
  CONFIRMED: "confirmed",
  CHECKED_IN: "checked in",
  CONVERTED: "already converted to a registration",
  CANCELLED: "cancelled",
  NO_SHOW: "marked as a no-show",
  RESCHEDULED: "already been moved to another slot",
};

/** The four states an appointment ends in. Nothing moves out of them. */
const TERMINAL_PHRASE: Readonly<Partial<Record<AppointmentStatus, string>>> = {
  CONVERTED: "This appointment has already been converted to a registration",
  CANCELLED: "This appointment is cancelled",
  NO_SHOW: "This appointment is marked as a no-show",
  RESCHEDULED: "This appointment has already been moved to another slot",
};

const TARGET_PHRASE: Readonly<Record<AppointmentStatus, string>> = {
  SCHEDULED: "reopened",
  CONFIRMED: "confirmed",
  CHECKED_IN: "checked in",
  CONVERTED: "converted to a registration",
  CANCELLED: "cancelled",
  NO_SHOW: "marked as a no-show",
  RESCHEDULED: "moved to another slot",
};
