import type {
  PlatformPlivoNumberAssignmentStatus,
  PlatformPlivoNumberHealthStatus,
  Prisma,
} from "@prisma/client";
import { z } from "zod";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";
import { BadRequestError, ConflictError } from "@/lib/apiHandler";
import type { PlatformActorContext } from "@/lib/platform/context";
import type { PlatformPlivoNumberProvider } from "@/lib/platform/plivoNumberProvider";
import { resolvePlivoNumberQuarantineDays } from "@/lib/platform/plivoNumberEnvironment";
import { prisma } from "@/lib/prisma";
import { CUSTOMER_TENANT_WHERE } from "@/lib/platformTenant";

export const platformPlivoAssignmentSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("assign"),
    clinicId: z.string().trim().min(1).max(191),
    numberId: z.string().trim().min(1).max(191),
  }).strict(),
  z.object({
    action: z.literal("reassign"),
    clinicId: z.string().trim().min(1).max(191),
    numberId: z.string().trim().min(1).max(191),
    confirmed: z.literal(true),
  }).strict(),
  z.object({
    action: z.literal("unassign"),
    clinicId: z.string().trim().min(1).max(191),
    numberId: z.string().trim().min(1).max(191),
    confirmed: z.literal(true),
  }).strict(),
  z.object({
    action: z.literal("restorePreviousAssignment"),
    numberId: z.string().trim().min(1).max(191),
    confirmed: z.literal(true),
  }).strict(),
]);

export const releasePlatformPlivoNumberSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("releaseQuarantine"),
    numberId: z.string().trim().min(1).max(191),
    confirmed: z.literal(true),
  }).strict(),
  z.object({
    action: z.literal("releaseQuarantineEarly"),
    numberId: z.string().trim().min(1).max(191),
    confirmed: z.literal(true),
    reason: z.string().trim().min(10).max(500),
  }).strict(),
  z.object({
    action: z.literal("restorePreviousAssignment"),
    numberId: z.string().trim().min(1).max(191),
    confirmed: z.literal(true),
  }).strict(),
]);

export interface PlatformPlivoNumberView {
  id: string;
  phoneNumber: string;
  providerApplicationId: string | null;
  providerApplicationName: string | null;
  providerNumberType: string | null;
  providerRegion: string | null;
  providerPresent: boolean;
  assignmentStatus: PlatformPlivoNumberAssignmentStatus;
  healthStatus: PlatformPlivoNumberHealthStatus;
  assignedTenantId: string | null;
  assignedTenantName: string | null;
  assignedClinicId: string | null;
  assignedClinicName: string | null;
  telephonyEnabled: boolean | null;
  quarantinedAt: string | null;
  quarantinedUntil: string | null;
  quarantineSourceTenantId: string | null;
  quarantineSourceTenantName: string | null;
  quarantineSourceClinicId: string | null;
  quarantineSourceClinicName: string | null;
  quarantineSourceTelephonyEnabled: boolean | null;
  quarantineExpired: boolean;
  lastSyncedAt: string | null;
  lastActivityAt: string | null;
  assignmentIssue: boolean;
}

export interface PlatformPlivoInventoryView {
  numbers: PlatformPlivoNumberView[];
  summary: {
    total: number;
    available: number;
    assigned: number;
    quarantined: number;
    providerIssues: number;
  };
}

export interface PlatformTenantIvrView {
  tenant: { id: string; name: string; status: string };
  quarantineDays: number;
  clinics: Array<{
    id: string;
    name: string;
    assignment: PlatformPlivoNumberView | null;
    recoverableQuarantine: PlatformPlivoNumberView | null;
  }>;
  availableNumbers: Array<{ id: string; phoneNumber: string }>;
}

type InventoryRow = Awaited<ReturnType<typeof loadInventoryRows>>[number];

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error as { code?: unknown }).code === "P2002";
}

