import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";
import { normalizeConfiguredPhoneNumber } from "@/lib/telephony/phoneNumber";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

interface PlanItem {
  phoneNumber: string;
  tenantId: string;
  clinicId: string;
  clinicName: string;
  inventoryId: string | null;
  providerPresent: boolean;
  assignedAt: Date | null;
}

async function main() {
  const [configs, inventory] = await Promise.all([
    prisma.clinicTelephonyConfig.findMany({
      where: { plivoNumber: { not: null } },
      orderBy: { clinicId: "asc" },
      select: {
        plivoNumber: true,
        clinic: { select: { id: true, tenantId: true, name: true } },
      },
    }),
    prisma.platformPlivoNumber.findMany({ orderBy: { phoneNumber: "asc" } }),
  ]);

  const byPhone = new Map(inventory.map((row) => [row.phoneNumber, row]));
  const byClinic = new Map(
    inventory.filter((row) => row.assignedClinicId).map((row) => [row.assignedClinicId!, row]),
  );
  const plannedPhones = new Map<string, string>();
  const conflicts: string[] = [];
  const plan: PlanItem[] = [];

  for (const config of configs) {
    let phoneNumber: string;
    try {
      phoneNumber = normalizeConfiguredPhoneNumber(config.plivoNumber!);
    } catch {
      conflicts.push(`${config.clinic.name}: malformed legacy provider number`);
      continue;
    }
    const duplicateClinic = plannedPhones.get(phoneNumber);
    if (duplicateClinic && duplicateClinic !== config.clinic.id) {
      conflicts.push(`${phoneNumber}: canonical duplicate across legacy clinics`);
      continue;
    }
    plannedPhones.set(phoneNumber, config.clinic.id);
    const row = byPhone.get(phoneNumber);
    if (row?.assignedClinicId && row.assignedClinicId !== config.clinic.id) {
      conflicts.push(`${phoneNumber}: inventory is assigned to another clinic`);
      continue;
    }
    const clinicAssignment = byClinic.get(config.clinic.id);
    if (clinicAssignment && clinicAssignment.phoneNumber !== phoneNumber) {
      conflicts.push(`${config.clinic.name}: inventory contains a different assigned number`);
      continue;
    }
    if (row?.assignedTenantId && row.assignedTenantId !== config.clinic.tenantId) {
      conflicts.push(`${phoneNumber}: inventory tenant does not match the clinic tenant`);
      continue;
    }
    plan.push({
      phoneNumber,
      tenantId: config.clinic.tenantId,
      clinicId: config.clinic.id,
      clinicName: config.clinic.name,
      inventoryId: row?.id ?? null,
      providerPresent: row?.providerPresent ?? false,
      assignedAt: row?.assignedAt ?? null,
    });
  }

  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`Existing legacy assignments: ${configs.length}`);
  console.log(`Matched with synchronized Plivo inventory: ${plan.filter((item) => item.providerPresent).length}`);
  console.log(`Missing from synchronized Plivo inventory: ${plan.filter((item) => !item.providerPresent).length}`);
  console.log(`Conflicts: ${conflicts.length}`);
  for (const conflict of conflicts) console.log(`CONFLICT: ${conflict}`);
  for (const item of plan) {
    console.log(`${apply ? "WRITE" : "WOULD WRITE"}: ${item.phoneNumber} -> ${item.clinicName} (${item.clinicId})${item.providerPresent ? "" : " [MISSING_FROM_PROVIDER]"}`);
  }
  if (conflicts.length > 0) throw new Error("Backfill aborted because ambiguous conflicts require manual resolution.");
  if (!apply) {
    console.log("Dry run complete. Re-run with --apply after reviewing every mapping.");
    return;
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    for (const item of plan) {
      const row = await tx.platformPlivoNumber.upsert({
        where: { phoneNumber: item.phoneNumber },
        create: {
          phoneNumber: item.phoneNumber,
          providerPresent: false,
          healthStatus: "MISSING_FROM_PROVIDER",
          assignmentStatus: "ASSIGNED",
          assignedTenantId: item.tenantId,
          assignedClinicId: item.clinicId,
          assignedAt: now,
        },
        update: {
          assignmentStatus: "ASSIGNED",
          assignedTenantId: item.tenantId,
          assignedClinicId: item.clinicId,
          assignedAt: item.assignedAt ?? now,
          quarantinedAt: null,
          quarantinedUntil: null,
        },
        select: { id: true },
      });
      if (!item.inventoryId) {
        await writeAuditLog(tx, {
          action: AUDIT_ACTIONS.PLIVO_NUMBER_ASSIGNED,
          targetType: "Tenant",
          targetId: item.tenantId,
          afterValue: {
            phoneNumber: item.phoneNumber,
            tenantId: item.tenantId,
            clinicId: item.clinicId,
            inventoryId: row.id,
            assignmentStatus: "ASSIGNED",
          },
        });
      }
    }
  });
  console.log(`Applied ${plan.length} assignment mapping(s).`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
