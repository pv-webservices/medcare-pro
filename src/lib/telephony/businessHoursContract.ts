import { z } from "zod";
import { isClockTime } from "@/lib/dates";

/** Pure browser/server contract for the regular clinic week. */
export const CLINIC_BUSINESS_WEEKDAYS = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
] as const;

export type ClinicBusinessWeekday =
  (typeof CLINIC_BUSINESS_WEEKDAYS)[number];

const clockTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a valid HH:mm time.");

const nullableClockInput = z.union([z.string(), z.null()]).optional();

export const clinicBusinessHoursDaySchema = z
  .object({
    dayOfWeek: z.enum(CLINIC_BUSINESS_WEEKDAYS),
    isClosed: z.boolean(),
    openTime: nullableClockInput,
    closeTime: nullableClockInput,
  })
  .strict()
  .superRefine((day, context) => {
    if (day.isClosed) return;

    const open = clockTimeSchema.safeParse(day.openTime);
    const close = clockTimeSchema.safeParse(day.closeTime);
    if (!open.success) {
      context.addIssue({
        code: "custom",
        path: ["openTime"],
        message: "An open day requires a valid HH:mm opening time.",
      });
    }
    if (!close.success) {
      context.addIssue({
        code: "custom",
        path: ["closeTime"],
        message: "An open day requires a valid HH:mm closing time.",
      });
    }
    if (open.success && close.success && open.data >= close.data) {
      context.addIssue({
        code: "custom",
        path: ["closeTime"],
        message:
          "Closing time must be later than opening time; overnight hours are not supported.",
      });
    }
  })
  .transform((day) => ({
    dayOfWeek: day.dayOfWeek,
    isClosed: day.isClosed,
    openTime: day.isClosed ? null : (day.openTime as string),
    closeTime: day.isClosed ? null : (day.closeTime as string),
  }));

export const updateClinicBusinessHoursSchema = z
  .object({
    hours: z.array(clinicBusinessHoursDaySchema).length(7),
  })
  .strict()
  .superRefine((input, context) => {
    const supplied = new Set(input.hours.map((day) => day.dayOfWeek));
    for (const weekday of CLINIC_BUSINESS_WEEKDAYS) {
      if (!supplied.has(weekday)) {
        context.addIssue({
          code: "custom",
          path: ["hours"],
          message: `A complete weekly schedule must include ${weekday}.`,
        });
      }
    }
    if (supplied.size !== input.hours.length) {
      context.addIssue({
        code: "custom",
        path: ["hours"],
        message: "Each weekday must appear exactly once.",
      });
    }
  })
  .transform((input) => ({
    hours: CLINIC_BUSINESS_WEEKDAYS.map(
      (weekday) => input.hours.find((day) => day.dayOfWeek === weekday)!,
    ),
  }));

export type ClinicBusinessHoursDay = z.infer<
  typeof clinicBusinessHoursDaySchema
>;
export type UpdateClinicBusinessHoursInput = z.infer<
  typeof updateClinicBusinessHoursSchema
>;

export interface ClinicNextOpening {
  dayOfWeek: ClinicBusinessWeekday;
  dayOffset: number;
  openTime: string;
}

export interface ClinicBusinessState {
  isOpen: boolean;
  hasRegularHours: boolean;
  localWeekday: ClinicBusinessWeekday;
  localTime: string;
  todayHours: ClinicBusinessHoursDay;
  nextOpening: ClinicNextOpening | null;
}

interface StoredHoursDay {
  dayOfWeek: ClinicBusinessWeekday;
  isClosed: boolean;
  openTime: string | null;
  closeTime: string | null;
}

function closedDay(dayOfWeek: ClinicBusinessWeekday): ClinicBusinessHoursDay {
  return { dayOfWeek, isClosed: true, openTime: null, closeTime: null };
}

function safeStoredDay(row: StoredHoursDay): ClinicBusinessHoursDay {
  if (
    row.isClosed ||
    row.openTime === null ||
    row.closeTime === null ||
    !isClockTime(row.openTime) ||
    !isClockTime(row.closeTime) ||
    row.openTime >= row.closeTime
  ) {
    return closedDay(row.dayOfWeek);
  }
  return {
    dayOfWeek: row.dayOfWeek,
    isClosed: false,
    openTime: row.openTime,
    closeTime: row.closeTime,
  };
}

export function normalizeClinicBusinessHours(
  rows: readonly StoredHoursDay[],
): readonly ClinicBusinessHoursDay[] {
  const byDay = new Map(rows.map((row) => [row.dayOfWeek, row]));
  return Object.freeze(
    CLINIC_BUSINESS_WEEKDAYS.map((weekday) => {
      const row = byDay.get(weekday);
      return Object.freeze(row ? safeStoredDay(row) : closedDay(weekday));
    }),
  );
}

function localWeekdayAndTime(
  now: Date,
  timezone: string,
): { weekday: ClinicBusinessWeekday; time: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  const canonicalWeekday = weekday?.toUpperCase();

  if (
    !canonicalWeekday ||
    !CLINIC_BUSINESS_WEEKDAYS.includes(
      canonicalWeekday as ClinicBusinessWeekday,
    ) ||
    !hour ||
    !minute
  ) {
    throw new Error("Could not resolve clinic-local business time.");
  }

  return {
    weekday: canonicalWeekday as ClinicBusinessWeekday,
    time: `${hour}:${minute}`,
  };
}

export function resolveClinicBusinessState(input: {
  now: Date;
  timezone: string;
  hours: readonly ClinicBusinessHoursDay[];
}): ClinicBusinessState {
  if (Number.isNaN(input.now.getTime())) {
    throw new Error("A valid current instant is required.");
  }

  const hours = normalizeClinicBusinessHours(input.hours);
  const local = localWeekdayAndTime(input.now, input.timezone);
  const todayIndex = CLINIC_BUSINESS_WEEKDAYS.indexOf(local.weekday);
  const todayHours = hours[todayIndex];
  const isOpen =
    !todayHours.isClosed &&
    todayHours.openTime !== null &&
    todayHours.closeTime !== null &&
    local.time >= todayHours.openTime &&
    local.time < todayHours.closeTime;

  let nextOpening: ClinicNextOpening | null = null;
  for (let dayOffset = 0; dayOffset <= 7; dayOffset += 1) {
    const day = hours[(todayIndex + dayOffset) % 7];
    if (day.isClosed || day.openTime === null) continue;
    if (dayOffset === 0 && local.time >= day.openTime) continue;
    nextOpening = {
      dayOfWeek: day.dayOfWeek,
      dayOffset,
      openTime: day.openTime,
    };
    break;
  }

  return Object.freeze({
    isOpen,
    hasRegularHours: hours.some((day) => !day.isClosed),
    localWeekday: local.weekday,
    localTime: local.time,
    todayHours,
    nextOpening,
  });
}
