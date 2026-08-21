/**
 * Stage 1 backfill — populates the columns the expand migration added, against a
 * LOCAL database.
 *
 *     npm run stage1:backfill
 *
 * Idempotent: every write is conditional on the value not already being set, so
 * re-running is a no-op and a partial run can simply be repeated.
 *
 * Refuses to run unless DATABASE_URL points at localhost: it writes rows, and
 * must never be aimed at a real clinic's data.
 *
 * WHAT IT NEVER DOES
 *   - delete or rewrite an existing UserRole row (only the two new nullable
 *     columns are filled in);
 *   - overwrite a role's permissions, except on a seeded Admin role whose set is
 *     still EXACTLY the pre-Stage-1 catalogue, i.e. demonstrably untouched;
 *   - invent an actor: approvedById and assignedById stay NULL, because the
 *     original actor was never recorded;
 *   - touch tenants, clinics, patients, doctors, registrations or edit logs
 *     beyond the new columns.
 *
 * Run order: expand migration -> this script -> npm run stage1:verify ->
 * constrain migration.
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import {
  addMissingDefaultRoles,
  resolveRoleKeys,
  type RoleKey,
} from "@/lib/defaultRoles";
import { DEFAULT_PLAN_KEY, seedFeatureCatalogue } from "@/lib/defaultFeatures";
import {
  isUntouchedHistoricalAdminSet,
  STAGE_1_PERMISSIONS,
} from "@/lib/permissions";
import {
  PLATFORM_TENANT_NAME,
  PLATFORM_TENANT_SLUG,
} from "@/lib/platformTenant";
import { resolveUniqueSlug, slugifyBusinessName } from "@/lib/tenantSlug";

const databaseUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl)) {
  console.error(
    "Refusing to run: DATABASE_URL does not point at a local database.",
  );
  process.exit(1);
}

/**
 * The reserved tenant's contact address. It is never mailed — the row exists
 * only so a Platform Owner login can satisfy the non-null users.tenant_id
 * foreign key — but tenants.email is unique and NOT NULL, so it needs a value.
 */
const PLATFORM_TENANT_EMAIL =
  process.env.PLATFORM_TENANT_EMAIL?.trim() || "platform@medcare.invalid";

const prisma = new PrismaClient();

let changes = 0;
const note = (message: string): void => {
  changes += 1;
  console.log(`  ${message}`);
};

function permissionList(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

/** Stable fingerprint of a permission array, order-insensitive. */
function fingerprint(value: Prisma.JsonValue): string {
  return [...permissionList(value)].sort().join("|");
}

interface Snapshot {
  userRoleCount: number;
  userCount: number;
  tenantCount: number;
  /** roleId -> order-insensitive fingerprint of its permission array. */
  rolePermissions: Map<string, string>;
}

async function snapshot(): Promise<Snapshot> {
  const [userRoleCount, userCount, tenantCount, roles] = await Promise.all([
    prisma.userRole.count(),
    prisma.user.count(),
    prisma.tenant.count(),
    prisma.role.findMany({ select: { id: true, permissions: true } }),
  ]);

  return {
    userRoleCount,
    userCount,
    tenantCount,
    rolePermissions: new Map(
      roles.map((role) => [role.id, fingerprint(role.permissions)] as const),
    ),
  };
}

/**
 * The reserved platform tenant. Upserted by slug so a re-run finds the existing
 * row rather than creating a second one.
 */
async function ensurePlatformTenant(): Promise<void> {
  const existing = await prisma.tenant.findFirst({
    where: { OR: [{ slug: PLATFORM_TENANT_SLUG }, { isPlatform: true }] },
    select: { id: true, slug: true, isPlatform: true, status: true },
  });

  if (existing) {
    if (
      existing.slug !== PLATFORM_TENANT_SLUG ||
      !existing.isPlatform ||
      existing.status !== "ACTIVE"
    ) {
      await prisma.tenant.update({
        where: { id: existing.id },
        data: {
          slug: PLATFORM_TENANT_SLUG,
          isPlatform: true,
          status: "ACTIVE",
        },
      });
      note(`platform tenant ${existing.id}: corrected slug/flag/status`);
    }
    return;
  }

  const now = new Date();
  const created = await prisma.tenant.create({
    data: {
      businessName: PLATFORM_TENANT_NAME,
      email: PLATFORM_TENANT_EMAIL,
      slug: PLATFORM_TENANT_SLUG,
      isPlatform: true,
      status: "ACTIVE",
      // Verified so nothing in the FR-1.2 gate ever tries to mail this address.
      emailVerifiedAt: now,
      approvedAt: now,
      updatedAt: now,
    },
    select: { id: true },
  });
  note(`platform tenant created: ${created.id}`);
}

/**
 * Slugs for every customer tenant.
 *
 * Done in one pass rather than per-tenant so collisions resolve against slugs
 * assigned earlier in the SAME run, not only against what is already committed.
 * Ordered by createdAt so the oldest organisation keeps the unsuffixed slug and
 * a re-run reproduces the same assignment.
 */
async function backfillSlugs(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    where: { isPlatform: false },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, businessName: true, slug: true },
  });

  const taken = new Set<string>([
    ...tenants
      .map((tenant) => tenant.slug)
      .filter((slug): slug is string => slug !== null),
    PLATFORM_TENANT_SLUG,
  ]);

  for (const tenant of tenants) {
    if (tenant.slug) {
      continue;
    }
    const slug = resolveUniqueSlug(
      slugifyBusinessName(tenant.businessName),
      (candidate) => taken.has(candidate),
    );
    taken.add(slug);
    await prisma.tenant.update({ where: { id: tenant.id }, data: { slug } });
    note(`tenant ${tenant.id}: slug = ${slug}`);
  }
}