async function loadInventoryRows() {
  return prisma.platformPlivoNumber.findMany({
    orderBy: { phoneNumber: "asc" },
    include: {
      assignedTenant: { select: { businessName: true } },
      quarantineSourceTenant: { select: { businessName: true } },
      quarantineSourceClinic: { select: { name: true, tenantId: true } },
      assignedClinic: {
        select: {
          name: true,
          tenantId: true,
          telephonyConfig: { select: { plivoNumber: true, enabled: true } },
          telephonyCalls: {
            orderBy: { startedAt: "desc" },
            take: 1,
            select: { startedAt: true },
          },
        },
      },
    },
  });
}

function toNumberView(row: InventoryRow, now: Date): PlatformPlivoNumberView {
  const assignmentIssue = row.assignmentStatus === "ASSIGNED"
    ? row.assignedTenantId === null || row.assignedClinicId === null ||
      row.assignedClinic === null ||
      row.assignedClinic.tenantId !== row.assignedTenantId ||
      row.assignedClinic.telephonyConfig?.plivoNumber !== row.phoneNumber
    : row.assignedTenantId !== null || row.assignedClinicId !== null;
  return {
    id: row.id,
    phoneNumber: row.phoneNumber,
    providerApplicationId: row.providerApplicationId,
    providerApplicationName: row.providerApplicationName,
    providerNumberType: row.providerNumberType,
    providerRegion: row.providerRegion,
    providerPresent: row.providerPresent,
    assignmentStatus: row.assignmentStatus,
    healthStatus: row.healthStatus,
    assignedTenantId: row.assignedTenantId,
    assignedTenantName: row.assignedTenant?.businessName ?? null,
    assignedClinicId: row.assignedClinicId,
    assignedClinicName: row.assignedClinic?.name ?? null,
    telephonyEnabled: row.assignedClinic?.telephonyConfig?.enabled ?? null,
    quarantinedAt: row.quarantinedAt?.toISOString() ?? null,
    quarantinedUntil: row.quarantinedUntil?.toISOString() ?? null,
    quarantineSourceTenantId: row.quarantineSourceTenantId,
    quarantineSourceTenantName: row.quarantineSourceTenant?.businessName ?? null,
    quarantineSourceClinicId: row.quarantineSourceClinicId,
    quarantineSourceClinicName: row.quarantineSourceClinic?.name ?? null,
    quarantineSourceTelephonyEnabled: row.quarantineSourceTelephonyEnabled,
    quarantineExpired:
      row.assignmentStatus === "QUARANTINED" &&
      row.quarantinedUntil !== null &&
      row.quarantinedUntil <= now,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    lastActivityAt:
      row.assignedClinic?.telephonyCalls[0]?.startedAt.toISOString() ?? null,
    assignmentIssue,
  };
}

export async function listPlatformPlivoNumbers(
  _owner: PlatformActorContext,
  now = new Date(),
): Promise<PlatformPlivoInventoryView> {
  const numbers = (await loadInventoryRows()).map((row) => toNumberView(row, now));
  return {
    numbers,
    summary: {
      total: numbers.length,
      available: numbers.filter((row) => row.assignmentStatus === "AVAILABLE").length,
      assigned: numbers.filter((row) => row.assignmentStatus === "ASSIGNED").length,
      quarantined: numbers.filter((row) => row.assignmentStatus === "QUARANTINED").length,
      providerIssues: numbers.filter(
        (row) => row.healthStatus !== "HEALTHY" || row.assignmentIssue,
      ).length,
    },
  };
}

