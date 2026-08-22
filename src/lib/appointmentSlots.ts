/**
 * The appointment slot engine — AP-2.
 *
 * PURE: no Prisma, no Auth.js, no Next.js, no request, no environment, no
 * browser globals. It imports only lib/dates.ts and lib/appointmentRules.ts,
 * both of which are pure for the same reason.
 *
 * WHY THIS IS SEPARATE FROM THE QUERY. "Which slots does this doctor have on
 * this date?" is a question with a great many edge cases — an availability
 * window shorter than the appointment, a remainder at the end of a window, a
 * booking of a different length straddling two candidates, a doctor on leave,
 * two windows that overlap because someone wrote them by hand. Every one of
 * those fails SILENTLY: a slot that should have been offered simply is not, or
 * a slot that is already taken is offered again. None of them throws. So the
 * whole of the reasoning lives here where a unit test can hold all of it at
 * once, and lib/appointments.ts does nothing but fetch rows and hand them over.
 *
 * TIME REPRESENTATION — the project convention, unchanged.
 *
 *   - A calendar day is the string "YYYY-MM-DD".
 *   - A clock time is the string "HH:mm", 24-hour, zero-padded. These sort
 *     lexicographically, which is why the window comparisons below can compare
 *     strings directly, exactly as lib/doctors.ts already does.
 *   - A slot boundary is a Date built by `parseDateTime(date, "HH:mm")`: the
 *     wall-clock value the clinic runs on, TAGGED UTC and never converted.
 *     `slotStart`/`slotEnd` on the appointments table hold the same thing, so a
 *     slot computed here compares directly against a booked interval read out
 *     of the database, with no conversion at either end.
 *
 * Nothing here reads the host's timezone, and nothing here parses an ambiguous
 * string such as `new Date("2026-08-23 09:00")`. Every Date is built through
 * lib/dates.ts.
 *
 * NOT A BOOKING GUARD. This says which slots LOOK free at the moment the rows
 * were read. Two receptionists can be handed the same free slot a millisecond
 * apart. The guarantee that only one of them keeps it is the DoctorScheduleLock
 * protocol in prisma/schema.prisma, which AP-3 owns.
 */

import {
  formatClockTime,
  isClockTime,
  isDateOnly,
  parseDateTime,
} from "@/lib/dates";
import {
  intervalsOverlap,
  isOccupyingAppointmentStatus,
  isValidAppointmentDuration,
  type AppointmentStatus,
} from "@/lib/appointmentRules";

const MS_PER_MINUTE = 60_000;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** One `doctor_availability` row, in the project's string form. */
export interface AvailabilityWindow {
  /** "YYYY-MM-DD". */
  date: string;
  /** "HH:mm", inclusive. */
  startTime: string;
  /** "HH:mm", EXCLUSIVE — the window is half-open, like everything else here. */
  endTime: string;
}

/**
 * One `doctor_leave` row. BOTH ENDS INCLUSIVE, which is the convention
 * lib/doctors.ts already reads them with (`startDate <= today <= endDate`).
 *
 * `reason` is accepted because the row carries one, but see the note in
 * lib/appointments.ts: the database wrapper deliberately does not select it and
 * nothing derived from it reaches a slot response.
 */
export interface LeaveRange {
  startDate: string;
  endDate: string;
  reason?: string | null;
}

/**
 * One existing appointment, reduced to the only three things slot computation
 * may know about it.
 *
 * There is no patient field here and there must never be one. A slot picker
 * tells a receptionist that 09:30 is taken; who it is taken by is a different
 * screen with a different permission.
 */
export interface BookedInterval {
  start: Date;
  end: Date;
  status: AppointmentStatus;
  /** The appointment id, if the caller wants booked slots to be linkable. */
  id?: string;
}