/**
 * The five columns that are NULLable in the database right now but NOT NULL in
 * the schema — and therefore NOT NULL in the generated Prisma client.
 *
 * That mismatch is inherent to expand-then-constrain: the client is generated
 * from the FINAL schema, so `where: { createdAt: null }` will not even typecheck
 * against it. Raw SQL is the honest tool for the intermediate state, and it also
 * turns what would be N round-trips into five statements.
 *
 * Every statement is guarded by `IS NULL`, so re-running changes nothing.
 *
 * The values are approximations, and the schema comments say so:
 *   - tenants/users.updated_at  <- the row's own created_at (never edited since)
 *   - roles.created_at/updated_at <- the owning TENANT's created_at (roles are
 *     seeded inside the signup transaction, so this is within milliseconds)
 *   - user_roles.created_at     <- the owning USER's created_at, the tighter
 *     bound: an assignment cannot predate the person it was made to
 */
async function backfillIntermediateColumns(): Promise<void> {
  const statements: readonly (readonly [string, string])[] = [
    [
      "tenants.updated_at",
      "UPDATE `tenants` SET `updated_at` = `created_at` WHERE `updated_at` IS NULL",
    ],
    [
      "users.updated_at",
      "UPDATE `users` SET `updated_at` = `created_at` WHERE `updated_at` IS NULL",
    ],
    [
      "roles.created_at",
      "UPDATE `roles` `r` JOIN `tenants` `t` ON `t`.`id` = `r`.`tenant_id` SET `r`.`created_at` = `t`.`created_at` WHERE `r`.`created_at` IS NULL",
    ],
    [
      "roles.updated_at",
      "UPDATE `roles` `r` JOIN `tenants` `t` ON `t`.`id` = `r`.`tenant_id` SET `r`.`updated_at` = `t`.`created_at` WHERE `r`.`updated_at` IS NULL",
    ],
    [
      "user_roles.created_at",
      "UPDATE `user_roles` `ur` JOIN `users` `u` ON `u`.`id` = `ur`.`user_id` SET `ur`.`created_at` = `u`.`created_at` WHERE `ur`.`created_at` IS NULL",
    ],
  ];

  for (const [label, sql] of statements) {
    const affected = await prisma.$executeRawUnsafe(sql);
    if (affected > 0) {
      note(`${label}: backfilled ${affected} row(s)`);
    }
  }
}

/**
 * Everything else, one tenant at a time and inside a transaction, so a tenant is
 * either fully migrated or untouched — never half-done.
 */