export async function getPlatformTenantIvr(
  _owner: PlatformActorContext,
  tenantId: string,
  now = new Date(),
): Promise<PlatformTenantIvrView | null> {
  const [tenant, availableNumbers, recoverableQuarantines] = await Promise.all([
    prisma.tenant.findFirst({
      where: { id: tenantId, ...CUSTOMER_TENANT_WHERE },
      select: {
        id: true,
        businessName: true,
        status: true,
        clinics: {
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            platformPlivoNumber: {
              include: {
                assignedTenant: { select: { businessName: true } },
                quarantineSourceTenant: { select: { businessName: true } },
                quarantineSourceClinic: { select: { name: true, tenantId: true } },
                assignedClinic: {
                  select: {
                    name: true,
                    tenantId: true,
                    telephonyConfig: { select: { plivoNumber: true, enabled: true } },
                    telephonyCalls: {
                      orderBy: { startedAt: "desc" },
                      take: 1,
                      select: { startedAt: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
    prisma.platformPlivoNumber.findMany({
      where: {
        providerPresent: true,
        healthStatus: "HEALTHY",
        assignmentStatus: "AVAILABLE",
        assignedClinicId: null,
        assignedTenantId: null,
      },
      orderBy: { phoneNumber: "asc" },
      select: { id: true, phoneNumber: true },
    }),
    prisma.platformPlivoNumber.findMany({
      where: {
        assignmentStatus: "QUARANTINED",
        assignedTenantId: null,
        assignedClinicId: null,
        quarantineSourceTenantId: tenantId,
        quarantineSourceClinicId: { not: null },
      },
      orderBy: { quarantinedAt: "desc" },
      include: {
        assignedTenant: { select: { businessName: true } },
        quarantineSourceTenant: { select: { businessName: true } },
        quarantineSourceClinic: { select: { name: true, tenantId: true } },
        assignedClinic: {
          select: {
            name: true,
            tenantId: true,
            telephonyConfig: { select: { plivoNumber: true, enabled: true } },
            telephonyCalls: {
              orderBy: { startedAt: "desc" },
              take: 1,
              select: { startedAt: true },
            },
          },
        },
      },
    }),
  ]);
  if (!tenant) return null;
  const recoverableByClinic = new Map<string, PlatformPlivoNumberView>();
  for (const row of recoverableQuarantines) {
    if (row.quarantineSourceClinicId && !recoverableByClinic.has(row.quarantineSourceClinicId)) {
      recoverableByClinic.set(row.quarantineSourceClinicId, toNumberView(row, now));
    }
  }
  return {
    tenant: { id: tenant.id, name: tenant.businessName, status: tenant.status },
    quarantineDays: resolvePlivoNumberQuarantineDays(),
    clinics: tenant.clinics.map((clinic) => ({
      id: clinic.id,
      name: clinic.name,
      assignment: clinic.platformPlivoNumber
        ? toNumberView(clinic.platformPlivoNumber, now)
        : null,
      recoverableQuarantine: recoverableByClinic.get(clinic.id) ?? null,
    })),
    availableNumbers,
  };
}

export async function syncPlatformPlivoNumbers(
  owner: PlatformActorContext,
  provider: PlatformPlivoNumberProvider,
  expectedApplicationId: string,
  now = new Date(),
): Promise<PlatformPlivoInventoryView> {
  const providerNumbers = await provider.listOwnedNumbers();
  const seen = providerNumbers.map((row) => row.phoneNumber);
  const existing = await prisma.platformPlivoNumber.findMany({
    select: { id: true, phoneNumber: true, healthStatus: true },
  });
  const existingByNumber = new Map(existing.map((row) => [row.phoneNumber, row]));

  await prisma.$transaction(async (tx) => {
    let mismatchCount = 0;
    for (const providerNumber of providerNumbers) {
      const healthStatus: PlatformPlivoNumberHealthStatus =
        providerNumber.applicationId === expectedApplicationId
          ? "HEALTHY"
          : "OUT_OF_SYNC";
      if (healthStatus !== "HEALTHY") mismatchCount += 1;
      const row = await tx.platformPlivoNumber.upsert({
        where: { phoneNumber: providerNumber.phoneNumber },
        create: {
          phoneNumber: providerNumber.phoneNumber,
          providerApplicationId: providerNumber.applicationId,
          providerApplicationName: providerNumber.applicationName,
          providerNumberType: providerNumber.numberType,
          providerRegion: providerNumber.region,
          providerPresent: true,
          healthStatus,
          lastSyncedAt: now,
          providerSeenAt: now,
        },
        update: {
          providerApplicationId: providerNumber.applicationId,
          providerApplicationName: providerNumber.applicationName,
          providerNumberType: providerNumber.numberType,
          providerRegion: providerNumber.region,
          providerPresent: true,
          healthStatus,
          lastSyncedAt: now,
          providerSeenAt: now,
        },
        select: { id: true },
      });
      const previous = existingByNumber.get(providerNumber.phoneNumber);
      if (healthStatus !== "HEALTHY" && previous?.healthStatus !== healthStatus) {
        await writeAuditLog(tx, {
          action: AUDIT_ACTIONS.PLIVO_NUMBER_PROVIDER_MISMATCH,
          targetType: "PlatformPlivoNumber",
          targetId: row.id,
          actorUserId: owner.userId,
          actorPlatformRole: owner.platformRole,
          afterValue: {
            phoneNumber: providerNumber.phoneNumber,
            healthStatus,
          },
        });
      }
    }

    const missing = await tx.platformPlivoNumber.findMany({
      where: seen.length > 0 ? { phoneNumber: { notIn: seen } } : {},
      select: { id: true, phoneNumber: true, healthStatus: true },
    });
    mismatchCount += missing.length;
    for (const row of missing) {
      await tx.platformPlivoNumber.update({
        where: { id: row.id },
        data: {
          providerPresent: false,
          healthStatus: "MISSING_FROM_PROVIDER",
          lastSyncedAt: now,
        },
      });
      if (row.healthStatus !== "MISSING_FROM_PROVIDER") {
        await writeAuditLog(tx, {
          action: AUDIT_ACTIONS.PLIVO_NUMBER_PROVIDER_MISMATCH,
          targetType: "PlatformPlivoNumber",
          targetId: row.id,
          actorUserId: owner.userId,
          actorPlatformRole: owner.platformRole,
          afterValue: {
            phoneNumber: row.phoneNumber,
            healthStatus: "MISSING_FROM_PROVIDER",
          },
        });
      }
    }

    await writeAuditLog(tx, {
      action: AUDIT_ACTIONS.PLIVO_NUMBER_SYNCED,
      targetType: "PlatformPlivoInventory",
      actorUserId: owner.userId,
      actorPlatformRole: owner.platformRole,
      afterValue: {
        providerNumberCount: providerNumbers.length,
        providerIssueCount: mismatchCount,
      },
    });
  });
  return listPlatformPlivoNumbers(owner, now);
}

async function assertCustomerClinic(
  tx: Prisma.TransactionClient,
  tenantId: string,
  clinicId: string,
) {
  const clinic = await tx.clinic.findFirst({
    where: { id: clinicId, tenantId, tenant: CUSTOMER_TENANT_WHERE },
    select: { id: true, tenantId: true },
  });
  if (!clinic) throw new BadRequestError("Clinic not found.");
  return clinic;
}

function quarantineUntil(now: Date, quarantineDays: number): Date {
  return new Date(now.getTime() + quarantineDays * 24 * 60 * 60 * 1000);
}

const ownerAudit = (owner: PlatformActorContext, tenantId: string) => ({
  actorUserId: owner.userId,
  actorPlatformRole: owner.platformRole,
  actorTenantId: null,
  targetType: "Tenant",
  targetId: tenantId,
} as const);

export async function assignPlatformPlivoNumber(
  owner: PlatformActorContext,
  tenantId: string,
  input: { clinicId: string; numberId: string },
  now = new Date(),
): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      await assertCustomerClinic(tx, tenantId, input.clinicId);
      const [number, currentAssignment] = await Promise.all([
        tx.platformPlivoNumber.findUnique({ where: { id: input.numberId } }),
        tx.platformPlivoNumber.findUnique({ where: { assignedClinicId: input.clinicId } }),
      ]);
      if (currentAssignment) throw new ConflictError("This clinic already has an IVR number.");
      if (!number || !number.providerPresent || number.healthStatus !== "HEALTHY" ||
          number.assignmentStatus !== "AVAILABLE" || number.assignedClinicId !== null ||
          number.assignedTenantId !== null) {
        throw new ConflictError("This IVR number is not available.");
      }
      const changed = await tx.platformPlivoNumber.updateMany({
        where: {
          id: number.id,
          providerPresent: true,
          healthStatus: "HEALTHY",
          assignmentStatus: "AVAILABLE",
          assignedClinicId: null,
          assignedTenantId: null,
        },
        data: {
          assignmentStatus: "ASSIGNED",
          assignedTenantId: tenantId,
          assignedClinicId: input.clinicId,
          assignedAt: now,
          quarantinedAt: null,
          quarantinedUntil: null,
          quarantineSourceTenantId: null,
          quarantineSourceClinicId: null,
          quarantineSourceTelephonyEnabled: null,
        },
      });
      if (changed.count !== 1) throw new ConflictError("This IVR number is already assigned.");
      await tx.clinicTelephonyConfig.upsert({
        where: { clinicId: input.clinicId },
        create: { clinicId: input.clinicId, plivoNumber: number.phoneNumber },
        update: { plivoNumber: number.phoneNumber },
      });
      await writeAuditLog(tx, {
        ...ownerAudit(owner, tenantId),
        action: AUDIT_ACTIONS.PLIVO_NUMBER_ASSIGNED,
        afterValue: {
          phoneNumber: number.phoneNumber,
          tenantId,
          clinicId: input.clinicId,
          assignmentStatus: "ASSIGNED",
          healthStatus: number.healthStatus,
        },
      });
    });
  } catch (error: unknown) {
    if (isUniqueConstraintError(error)) {
      throw new ConflictError("This IVR number is already assigned.");
    }
    throw error;
  }
}

export async function unassignPlatformPlivoNumber(
  owner: PlatformActorContext,
  tenantId: string,
  input: { clinicId: string; numberId: string },
  quarantineDays: number,
  now = new Date(),
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertCustomerClinic(tx, tenantId, input.clinicId);
    const [number, telephonyConfig] = await Promise.all([
      tx.platformPlivoNumber.findUnique({ where: { id: input.numberId } }),
      tx.clinicTelephonyConfig.findUnique({
        where: { clinicId: input.clinicId },
        select: { enabled: true },
      }),
    ]);
    if (!number || number.assignmentStatus !== "ASSIGNED" ||
        number.assignedTenantId !== tenantId || number.assignedClinicId !== input.clinicId) {
      throw new ConflictError("This IVR number is not assigned to that clinic.");
    }
    const until = quarantineUntil(now, quarantineDays);
    const changed = await tx.platformPlivoNumber.updateMany({
      where: {
        id: number.id,
        assignmentStatus: "ASSIGNED",
        assignedTenantId: tenantId,
        assignedClinicId: input.clinicId,
      },
      data: {
        assignmentStatus: "QUARANTINED",
        assignedTenantId: null,
        assignedClinicId: null,
        assignedAt: null,
        quarantinedAt: now,
        quarantinedUntil: until,
        quarantineSourceTenantId: tenantId,
        quarantineSourceClinicId: input.clinicId,
        quarantineSourceTelephonyEnabled: telephonyConfig?.enabled ?? null,
      },
    });
    if (changed.count !== 1) {
      throw new ConflictError("This IVR number assignment changed. Refresh and try again.");
    }
    await tx.clinicTelephonyConfig.updateMany({
      where: { clinicId: input.clinicId, plivoNumber: number.phoneNumber },
      data: { plivoNumber: null, enabled: false },
    });
    const metadata = {
      phoneNumber: number.phoneNumber,
      tenantId,
      clinicId: input.clinicId,
      assignmentStatus: "QUARANTINED",
      quarantinedUntil: until.toISOString(),
      previousTelephonyEnabled: telephonyConfig?.enabled ?? null,
    };
    await writeAuditLog(tx, { ...ownerAudit(owner, tenantId), action: AUDIT_ACTIONS.PLIVO_NUMBER_UNASSIGNED, afterValue: metadata });
    await writeAuditLog(tx, { ...ownerAudit(owner, tenantId), action: AUDIT_ACTIONS.PLIVO_NUMBER_QUARANTINED, afterValue: metadata });
  });
}

export async function reassignPlatformPlivoNumber(
  owner: PlatformActorContext,
  tenantId: string,
  input: { clinicId: string; numberId: string },
  quarantineDays: number,
  now = new Date(),
): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      await assertCustomerClinic(tx, tenantId, input.clinicId);
      const number = await tx.platformPlivoNumber.findUnique({ where: { id: input.numberId } });
      if (!number || !number.providerPresent || number.healthStatus !== "HEALTHY" ||
          (number.assignmentStatus !== "AVAILABLE" && number.assignmentStatus !== "ASSIGNED") ||
          (number.assignmentStatus === "AVAILABLE" &&
            (number.assignedTenantId !== null || number.assignedClinicId !== null)) ||
          (number.assignmentStatus === "ASSIGNED" &&
            (!number.assignedTenantId || !number.assignedClinicId))) {
        throw new ConflictError("This IVR number cannot be reassigned.");
      }
      if (number.assignedClinicId === input.clinicId) {
        throw new BadRequestError("This IVR number is already assigned to that clinic.");
      }
      const replaced = await tx.platformPlivoNumber.findUnique({
        where: { assignedClinicId: input.clinicId },
      });
      if (replaced && replaced.id !== number.id) {
        const until = quarantineUntil(now, quarantineDays);
        const replacedTelephonyConfig = await tx.clinicTelephonyConfig.findUnique({
          where: { clinicId: input.clinicId },
          select: { enabled: true },
        });
        const quarantined = await tx.platformPlivoNumber.updateMany({
          where: {
            id: replaced.id,
            assignmentStatus: "ASSIGNED",
            assignedTenantId: replaced.assignedTenantId,
            assignedClinicId: input.clinicId,
          },
          data: {
            assignmentStatus: "QUARANTINED",
            assignedTenantId: null,
            assignedClinicId: null,
            assignedAt: null,
            quarantinedAt: now,
            quarantinedUntil: until,
            quarantineSourceTenantId: replaced.assignedTenantId,
            quarantineSourceClinicId: input.clinicId,
            quarantineSourceTelephonyEnabled: replacedTelephonyConfig?.enabled ?? null,
          },
        });
        if (quarantined.count !== 1) {
          throw new ConflictError("The target clinic assignment changed. Refresh and try again.");
        }
        await writeAuditLog(tx, {
          ...ownerAudit(owner, tenantId),
          action: AUDIT_ACTIONS.PLIVO_NUMBER_QUARANTINED,
          afterValue: {
            phoneNumber: replaced.phoneNumber,
            tenantId,
            clinicId: input.clinicId,
            assignmentStatus: "QUARANTINED",
            quarantinedUntil: until.toISOString(),
            previousTelephonyEnabled: replacedTelephonyConfig?.enabled ?? null,
          },
        });
      }
      if (number.assignedClinicId) {
        await tx.clinicTelephonyConfig.updateMany({
          where: { clinicId: number.assignedClinicId, plivoNumber: number.phoneNumber },
          data: { plivoNumber: null, enabled: false },
        });
      }
      const changed = await tx.platformPlivoNumber.updateMany({
        where: {
          id: number.id,
          assignmentStatus: number.assignmentStatus,
          assignedClinicId: number.assignedClinicId,
          assignedTenantId: number.assignedTenantId,
        },
        data: {
          assignmentStatus: "ASSIGNED",
          assignedTenantId: tenantId,
          assignedClinicId: input.clinicId,
          assignedAt: now,
          quarantinedAt: null,
          quarantinedUntil: null,
          quarantineSourceTenantId: null,
          quarantineSourceClinicId: null,
          quarantineSourceTelephonyEnabled: null,
        },
      });
      if (changed.count !== 1) throw new ConflictError("This IVR number is already assigned.");
      await tx.clinicTelephonyConfig.upsert({
        where: { clinicId: input.clinicId },
        create: { clinicId: input.clinicId, plivoNumber: number.phoneNumber },
        update: { plivoNumber: number.phoneNumber },
      });
      await writeAuditLog(tx, {
        ...ownerAudit(owner, tenantId),
        action: AUDIT_ACTIONS.PLIVO_NUMBER_REASSIGNED,
        afterValue: {
          phoneNumber: number.phoneNumber,
          tenantId,
          clinicId: input.clinicId,
          previousTenantId: number.assignedTenantId ?? null,
          previousClinicId: number.assignedClinicId ?? null,
          assignmentStatus: "ASSIGNED",
          healthStatus: number.healthStatus,
        },
      });
    });
  } catch (error: unknown) {
    if (isUniqueConstraintError(error)) {
      throw new ConflictError("This IVR number is already assigned.");
    }
    throw error;
  }
}

