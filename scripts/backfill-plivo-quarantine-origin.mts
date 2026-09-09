import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { CUSTOMER_TENANT_WHERE } from "@/lib/platformTenant";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");
const MATCH_WINDOW_MS = 5 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function main() {
  const [rows, audits] = await Promise.all([
    prisma.platformPlivoNumber.findMany({
      where: {
        assignmentStatus: "QUARANTINED",
        OR: [
          { quarantineSourceTenantId: null },
          { quarantineSourceClinicId: null },
        ],
      },
      orderBy: { phoneNumber: "asc" },
    }),
    prisma.auditLog.findMany({
      where: { action: "PLIVO_NUMBER_UNASSIGNED" },
      orderBy: { createdAt: "desc" },
      take: 1000,
      select: { createdAt: true, targetId: true, afterValue: true },
    }),
  ]);

  const plan: Array<{
    id: string;
    phoneNumber: string;
    tenantId: string;
    clinicId: string;
    clinicName: string;
    quarantinedAt: Date;
    quarantinedUntil: Date;
  }> = [];
  const conflicts: string[] = [];

  for (const row of rows) {
    if (row.quarantineSourceTenantId || row.quarantineSourceClinicId ||
        !row.quarantinedAt || !row.quarantinedUntil ||
        row.assignedTenantId || row.assignedClinicId) {
      conflicts.push(`${row.phoneNumber}: quarantine state is incomplete or already partially repaired`);
      continue;
    }
    const audit = audits.find((candidate) => {
      if (!isRecord(candidate.afterValue)) return false;
      const metadata = candidate.afterValue;
      const auditUntil = typeof metadata.quarantinedUntil === "string"
        ? new Date(metadata.quarantinedUntil)
        : null;
      return metadata.phoneNumber === row.phoneNumber &&
        metadata.assignmentStatus === "QUARANTINED" &&
        typeof metadata.tenantId === "string" &&
        typeof metadata.clinicId === "string" &&
        candidate.targetId === metadata.tenantId &&
        auditUntil !== null && !Number.isNaN(auditUntil.getTime()) &&
        auditUntil.getTime() === row.quarantinedUntil!.getTime() &&
        Math.abs(candidate.createdAt.getTime() - row.quarantinedAt!.getTime()) <= MATCH_WINDOW_MS;
    });
    if (!audit || !isRecord(audit.afterValue)) {
      conflicts.push(`${row.phoneNumber}: no trustworthy matching unassign audit event`);
      continue;
    }
    const tenantId = audit.afterValue.tenantId as string;
    const clinicId = audit.afterValue.clinicId as string;
    const [tenant, clinic] = await Promise.all([
      prisma.tenant.findFirst({
        where: { id: tenantId, ...CUSTOMER_TENANT_WHERE },
        select: { id: true },
      }),
      prisma.clinic.findFirst({
        where: { id: clinicId, tenantId },
        select: { id: true, name: true },
      }),
    ]);
    if (!tenant || !clinic) {
      conflicts.push(`${row.phoneNumber}: audited tenant or clinic no longer validates`);
      continue;
    }
    plan.push({
      id: row.id,
      phoneNumber: row.phoneNumber,
      tenantId,
      clinicId,
      clinicName: clinic.name,
      quarantinedAt: row.quarantinedAt,
      quarantinedUntil: row.quarantinedUntil,
    });
  }

  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`Quarantined rows missing origin: ${rows.length}`);
  console.log(`Trustworthy audit matches: ${plan.length}`);
  console.log(`Conflicts: ${conflicts.length}`);
  for (const conflict of conflicts) console.log(`CONFLICT: ${conflict}`);
  for (const item of plan) {
    console.log(`${apply ? "WRITE" : "WOULD WRITE"}: ${item.phoneNumber} -> ${item.clinicName}; previous telephony state: UNKNOWN`);
  }
  if (conflicts.length > 0) {
    throw new Error("Backfill aborted because quarantine origins could not be proven safely.");
  }
  if (!apply) {
    console.log("Dry run complete. Re-run with --apply after reviewing every mapping.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const item of plan) {
      const changed = await tx.platformPlivoNumber.updateMany({
        where: {
          id: item.id,
          assignmentStatus: "QUARANTINED",
          assignedTenantId: null,
          assignedClinicId: null,
          quarantinedAt: item.quarantinedAt,
          quarantinedUntil: item.quarantinedUntil,
          quarantineSourceTenantId: null,
          quarantineSourceClinicId: null,
        },
        data: {
          quarantineSourceTenantId: item.tenantId,
          quarantineSourceClinicId: item.clinicId,
          quarantineSourceTelephonyEnabled: null,
        },
      });
      if (changed.count !== 1) {
        throw new Error(`${item.phoneNumber}: quarantine row changed during backfill`);
      }
    }
  });
  console.log(`Applied ${plan.length} quarantine origin mapping(s).`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
