import type { ClinicBusinessHours } from "@prisma/client";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import type { ActorContext } from "@/lib/rbac";
import { assertActorCanManageTelephony } from "@/lib/telephony/access";
import {
  CLINIC_BUSINESS_WEEKDAYS,
  normalizeClinicBusinessHours,
  type ClinicBusinessHoursDay,
  type UpdateClinicBusinessHoursInput,
} from "@/lib/telephony/businessHoursContract";

export * from "@/lib/telephony/businessHoursContract";

export interface ClinicBusinessHoursView {
  clinicId: string;
  hours: readonly ClinicBusinessHoursDay[];
}

type StoredHoursRow = Pick<
  ClinicBusinessHours,
  "dayOfWeek" | "isClosed" | "openTime" | "closeTime"
>;

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