export async function releasePlatformPlivoNumber(
  owner: PlatformActorContext,
  numberId: string,
  now = new Date(),
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const number = await tx.platformPlivoNumber.findUnique({ where: { id: numberId } });
    if (!number || number.assignmentStatus !== "QUARANTINED" ||
        number.quarantinedUntil === null || number.quarantinedUntil > now) {
      throw new ConflictError("This IVR number is not ready to be made available.");
    }
    const changed = await tx.platformPlivoNumber.updateMany({
      where: {
        id: number.id,
        assignmentStatus: "QUARANTINED",
        quarantinedUntil: { lte: now },
      },
      data: {
        assignmentStatus: "AVAILABLE",
        quarantinedAt: null,
        quarantinedUntil: null,
        quarantineSourceTenantId: null,
        quarantineSourceClinicId: null,
        quarantineSourceTelephonyEnabled: null,
      },
    });
    if (changed.count !== 1) {
      throw new ConflictError("This IVR number is not ready to be made available.");
    }
    await writeAuditLog(tx, {
      action: AUDIT_ACTIONS.PLIVO_NUMBER_RELEASED,
      targetType: "PlatformPlivoNumber",
      targetId: number.id,
      actorUserId: owner.userId,
      actorPlatformRole: owner.platformRole,
      afterValue: {
        phoneNumber: number.phoneNumber,
        assignmentStatus: "AVAILABLE",
        healthStatus: number.healthStatus,
      },
    });
  });
}

