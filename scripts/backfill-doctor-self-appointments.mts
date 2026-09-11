/**
 * Safely migrates exact historical seeded Doctor roles from broad appointment
 * read to self read. Dry-run by default. A remote write requires both --apply
 * and --allow-remote; custom roles and saved layouts are never overwritten.
 */
import "dotenv/config";
import type { Prisma } from "@prisma/client";
import {
  planDoctorSelfRoleMigration,
  type DoctorSelfRoleMigrationPlan,
} from "@/lib/doctorSelfRoleMigration";
import { ROLE_KEYS } from "@/lib/defaultRoles";
import {
  DASHBOARD_LAYOUT_VERSION,
  doctorDefaultDashboardLayout,
} from "@/lib/dashboardWidgets";
import { prisma } from "@/lib/prisma";
import { toPermissionList } from "@/lib/rbac";

const APPLY = process.argv.includes("--apply");
const ALLOW_REMOTE = process.argv.includes("--allow-remote");
const databaseUrl = process.env.DATABASE_URL ?? "";
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl);

if (APPLY && !isLocal && !ALLOW_REMOTE) {
  console.error(
    "Refusing remote write. Review the dry run, then pass --apply --allow-remote explicitly.",
  );
  process.exit(1);
}

interface DoctorLinkDiagnostics {
  users: number;
  linked: number;
  unlinked: number;
  profileLinks: number;
  byClinic: Array<{
    clinic: string;
    users: number;
    linked: number;
    unlinked: number;
  }>;
}

interface Summary {
  tenantsScanned: number;
  doctorRolesScanned: number;
  alreadyCurrent: number;
  readyToMigrate: number;
  customised: number;
  unknown: number;
  behindAppointments: number;
  nonSystem: number;
  unlinkedDoctorUsers: number;
  doctorLinksFound: number;
  layoutsToCreate: number;
  adminRolesToUpdate: number;
}

function appointmentPermissions(permissions: readonly string[]): string[] {
  return permissions.filter((permission) => permission.startsWith("appointment:"));
}

function printRole(
  role: {
    id: string;
    name: string;
    key: string | null;
    isSystem: boolean;
    tenant: { businessName: string };
  },
  current: readonly string[],
  plan: DoctorSelfRoleMigrationPlan,
  willCreateLayout: boolean,
): void {
  const action =
    plan.action === "MIGRATE"
      ? APPLY
        ? "MIGRATE"
        : "WOULD MIGRATE"
      : plan.action === "ALREADY_CURRENT"
        ? "ALREADY CURRENT"
        : "SKIP";
  console.log(
    [
      `\n${action}`,
      `  Tenant: ${role.tenant.businessName}`,
      `  Role ID: ${role.id}`,
      `  Role: ${role.name}`,
      `  Role key: ${role.key ?? "(none)"}`,
      `  System role: ${role.isSystem ? "yes" : "no"}`,
      `  Permission count: ${new Set(current).size}`,
      `  Matched state: ${plan.classification}`,
      `  Current appointment permissions: ${appointmentPermissions(current).join(", ") || "(none)"}`,
      `  Proposed appointment permissions: ${appointmentPermissions(plan.nextPermissions).join(", ") || "(none)"}`,
      `  Role layout: ${willCreateLayout ? (APPLY ? "created My Day layout" : "would create My Day layout") : "unchanged"}`,
      `  Reason: ${plan.reason}`,
    ].join("\n"),
  );
}

async function doctorLinkDiagnostics(role: {
  id: string;
  tenantId: string;
}): Promise<DoctorLinkDiagnostics> {
  const assignments = await prisma.userRole.findMany({
    where: { roleId: role.id },
    select: {
      clinicId: true,
      clinic: { select: { name: true } },
      user: {
        select: {
          id: true,
          doctorProfiles: {
            select: {
              clinicId: true,
              clinic: { select: { tenantId: true } },
            },
          },
        },
      },
    },
  });

  const users = new Map<
    string,
    { linkedClinics: Set<string>; assignedClinics: Map<string, string> }
  >();
  for (const assignment of assignments) {
    const existing = users.get(assignment.user.id) ?? {
      linkedClinics: new Set<string>(),
      assignedClinics: new Map<string, string>(),
    };
    for (const profile of assignment.user.doctorProfiles) {
      if (profile.clinic.tenantId === role.tenantId) {
        existing.linkedClinics.add(profile.clinicId);
      }
    }
    const clinicKey = assignment.clinicId ?? "TENANT_WIDE";
    existing.assignedClinics.set(
      clinicKey,
      assignment.clinic?.name ?? "Tenant-wide assignment",
    );
    users.set(assignment.user.id, existing);
  }

  const clinicRows = new Map<
    string,
    { clinic: string; userIds: Set<string>; linkedIds: Set<string> }
  >();
  for (const [userId, user] of users) {
    for (const [clinicId, clinic] of user.assignedClinics) {
      const row = clinicRows.get(clinicId) ?? {
        clinic,
        userIds: new Set<string>(),
        linkedIds: new Set<string>(),
      };
      row.userIds.add(userId);
      const linked =
        clinicId === "TENANT_WIDE"
          ? user.linkedClinics.size > 0
          : user.linkedClinics.has(clinicId);
      if (linked) row.linkedIds.add(userId);
      clinicRows.set(clinicId, row);
    }
  }

  const linked = [...users.values()].filter(
    (user) => user.linkedClinics.size > 0,
  ).length;
  return {
    users: users.size,
    linked,
    unlinked: users.size - linked,
    profileLinks: [...users.values()].reduce(
      (total, user) => total + user.linkedClinics.size,
      0,
    ),
    byClinic: [...clinicRows.values()].map((row) => ({
      clinic: row.clinic,
      users: row.userIds.size,
      linked: row.linkedIds.size,
      unlinked: row.userIds.size - row.linkedIds.size,
    })),
  };
}