async function backfillTenant(
  tenantId: string,
  defaultPlanId: string | null,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: {
        id: true,
        createdAt: true,
        status: true,
        planId: true,
        emailVerifiedAt: true,
      },
    });

    // --- tenant lifecycle -------------------------------------------------
    // A verified organisation is one that could already log in, so it is
    // grandfathered straight to ACTIVE: the new approval gate must not
    // retroactively lock out anybody who works today. An unverified one stays
    // PENDING, which is what it effectively already was — lib/auth.ts blocks its
    // logins either way, so nothing changes for it.
    const tenantData: Prisma.TenantUpdateInput = {};

    if (tenant.status === "PENDING" && tenant.emailVerifiedAt !== null) {
      tenantData.status = "ACTIVE";
      // approvedById stays NULL: nobody approved this, it predates approvals.
      tenantData.approvedAt = tenant.createdAt;
    }
    if (tenant.planId === null && defaultPlanId !== null) {
      tenantData.plan = { connect: { id: defaultPlanId } };
    }
    if (Object.keys(tenantData).length > 0) {
      await tx.tenant.update({ where: { id: tenant.id }, data: tenantData });
      note(`tenant ${tenant.id}: ${Object.keys(tenantData).join(", ")}`);
    }

    // --- users ------------------------------------------------------------
    const users = await tx.user.findMany({
      where: { tenantId: tenant.id },
      select: {
        id: true,
        createdAt: true,
        accountStatus: true,
        membershipStatus: true,
        emailVerifiedAt: true,
      },
    });

    for (const user of users) {
      const data: Prisma.UserUpdateInput = {};

      // Both statuses go ACTIVE: these people are working in the product right
      // now. Anything else is a regression, not a migration.
      if (user.accountStatus === "PENDING") {
        data.accountStatus = "ACTIVE";
        data.approvedAt = user.createdAt;
      }
      if (user.membershipStatus === "PENDING") {
        data.membershipStatus = "ACTIVE";
      }
      // GRANDFATHERING, documented: per-user verification did not exist before
      // Stage 1, so a user that already existed inherits their organisation's.
      // This applies ONLY to pre-existing users. A member invited from Stage 5
      // onward must verify their own address — see the note on the column.
      if (user.emailVerifiedAt === null && tenant.emailVerifiedAt !== null) {
        data.emailVerifiedAt = tenant.emailVerifiedAt;
      }

      if (Object.keys(data).length > 0) {
        await tx.user.update({ where: { id: user.id }, data });
        note(`user ${user.id}: ${Object.keys(data).join(", ")}`);
      }
    }

    // --- roles: stable keys -----------------------------------------------
    const roles = await tx.role.findMany({
      where: { tenantId: tenant.id },
      select: { id: true, name: true, key: true, permissions: true },
    });

    const keys = resolveRoleKeys(
      roles.map((role) => ({
        id: role.id,
        name: role.name,
        permissions: permissionList(role.permissions),
      })),
    );

    for (const role of roles) {
      const key: RoleKey | null = keys.get(role.id) ?? null;
      if (role.key !== null || key === null) {
        continue;
      }
      await tx.role.update({
        where: { id: role.id },
        data: { key, isSystem: true },
      });
      note(`role ${role.name} (${role.id}): key = ${key}`);
    }

    // --- roles: create-only additions -------------------------------------
    const { created } = await addMissingDefaultRoles(tx, tenant.id);
    for (const name of created) {
      note(`tenant ${tenant.id}: created default role ${name}`);
    }
  });
}

/**
 * The ONLY place this script writes a role's permissions.
 *
 * A seeded Admin role holds a copy of the catalogue as it stood when the tenant
 * signed up. If that set is still EXACTLY the pre-Stage-1 catalogue then nobody
 * has edited it, and the twelve new keys can be appended safely. One key added
 * or removed by the tenant and the role is theirs, not ours — it is skipped and
 * left byte-for-byte as they left it.
 *
 * Owner needs nothing: it holds the wildcard, so new catalogue entries reach it
 * automatically.
 */