export interface RestorePlatformPlivoNumberResult {
  previousTelephonyStateKnown: boolean;
  telephonyEnabled: boolean;
}

export async function restorePreviousPlatformPlivoNumber(
  owner: PlatformActorContext,
  numberId: string,
  expectedTenantId?: string,
  now = new Date(),
): Promise<RestorePlatformPlivoNumberResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const number = await tx.platformPlivoNumber.findUnique({ where: { id: numberId } });
      if (!number || number.assignmentStatus !== "QUARANTINED" ||
          !number.providerPresent || number.healthStatus !== "HEALTHY" ||
          number.assignedTenantId !== null || number.assignedClinicId !== null ||
          !number.quarantineSourceTenantId || !number.quarantineSourceClinicId ||
          (expectedTenantId !== undefined &&
            number.quarantineSourceTenantId !== expectedTenantId)) {
        throw new ConflictError("This IVR number cannot be restored to a previous assignment.");
      }

      await assertCustomerClinic(
        tx,
        number.quarantineSourceTenantId,
        number.quarantineSourceClinicId,
      );
      const [currentAssignment, conflictingMirror] = await Promise.all([
        tx.platformPlivoNumber.findUnique({
          where: { assignedClinicId: number.quarantineSourceClinicId },
        }),
        tx.clinicTelephonyConfig.findFirst({
          where: {
            plivoNumber: number.phoneNumber,
            clinicId: { not: number.quarantineSourceClinicId },
          },
          select: { clinicId: true },
        }),
      ]);
      if (currentAssignment) {
        throw new ConflictError("The previous clinic already has another IVR number.");
      }
      if (conflictingMirror) {
        throw new ConflictError("This IVR number is still mirrored by another clinic.");
      }

      const sourceTenantId = number.quarantineSourceTenantId;
      const sourceClinicId = number.quarantineSourceClinicId;
      const previousEnabled = number.quarantineSourceTelephonyEnabled;
      const changed = await tx.platformPlivoNumber.updateMany({
        where: {
          id: number.id,
          assignmentStatus: "QUARANTINED",
          assignedTenantId: null,
          assignedClinicId: null,
          quarantineSourceTenantId: sourceTenantId,
          quarantineSourceClinicId: sourceClinicId,
          quarantineSourceTelephonyEnabled: previousEnabled,
        },
        data: {
          assignmentStatus: "ASSIGNED",
          assignedTenantId: sourceTenantId,
          assignedClinicId: sourceClinicId,
          assignedAt: now,
          quarantinedAt: null,
          quarantinedUntil: null,
          quarantineSourceTenantId: null,
          quarantineSourceClinicId: null,
          quarantineSourceTelephonyEnabled: null,
        },
      });
      if (changed.count !== 1) {
        throw new ConflictError("This IVR number changed. Refresh and try again.");
      }

      const restoredEnabled = previousEnabled ?? false;
      await tx.clinicTelephonyConfig.upsert({
        where: { clinicId: sourceClinicId },
        create: {
          clinicId: sourceClinicId,
          plivoNumber: number.phoneNumber,
          enabled: restoredEnabled,
        },
        update: {
          plivoNumber: number.phoneNumber,
          enabled: restoredEnabled,
        },
      });
      await writeAuditLog(tx, {
        ...ownerAudit(owner, sourceTenantId),
        action: AUDIT_ACTIONS.PLIVO_NUMBER_ASSIGNMENT_RESTORED,
        afterValue: {
          phoneNumber: number.phoneNumber,
          tenantId: sourceTenantId,
          clinicId: sourceClinicId,
          assignmentStatus: "ASSIGNED",
          telephonyEnabled: restoredEnabled,
          previousTelephonyStateKnown: previousEnabled !== null,
        },
      });
      return {
        previousTelephonyStateKnown: previousEnabled !== null,
        telephonyEnabled: restoredEnabled,
      };
    });
  } catch (error: unknown) {
    if (isUniqueConstraintError(error)) {
      throw new ConflictError("The previous clinic already has another IVR number.");
    }
    throw error;
  }
}