function printLinkDiagnostics(diagnostics: DoctorLinkDiagnostics): void {
  console.log("  Doctor portal-link diagnostics:");
  console.log(`    Doctor-role users: ${diagnostics.users}`);
  console.log(`    Linked users: ${diagnostics.linked}`);
  console.log(`    Unlinked users: ${diagnostics.unlinked}`);
  console.log(`    Explicit Doctor.userId links: ${diagnostics.profileLinks}`);
  for (const clinic of diagnostics.byClinic) {
    console.log(
      `    ${clinic.clinic}: ${clinic.users} users, ${clinic.linked} linked, ${clinic.unlinked} unlinked`,
    );
  }
  if (diagnostics.unlinked > 0) {
    console.log("    ROLLOUT BLOCKER — UNLINKED DOCTOR USER");
  }
}

async function main(): Promise<void> {
  console.log(
    APPLY
      ? "Doctor-self appointment backfill — APPLYING\n"
      : "Doctor-self appointment backfill — DRY RUN (zero writes)\n",
  );

  const roles = await prisma.role.findMany({
    where: {
      key: { in: [ROLE_KEYS.CLINIC_ADMIN, ROLE_KEYS.DOCTOR] },
      tenant: { isPlatform: false },
    },
    select: {
      id: true,
      key: true,
      name: true,
      permissions: true,
      isSystem: true,
      tenantId: true,
      tenant: { select: { businessName: true } },
      dashboardLayouts: { where: { userId: null }, select: { id: true } },
    },
    orderBy: [{ tenantId: "asc" }, { key: "asc" }, { id: "asc" }],
  });

  const summary: Summary = {
    tenantsScanned: await prisma.tenant.count({ where: { isPlatform: false } }),
    doctorRolesScanned: 0,
    alreadyCurrent: 0,
    readyToMigrate: 0,
    customised: 0,
    unknown: 0,
    behindAppointments: 0,
    nonSystem: 0,
    unlinkedDoctorUsers: 0,
    doctorLinksFound: 0,
    layoutsToCreate: 0,
    adminRolesToUpdate: 0,
  };

  for (const role of roles) {
    const current = [...toPermissionList(role.permissions)];
    const plan = planDoctorSelfRoleMigration({
      key: role.key,
      isSystem: role.isSystem,
      permissions: current,
    });
    const isDoctor = role.key === ROLE_KEYS.DOCTOR;
    const willCreateLayout =
      isDoctor && plan.action === "MIGRATE" && role.dashboardLayouts.length === 0;

    if (isDoctor) {
      summary.doctorRolesScanned += 1;
      if (plan.action === "ALREADY_CURRENT") summary.alreadyCurrent += 1;
      else if (plan.action === "MIGRATE") summary.readyToMigrate += 1;
      else if (plan.classification === "CUSTOMIZED") summary.customised += 1;
      else if (plan.classification === "KNOWN_PRE_APPOINTMENTS") {
        summary.behindAppointments += 1;
      } else if (plan.classification === "NON_SYSTEM_ROLE") {
        summary.nonSystem += 1;
      } else summary.unknown += 1;
      if (willCreateLayout) summary.layoutsToCreate += 1;
    } else if (plan.action === "MIGRATE") {
      summary.adminRolesToUpdate += 1;
    }

    printRole(role, current, plan, willCreateLayout);

    if (isDoctor && plan.action === "MIGRATE") {
      const diagnostics = await doctorLinkDiagnostics(role);
      printLinkDiagnostics(diagnostics);
      summary.unlinkedDoctorUsers += diagnostics.unlinked;
      summary.doctorLinksFound += diagnostics.linked;
    }

    if (plan.action !== "MIGRATE") continue;

    if (APPLY) {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.role.update({
            where: { id: role.id },
            data: { permissions: [...plan.nextPermissions] },
          });
          if (willCreateLayout) {
            await tx.dashboardLayout.create({
              data: {
                tenantId: role.tenantId,
                roleId: role.id,
                version: DASHBOARD_LAYOUT_VERSION,
                layout:
                  doctorDefaultDashboardLayout() as unknown as Prisma.InputJsonValue,
              },
            });
          }
        });
      } catch (error) {
        console.error(
          `Migration failed and rolled back for ${role.tenant.businessName} / ${role.name} (${role.id}).`,
          error,
        );
        throw error;
      }
    }
  }

  console.log(
    [
      "\nSummary",
      `  Tenants scanned: ${summary.tenantsScanned}`,
      `  Doctor roles scanned: ${summary.doctorRolesScanned}`,
      `  Already current: ${summary.alreadyCurrent}`,
      `  Known historical roles ready to migrate: ${summary.readyToMigrate}`,
      `  Customized roles skipped: ${summary.customised}`,
      `  Unknown states skipped: ${summary.unknown}`,
      `  Known pre-appointments roles skipped: ${summary.behindAppointments}`,
      `  Non-system Doctor roles skipped: ${summary.nonSystem}`,
      `  Unlinked Doctor users: ${summary.unlinkedDoctorUsers}`,
      `  Doctor links found: ${summary.doctorLinksFound}`,
      `  Role layouts that ${APPLY ? "were" : "would be"} created: ${summary.layoutsToCreate}`,
      `  Clinic Admin roles that ${APPLY ? "were" : "would be"} updated additively: ${summary.adminRolesToUpdate}`,
      !APPLY
        ? "\nNothing was written. Review every candidate before using --apply; remote writes also require --allow-remote."
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

main()
  .catch((error: unknown) => {
    console.error("Doctor-self appointment backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