export interface SlotComputationInput {
  /** The requested day, "YYYY-MM-DD". */
  date: string;
  /** `AppointmentType.durationMinutes` — the grid is computed per type. */
  durationMinutes: number;
  /** Rows for THIS doctor. Rows for another date are discarded, not inferred from. */
  availability: readonly AvailabilityWindow[];
  leave: readonly LeaveRange[];
  /** Non-occupying statuses are ignored, whether or not the caller filtered them. */
  booked: readonly BookedInterval[];
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export type SlotStatus = "available" | "booked";

export interface Slot {
  /** Wall-clock tagged UTC, directly comparable with `appointments.slot_start`. */
  start: Date;
  end: Date;
  /** The same boundaries as "HH:mm", which is what a UI and an API render. */
  startTime: string;
  endTime: string;
  status: SlotStatus;
  /**
   * Set only on a booked slot. An opaque appointment id — no patient data — so
   * a caller already holding `appointment:read` in this clinic can open the
   * appointment behind a frozen slot.
   */
  bookingId?: string;
}

/**
 * Why the slot list looks the way it does.
 *
 * An empty list has four completely different meanings and a picker that shows
 * "no slots" for all of them is useless: a doctor on leave, a doctor not working
 * that day, a fully booked day, and a mis-configured appointment type each need
 * a different sentence on screen and send the user to a different person.
 *
 *   ok               — availability was found and processed. The list may still
 *                      be empty (every slot booked, or every window too short).
 *   on-leave         — leave covers the requested date. Full-day, always.
 *   no-availability  — no window exists for this doctor on this date.
 *   invalid-duration — the appointment type's duration is outside the bounds in
 *                      lib/appointmentRules.ts. A data defect, not a full day.
 *   invalid-date     — the requested date is not a real "YYYY-MM-DD".
 */
export type SlotOutcome =
  | "ok"
  | "on-leave"
  | "no-availability"
  | "invalid-duration"
  | "invalid-date";

export type DiscardedWindowReason =
  | "wrong-date"
  | "malformed-time"
  | "end-not-after-start"
  | "too-short-for-duration";

export interface DiscardedWindow {
  window: AvailabilityWindow;
  reason: DiscardedWindowReason;
}

export interface SlotComputation {
  date: string;
  durationMinutes: number;
  outcome: SlotOutcome;
  /** Chronological, globally across every window, and never duplicated. */
  slots: Slot[];
  /**
   * Windows that produced nothing, and why. Diagnostics for an admin screen and
   * for the verify script — a doctor whose whole day was discarded as malformed
   * should be findable without reading the database by hand.
   */
  discardedWindows: DiscardedWindow[];
  /**
   * Windows that overlap an earlier window on the same date.
   *
   * `addAvailability` in lib/doctors.ts refuses to create these, but no database
   * constraint backs that check, so rows written by an import or by hand can
   * overlap. They are STILL PROCESSED — silently dropping one would take a
   * doctor's real working hours off the board — and the duplicate candidates
   * two overlapping windows produce are collapsed. Reported so the condition is
   * visible rather than merely survived.
   */
  overlappingWindows: AvailabilityWindow[];
}

// ---------------------------------------------------------------------------
// Leave
// ---------------------------------------------------------------------------

/**
 * Whether a leave range covers a date. Inclusive at both ends.
 *
 * String comparison is exact for zero-padded ISO dates and avoids constructing
 * three Dates to answer a question about calendar days.
 */
export function isDateOnLeave(range: LeaveRange, date: string): boolean {
  return range.startDate <= date && date <= range.endDate;
}

export function isDoctorOnLeave(
  leave: readonly LeaveRange[],
  date: string,
): boolean {
  return leave.some((range) => isDateOnLeave(range, date));
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/**
 * The candidate grid for one doctor, one date and one appointment type.
 *
 * Deterministic: same input, same output, in the same order, every time. The
 * only ordering that is not derived from the data itself — which booked
 * interval is credited when several cover one candidate — is settled by sorting
 * the booked list first, so the answer does not depend on query order.
 */
export function computeAppointmentSlots(
  input: SlotComputationInput,
): SlotComputation {
  const { date, durationMinutes } = input;

  const empty = (outcome: SlotOutcome): SlotComputation => ({
    date,
    durationMinutes,
    outcome,
    slots: [],
    discardedWindows: [],
    overlappingWindows: [],
  });

  if (!isDateOnly(date)) {
    return empty("invalid-date");
  }

  // Checked before anything else is computed: a type with a zero or negative
  // duration would otherwise loop forever below.
  if (!isValidAppointmentDuration(durationMinutes)) {
    return empty("invalid-duration");
  }

  // LEAVE WINS OVER AVAILABILITY, deliberately. A doctor on leave usually still
  // has their standing availability rows for the day, so checking availability
  // first would report "not working" for a day they are booked off — the same
  // empty list, with the wrong explanation on it.
  if (isDoctorOnLeave(input.leave, date)) {
    return empty("on-leave");
  }

  const discardedWindows: DiscardedWindow[] = [];
  const forDate: AvailabilityWindow[] = [];

  for (const window of input.availability) {
    if (window.date === date) {
      forDate.push(window);
    } else {
      // Never inferred from. There is no recurring weekly schedule in this
      // model: a date with no row of its own is a date the doctor is not
      // working, however regular the rest of their week looks.
      discardedWindows.push({ window, reason: "wrong-date" });
    }
  }

  if (forDate.length === 0) {
    return { ...empty("no-availability"), discardedWindows };
  }

  const usable: AvailabilityWindow[] = [];

  for (const window of forDate) {
    if (!isClockTime(window.startTime) || !isClockTime(window.endTime)) {
      discardedWindows.push({ window, reason: "malformed-time" });
      continue;
    }
    // Zero-length windows land here too: they would produce no slot anyway, and
    // saying so is better than returning an empty list with no reason.
    if (window.startTime >= window.endTime) {
      discardedWindows.push({ window, reason: "end-not-after-start" });
      continue;
    }
    usable.push(window);
  }

  // Sorted before anything is generated, so the overlap scan below only has to
  // look backwards and the output is chronological by construction.
  usable.sort(
    (a, b) =>
      a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime),
  );

  const overlappingWindows: AvailabilityWindow[] = [];
  let furthestEnd = "";

  for (const window of usable) {
    // Half-open, matching addAvailability: 09:00-12:00 and 12:00-15:00 are
    // adjacent, not overlapping, and are processed as the two separate windows
    // the clinic entered. They are deliberately NOT merged — merging would move
    // every slot boundary after the join whenever the duration does not divide
    // the first window exactly.
    if (furthestEnd !== "" && window.startTime < furthestEnd) {
      overlappingWindows.push(window);
    }
    if (window.endTime > furthestEnd) {
      furthestEnd = window.endTime;
    }
  }

  const durationMs = durationMinutes * MS_PER_MINUTE;

  // Keyed by start instant, which is what collapses the duplicate candidates
  // two overlapping windows would otherwise both produce. A Map also preserves
  // "first one wins", though every value for a given key is identical.
  const candidates = new Map<number, { start: Date; end: Date }>();

  for (const window of usable) {
    const windowStart = parseDateTime(date, window.startTime).getTime();
    const windowEnd = parseDateTime(date, window.endTime).getTime();

    if (windowEnd - windowStart < durationMs) {
      discardedWindows.push({ window, reason: "too-short-for-duration" });
      continue;
    }

    // `+ durationMs <= windowEnd` is the whole remainder rule: a slot is
    // generated only when it fits ENTIRELY inside the window, so a 09:00-10:00
    // window at 25 minutes yields 09:00 and 09:25 and stops. The leftover
    // 09:50-10:15 would run past the doctor's last minute and is discarded.
    //
    // It is also why no slot can cross midnight: `endTime` cannot exceed
    // "23:59", so `slotEnd` cannot either, and the `spans-two-days` rule in
    // lib/appointmentRules.ts can never fire on a slot computed here.
    for (let start = windowStart; start + durationMs <= windowEnd; start += durationMs) {
      if (!candidates.has(start)) {
        candidates.set(start, { start: new Date(start), end: new Date(start + durationMs) });
      }
    }
  }

  // DEFENSIVE, not redundant. lib/appointments.ts already asks the database for
  // occupying statuses only, but this module is the one place that owns the
  // meaning of "busy", and a caller that forgets the filter — a test, a script,
  // a future AP-6 preview — must not be able to freeze a slot with a cancelled
  // appointment. A CONVERTED appointment is occupying and does freeze its slot;
  // CANCELLED, NO_SHOW and RESCHEDULED do not.
  const occupied = input.booked
    .filter(
      (booking) =>
        isOccupyingAppointmentStatus(booking.status) &&
        !Number.isNaN(booking.start.getTime()) &&
        !Number.isNaN(booking.end.getTime()) &&
        booking.end.getTime() > booking.start.getTime(),
    )
    // Sorted so that when several bookings cover one candidate, the id reported
    // is always the earliest — the result must not depend on query order.
    .sort(
      (a, b) =>
        a.start.getTime() - b.start.getTime() ||
        a.end.getTime() - b.end.getTime() ||
        (a.id ?? "").localeCompare(b.id ?? ""),
    );

  const slots = [...candidates.values()]
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .map((candidate): Slot => {
      // Half-open on both sides, so an existing 09:00-09:30 leaves 09:30-10:00
      // free, while an existing 09:15-09:45 takes BOTH 09:00-09:30 and
      // 09:30-10:00. A booked interval of a different length than the requested
      // type is handled by exactly the same comparison — there is no grid
      // alignment assumption anywhere in this file.
      const clash = occupied.find((booking) =>
        intervalsOverlap(candidate.start, candidate.end, booking.start, booking.end),
      );

      return {
        start: candidate.start,
        end: candidate.end,
        startTime: formatClockTime(candidate.start),
        endTime: formatClockTime(candidate.end),
        status: clash ? "booked" : "available",
        ...(clash?.id === undefined ? {} : { bookingId: clash.id }),
      };
    });

  return {
    date,
    durationMinutes,
    outcome: "ok",
    slots,
    discardedWindows,
    overlappingWindows,
  };
}