async function topUpUntouchedAdminRoles(): Promise<void> {
  const admins = await prisma.role.findMany({
    where: { key: "CLINIC_ADMIN", tenant: { isPlatform: false } },
    select: { id: true, name: true, permissions: true },
  });

  for (const admin of admins) {
    const current = permissionList(admin.permissions);

    if (!isUntouchedHistoricalAdminSet(current)) {
      console.log(
        `  skip role ${admin.name} (${admin.id}): customised, left exactly as it is`,
      );
      continue;
    }

    const missing = STAGE_1_PERMISSIONS.filter(
      (permission) => !current.includes(permission),
    );
    if (missing.length === 0) {
      continue;
    }

    await prisma.role.update({
      where: { id: admin.id },
      data: { permissions: [...current, ...missing] },
    });
    note(`role ${admin.name} (${admin.id}): +${missing.length} new permission(s)`);
  }
}

async function main(): Promise<void> {
  console.log("Stage 1 backfill");
  console.log(`  database: ${databaseUrl.replace(/:[^:@/]*@/, ":***@")}`);
  console.log();

  const before = await snapshot();
  console.log(
    `  before: ${before.tenantCount} tenant(s), ${before.userCount} user(s), ${before.userRoleCount} role assignment(s)`,
  );
  console.log();

  const catalogue = await seedFeatureCatalogue(prisma);
  if (catalogue.createdFeatures.length > 0) {
    note(`features created: ${catalogue.createdFeatures.join(", ")}`);
  }
  if (catalogue.createdPlan) {
    note(`plan created: ${DEFAULT_PLAN_KEY}`);
  }
  if (catalogue.linkedFeatures.length > 0) {
    note(`plan features linked: ${catalogue.linkedFeatures.join(", ")}`);
  }

  await ensurePlatformTenant();
  await backfillSlugs();
  await backfillIntermediateColumns();

  const defaultPlan = await prisma.plan.findUnique({
    where: { key: DEFAULT_PLAN_KEY },
    select: { id: true },
  });

  const tenants = await prisma.tenant.findMany({
    where: { isPlatform: false },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });

  for (const tenant of tenants) {
    await backfillTenant(tenant.id, defaultPlan?.id ?? null);
  }

  await topUpUntouchedAdminRoles();

  // --- invariants, checked in-process against the pre-run snapshot ---------
  // These are the promises made in the Stage 1 plan. If any of them breaks, the
  // run is reported as failed and the constrain migration must not be applied.
  const after = await snapshot();
  const failures: string[] = [];

  if (after.userRoleCount !== before.userRoleCount) {
    failures.push(
      `user_roles count changed: ${before.userRoleCount} -> ${after.userRoleCount}`,
    );
  }
  if (after.userCount !== before.userCount) {
    failures.push(`users count changed: ${before.userCount} -> ${after.userCount}`);
  }

  for (const [roleId, wasFingerprint] of before.rolePermissions) {
    const nowFingerprint = after.rolePermissions.get(roleId);

    if (nowFingerprint === undefined) {
      failures.push(`role ${roleId} disappeared`);
      continue;
    }
    if (nowFingerprint === wasFingerprint) {
      continue;
    }

    // The one sanctioned change: an untouched seeded Admin gaining exactly the
    // Stage 1 keys, and losing nothing.
    const was = wasFingerprint.split("|");
    const now = nowFingerprint.split("|");
    const added = now.filter((permission) => !was.includes(permission));
    const removed = was.filter((permission) => !now.includes(permission));

    const onlyStage1Added =
      removed.length === 0 &&
      added.every((permission) => STAGE_1_PERMISSIONS.includes(permission));

    if (!onlyStage1Added) {
      failures.push(
        `role ${roleId} permissions changed unexpectedly (added: ${added.join(",") || "none"}; removed: ${removed.join(",") || "none"})`,
      );
    }
  }

  console.log();
  if (failures.length > 0) {
    console.error("BACKFILL INVARIANTS FAILED — do NOT apply the constrain migration:");
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Backfill complete. ${changes} change(s) applied.`);
  console.log("Next: npm run stage1:verify, then apply the constrain migration.");
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`Backfill failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