export async function releasePlatformPlivoNumberEarly(
  owner: PlatformActorContext,
  numberId: string,
  reason: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const number = await tx.platformPlivoNumber.findUnique({ where: { id: numberId } });
    if (!number || number.assignmentStatus !== "QUARANTINED" ||
        !number.providerPresent || number.healthStatus !== "HEALTHY" ||
        number.assignedTenantId !== null || number.assignedClinicId !== null) {
      throw new ConflictError("This IVR number cannot be released early.");
    }
    const changed = await tx.platformPlivoNumber.updateMany({
      where: {
        id: number.id,
        assignmentStatus: "QUARANTINED",
        providerPresent: true,
        healthStatus: "HEALTHY",
        assignedTenantId: null,
        assignedClinicId: null,
      },
      data: {
        assignmentStatus: "AVAILABLE",
        quarantinedAt: null,
        quarantinedUntil: null,
        quarantineSourceTenantId: null,
        quarantineSourceClinicId: null,
        quarantineSourceTelephonyEnabled: null,
      },
    });
    if (changed.count !== 1) {
      throw new ConflictError("This IVR number changed. Refresh and try again.");
    }
    await writeAuditLog(tx, {
      action: AUDIT_ACTIONS.PLIVO_NUMBER_QUARANTINE_OVERRIDDEN,
      targetType: "PlatformPlivoNumber",
      targetId: number.id,
      actorUserId: owner.userId,
      actorPlatformRole: owner.platformRole,
      reason,
      afterValue: {
        phoneNumber: number.phoneNumber,
        assignmentStatus: "AVAILABLE",
        previousTenantId: number.quarantineSourceTenantId,
        previousClinicId: number.quarantineSourceClinicId,
      },
    });
  });
}
