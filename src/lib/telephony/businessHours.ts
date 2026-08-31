import type {
  ClinicBusinessHours,
  ClinicBusinessWeekday,
} from "@prisma/client";
import { z } from "zod";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";
import { isClockTime } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import type { ActorContext } from "@/lib/rbac";
import { assertActorCanManageTelephony } from "@/lib/telephony/access";

export const CLINIC_BUSINESS_WEEKDAYS = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
] as const satisfies readonly ClinicBusinessWeekday[];

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
    if (
      open.success &&
      close.success &&
      open.data >= close.data
    ) {
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

export interface ClinicBusinessHoursView {
  clinicId: string;
  hours: readonly ClinicBusinessHoursDay[];
}

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

type StoredHoursRow = Pick<
  ClinicBusinessHours,
  "dayOfWeek" | "isClosed" | "openTime" | "closeTime"
>;

function closedDay(dayOfWeek: ClinicBusinessWeekday): ClinicBusinessHoursDay {
  return { dayOfWeek, isClosed: true, openTime: null, closeTime: null };
}

function safeStoredDay(row: StoredHoursRow): ClinicBusinessHoursDay {
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
  rows: readonly StoredHoursRow[],
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

async function loadStoredHours(clinicId: string): Promise<StoredHoursRow[]> {
  return prisma.clinicBusinessHours.findMany({
    where: { clinicId },
    select: {
      dayOfWeek: true,
      isClosed: true,
      openTime: true,
      closeTime: true,
    },
  });
}

async function loadHours(
  clinicId: string,
): Promise<readonly ClinicBusinessHoursDay[]> {
  return normalizeClinicBusinessHours(await loadStoredHours(clinicId));
}

/** Use only after the clinic id came from a trusted scoped or provider lookup. */
export async function getClinicBusinessHoursForTrustedClinic(
  clinicId: string,
): Promise<readonly ClinicBusinessHoursDay[]> {
  return loadHours(clinicId);
}

export async function getClinicBusinessHoursForActor(
  actor: ActorContext,
  clinicId: string,
): Promise<ClinicBusinessHoursView> {
  await assertActorCanManageTelephony(actor, clinicId);
  return { clinicId, hours: await loadHours(clinicId) };
}

function sameDay(
  left: ClinicBusinessHoursDay,
  right: ClinicBusinessHoursDay,
): boolean {
  return (
    left.dayOfWeek === right.dayOfWeek &&
    left.isClosed === right.isClosed &&
    left.openTime === right.openTime &&
    left.closeTime === right.closeTime
  );
}

export async function updateClinicBusinessHoursForActor(
  actor: ActorContext,
  clinicId: string,
  input: UpdateClinicBusinessHoursInput,
): Promise<ClinicBusinessHoursView> {
  await assertActorCanManageTelephony(actor, clinicId);
  const stored = await loadStoredHours(clinicId);
  const current = normalizeClinicBusinessHours(stored);
  const storedWeekdays = new Set(stored.map((day) => day.dayOfWeek));
  const changedWeekdays = CLINIC_BUSINESS_WEEKDAYS.filter(
    (weekday, index) =>
      !storedWeekdays.has(weekday) ||
      !sameDay(current[index], input.hours[index]),
  );
  if (changedWeekdays.length === 0) {
    return { clinicId, hours: current };
  }

  await prisma.$transaction(async (tx) => {
    for (const day of input.hours) {
      await tx.clinicBusinessHours.upsert({
        where: {
          clinicId_dayOfWeek: {
            clinicId,
            dayOfWeek: day.dayOfWeek,
          },
        },
        create: { clinicId, ...day },
        update: {
          isClosed: day.isClosed,
          openTime: day.openTime,
          closeTime: day.closeTime,
        },
      });
    }
    await writeAuditLog(tx, {
      action: AUDIT_ACTIONS.CLINIC_TELEPHONY_HOURS_UPDATED,
      targetType: "ClinicBusinessHours",
      targetId: clinicId,
      actorUserId: actor.userId,
      actorTenantId: actor.tenantId,
      afterValue: { clinicId, changedWeekdays },
    });
  });

  return { clinicId, hours: input.hours };
}
