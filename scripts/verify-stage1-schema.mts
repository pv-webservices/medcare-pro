/**
 * Stage 1 verification — schema, backfill and data-preservation invariants,
 * exercised against a LOCAL database.
 *
 *     npm run stage1:verify
 *
 * Run it TWICE:
 *   - after the backfill and BEFORE the constrain migration. Everything except
 *     the constraint section must pass; that section reports "not yet applied".
 *   - after the constrain migration. Everything must pass.
 *
 * The checks here are deliberately ABSOLUTE — they need no "before" snapshot,
 * so they stay meaningful long after the migration has been forgotten. The
 * count-based comparisons live in the backfill script itself, which holds the
 * pre-run state in memory.
 *
 * Refuses to run unless DATABASE_URL points at a local database.
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import { DEFAULT_FEATURES, DEFAULT_PLAN_KEY } from "@/lib/defaultFeatures";
import { DEFAULT_ROLES, ROLE_KEYS } from "@/lib/defaultRoles";
import { STAGE_1_PERMISSIONS, WILDCARD } from "@/lib/permissions";
import {
  CUSTOMER_TENANT_WHERE,
  PLATFORM_TENANT_SLUG,
} from "@/lib/platformTenant";
import { isReservedSlug } from "@/lib/tenantSlug";

const databaseUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl)) {
  console.error(
    "Refusing to run: DATABASE_URL does not point at a local database.",
  );
  process.exit(1);
}

const prisma = new PrismaClient();

let failures = 0;
let skipped = 0;

function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL  ${label}`, detail === undefined ? "" : detail);
}

function skip(label: string, why: string): void {
  skipped += 1;
  console.log(`  SKIP  ${label} — ${why}`);
}

function section(title: string): void {
  console.log();
  console.log(title);
}

function permissionList(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

/** One scalar out of information_schema, for the checks Prisma cannot express. */
async function scalar(sql: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ n: bigint | number }[]>(sql);
  return Number(rows[0]?.n ?? 0);
}

const DB = "DATABASE()";

async function verifyMigrationApplied(): Promise<void> {
  section("1. Expand migration applied");

  const NEW_TABLES = [
    "app_sessions",
    "login_codes",
    "invitations",
    "plans",
    "features",
    "plan_features",
    "tenant_feature_overrides",
    "role_feature_access",
    "audit_logs",
    "rate_limit_buckets",
  ];

  const present = await scalar(
    `SELECT COUNT(*) AS n FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ${DB}
       AND TABLE_NAME IN (${NEW_TABLES.map((t) => `'${t}'`).join(", ")})`,
  );
  check(`all ${NEW_TABLES.length} new tables exist`, present === NEW_TABLES.length, {
    found: present,
  });

  const NEW_COLUMNS: readonly (readonly [string, string])[] = [
    ["tenants", "slug"],
    ["tenants", "status"],
    ["tenants", "is_platform"],
    ["tenants", "plan_id"],
    ["users", "account_status"],
    ["users", "membership_status"],
    ["users", "platform_role"],
    ["users", "email_verified_at"],
    ["roles", "key"],
    ["roles", "is_system"],
    ["user_roles", "assigned_by_id"],
    ["user_roles", "created_at"],
    ["verification_tokens", "purpose"],
  ];

  const columns = await scalar(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ${DB} AND (${NEW_COLUMNS.map(
       ([t, c]) => `(TABLE_NAME = '${t}' AND COLUMN_NAME = '${c}')`,
     ).join(" OR ")})`,
  );
  check(
    `all ${NEW_COLUMNS.length} new columns on existing tables exist`,
    columns === NEW_COLUMNS.length,
    { found: columns },
  );
}

async function verifyPlatformTenant(): Promise<void> {
  section("2. Platform tenant isolation");

  const platforms = await prisma.tenant.findMany({
    where: { isPlatform: true },
    select: { id: true, slug: true, status: true, businessName: true },
  });

  check("exactly one platform tenant exists", platforms.length === 1, {
    found: platforms.length,
  });

  const platform = platforms[0];
  if (!platform) {
    return;
  }

  check(
    `platform tenant slug is "${PLATFORM_TENANT_SLUG}"`,
    platform.slug === PLATFORM_TENANT_SLUG,
    platform.slug,
  );
  check("platform tenant is ACTIVE", platform.status === "ACTIVE", platform.status);

  // The load-bearing check: the filter every customer query composes must not
  // return this row. A missed filter here is how the Owner's bookkeeping tenant
  // would show up in a customer's clinic list.
  const leaked = await prisma.tenant.count({
    where: { ...CUSTOMER_TENANT_WHERE, id: platform.id },
  });
  check("CUSTOMER_TENANT_WHERE excludes the platform tenant", leaked === 0, {
    leaked,
  });

  const customerCount = await prisma.tenant.count({ where: CUSTOMER_TENANT_WHERE });
  const totalCount = await prisma.tenant.count();
  check(
    "customer count is exactly total minus the platform row",
    customerCount === totalCount - 1,
    { customerCount, totalCount },
  );

  // Nothing should be living under the platform tenant yet. The create-owner
  // command in Stage 2 is the only thing that may ever add a user here, and it
  // never adds a clinic, patient or registration.
  const platformClinics = await prisma.clinic.count({
    where: { tenantId: platform.id },
  });
  check("platform tenant owns no clinics", platformClinics === 0, platformClinics);
}

async function verifySlugs(): Promise<void> {
  section("3. Tenant slugs");

  const tenants = await prisma.tenant.findMany({
    select: { id: true, slug: true, isPlatform: true, businessName: true },
  });

  const missing = tenants.filter((tenant) => !tenant.slug);
  check("every tenant has a slug", missing.length === 0, missing.map((t) => t.id));

  const slugs = tenants
    .map((tenant) => tenant.slug)
    .filter((slug): slug is string => slug !== null);
  check(
    "slugs are unique",
    new Set(slugs).size === slugs.length,
    slugs.length - new Set(slugs).size,
  );

  const reserved = tenants.filter(
    (tenant) => !tenant.isPlatform && tenant.slug && isReservedSlug(tenant.slug),
  );
  check(
    "no customer tenant holds a reserved slug",
    reserved.length === 0,
    reserved.map((t) => t.slug),
  );
}

async function verifyBackfilledColumns(): Promise<void> {
  section("4. Backfill completeness (no un-backfilled rows left)");

  // Raw SQL: these columns are NOT NULL in the generated client, so Prisma
  // cannot express "IS NULL" against them. See the same note in the backfill.
  const nullChecks: readonly (readonly [string, string])[] = [
    ["tenants.updated_at", "SELECT COUNT(*) AS n FROM `tenants` WHERE `updated_at` IS NULL"],
    ["users.updated_at", "SELECT COUNT(*) AS n FROM `users` WHERE `updated_at` IS NULL"],
    ["roles.created_at", "SELECT COUNT(*) AS n FROM `roles` WHERE `created_at` IS NULL"],
    ["roles.updated_at", "SELECT COUNT(*) AS n FROM `roles` WHERE `updated_at` IS NULL"],
    [
      "user_roles.created_at",
      "SELECT COUNT(*) AS n FROM `user_roles` WHERE `created_at` IS NULL",
    ],
  ];

  for (const [label, sql] of nullChecks) {
    const remaining = await scalar(sql);
    check(`${label}: no NULLs remain`, remaining === 0, remaining);
  }

  const orphanUsers = await scalar(
    "SELECT COUNT(*) AS n FROM `users` `u` LEFT JOIN `tenants` `t` ON `t`.`id` = `u`.`tenant_id` WHERE `t`.`id` IS NULL",
  );
  check("every user belongs to a real tenant", orphanUsers === 0, orphanUsers);

  const unverifiedPurpose = await scalar(
    "SELECT COUNT(*) AS n FROM `verification_tokens` WHERE `purpose` IS NULL OR `purpose` = ''",
  );
  check(
    "every verification token carries a purpose",
    unverifiedPurpose === 0,
    unverifiedPurpose,
  );
}

async function verifyUserRolePreservation(): Promise<void> {
  section("5. UserRole preservation (the load-bearing promise)");

  // Nothing in Stage 1 assigns a role, so every row must still say "actor
  // unknown". A non-NULL value here means something wrote an assignment.
  const attributed = await prisma.userRole.count({
    where: { assignedById: { not: null } },
  });
  check(
    "no UserRole row has an invented assignedById",
    attributed === 0,
    attributed,
  );

  // An assignment cannot predate the person it was made to. This is the
  // absolute form of "createdAt was backfilled from the owning user" and it
  // stays true for rows created legitimately after the migration.
  const impossible = await scalar(
    "SELECT COUNT(*) AS n FROM `user_roles` `ur` JOIN `users` `u` ON `u`.`id` = `ur`.`user_id` WHERE `ur`.`created_at` < `u`.`created_at`",
  );
  check(
    "no UserRole predates the user it belongs to",
    impossible === 0,
    impossible,
  );

  const crossTenant = await scalar(
    "SELECT COUNT(*) AS n FROM `user_roles` `ur` JOIN `users` `u` ON `u`.`id` = `ur`.`user_id` JOIN `roles` `r` ON `r`.`id` = `ur`.`role_id` WHERE `u`.`tenant_id` <> `r`.`tenant_id`",
  );
  check(
    "no UserRole joins a user and a role from different tenants",
    crossTenant === 0,
    crossTenant,
  );

  const clinicMismatch = await scalar(
    "SELECT COUNT(*) AS n FROM `user_roles` `ur` JOIN `users` `u` ON `u`.`id` = `ur`.`user_id` JOIN `clinics` `c` ON `c`.`id` = `ur`.`clinic_id` WHERE `c`.`tenant_id` <> `u`.`tenant_id`",
  );
  check(
    "no clinic-scoped UserRole points outside its own tenant",
    clinicMismatch === 0,
    clinicMismatch,
  );
}

async function verifyRoles(): Promise<void> {
  section("6. Roles, keys and permission preservation");

  const tenants = await prisma.tenant.findMany({
    where: CUSTOMER_TENANT_WHERE,
    select: {
      id: true,
      businessName: true,
      status: true,
      roles: {
        select: { id: true, name: true, key: true, permissions: true, isSystem: true },
      },
      users: { select: { id: true } },
    },
  });

  const duplicateKeys: string[] = [];
  const missingDefaults: string[] = [];
  const strayStage1: string[] = [];

  for (const tenant of tenants) {
    const keys = tenant.roles
      .map((role) => role.key)
      .filter((key): key is string => key !== null);
    if (new Set(keys).size !== keys.length) {
      duplicateKeys.push(tenant.id);
    }

    // Doctor and Receptionist must have been added by the create-only path.
    const names = new Set(tenant.roles.map((role) => role.name));
    for (const role of DEFAULT_ROLES) {
      if (!names.has(role.name) && !keys.includes(role.key)) {
        missingDefaults.push(`${tenant.businessName}: ${role.name}`);
      }
    }

    // The twelve Stage 1 permission keys must appear ONLY on the seeded Admin
    // role. Anywhere else means the backfill wrote to a role it should not have.
    for (const role of tenant.roles) {
      if (role.key === ROLE_KEYS.CLINIC_ADMIN) {
        continue;
      }
      const held = permissionList(role.permissions);
      const stray = STAGE_1_PERMISSIONS.filter((permission) =>
        held.includes(permission),
      );
      if (stray.length > 0) {
        strayStage1.push(`${tenant.businessName}/${role.name}: ${stray.join(",")}`);
      }
    }
  }

  check("no tenant has two roles with the same key", duplicateKeys.length === 0, duplicateKeys);
  check("every tenant has all default roles", missingDefaults.length === 0, missingDefaults);
  check(
    "Stage 1 permissions were added only to seeded Admin roles",
    strayStage1.length === 0,
    strayStage1,
  );

  // The existing lockout guard, re-checked after the migration: lib/roles.ts
  // refuses any edit that leaves an account without an account-wide wildcard
  // holder, and the backfill must not have created that state either.
  const ownerless: string[] = [];
  for (const tenant of tenants) {
    if (tenant.status !== "ACTIVE" || tenant.users.length === 0) {
      continue;
    }
    const wildcardRoleIds = tenant.roles
      .filter((role) => permissionList(role.permissions).includes(WILDCARD))
      .map((role) => role.id);

    const holders = await prisma.userRole.count({
      where: {
        roleId: { in: wildcardRoleIds },
        clinicId: null,
        user: { tenantId: tenant.id },
      },
    });
    if (holders === 0) {
      ownerless.push(tenant.businessName);
    }
  }
  check(
    "every active tenant still has an account-wide wildcard holder",
    ownerless.length === 0,
    ownerless,
  );
}

async function verifyStatuses(): Promise<void> {
  section("7. Status grandfathering (nobody lost access)");

  // A verified organisation could log in before Stage 1, so it must be ACTIVE
  // now. If this fails, the approval gate has retroactively locked out a live
  // customer — the single worst outcome this migration could have.
  const verifiedNotActive = await prisma.tenant.count({
    where: {
      ...CUSTOMER_TENANT_WHERE,
      emailVerifiedAt: { not: null },
      status: { not: "ACTIVE" },
    },
  });
  check(
    "every verified tenant is ACTIVE",
    verifiedNotActive === 0,
    verifiedNotActive,
  );

  const strandedUsers = await prisma.user.count({
    where: {
      tenant: { ...CUSTOMER_TENANT_WHERE, status: "ACTIVE" },
      OR: [
        { accountStatus: { not: "ACTIVE" } },
        { membershipStatus: { not: "ACTIVE" } },
      ],
    },
  });
  check(
    "no user of an active tenant is left non-ACTIVE",
    strandedUsers === 0,
    strandedUsers,
  );

  const unverifiedInherited = await prisma.user.count({
    where: {
      emailVerifiedAt: { not: null },
      tenant: { emailVerifiedAt: null },
    },
  });
  check(
    "no user is marked verified under an unverified tenant",
    unverifiedInherited === 0,
    unverifiedInherited,
  );

  // Nothing has been granted a platform role yet: create-owner is Stage 2.
  const platformRoleHolders = await prisma.user.count({
    where: { platformRole: { not: null } },
  });
  check(
    "no user holds a platform role yet (create-owner is Stage 2)",
    platformRoleHolders === 0,
    platformRoleHolders,
  );
}

async function verifyFeatureCatalogue(): Promise<void> {
  section("8. Feature catalogue and default plan");

  const features = await prisma.feature.findMany({
    select: { key: true, tier: true, globalEnabled: true },
  });
  const byKey = new Map(features.map((feature) => [feature.key, feature] as const));

  const missing = DEFAULT_FEATURES.filter((feature) => !byKey.has(feature.key));
  check("every default feature is seeded", missing.length === 0, missing.map((f) => f.key));

  const marketing = byKey.get("marketing");
  check(
    "the unbuilt marketing feature is globally disabled",
    marketing?.globalEnabled === false,
    marketing,
  );

  const plan = await prisma.plan.findUnique({
    where: { key: DEFAULT_PLAN_KEY },
    select: {
      id: true,
      features: { select: { enabled: true, feature: { select: { key: true } } } },
    },
  });
  check(`the "${DEFAULT_PLAN_KEY}" plan exists`, plan !== null);

  if (plan) {
    const planned = new Set(
      plan.features.filter((row) => row.enabled).map((row) => row.feature.key),
    );
    const expected = DEFAULT_FEATURES.filter((feature) => feature.inDefaultPlan);
    const absent = expected.filter((feature) => !planned.has(feature.key));
    check(
      "the default plan includes every core feature",
      absent.length === 0,
      absent.map((f) => f.key),
    );

    // Without this, Stage 8 would deny every feature to every existing tenant
    // the day enforcement lands.
    const planless = await prisma.tenant.count({
      where: { ...CUSTOMER_TENANT_WHERE, planId: null },
    });
    check("every customer tenant is on a plan", planless === 0, planless);
  }

  // Layer 3 is opt-in: an empty table means "no Tenant Admin has expressed an
  // opinion yet", which lib/featureResolution.ts reads as inherit-the-tenant.
  const roleAccess = await prisma.roleFeatureAccess.count();
  check(
    "no RoleFeatureAccess rows were invented (absence inherits the tenant)",
    roleAccess === 0,
    roleAccess,
  );
}

async function verifyConstraints(): Promise<void> {
  section("9. Constrain migration (run this section again after applying it)");

  const uniques = await scalar(
    `SELECT COUNT(DISTINCT INDEX_NAME) AS n FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ${DB}
       AND INDEX_NAME IN ('tenants_slug_key', 'roles_tenant_id_key_key')`,
  );

  if (uniques === 0) {
    skip("unique indexes present", "constrain migration not applied yet");
    skip("constrained columns are NOT NULL", "constrain migration not applied yet");
    return;
  }

  check("both deferred unique indexes exist", uniques === 2, { found: uniques });

  const stillNullable = await scalar(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ${DB} AND IS_NULLABLE = 'YES' AND (
       (TABLE_NAME = 'tenants'    AND COLUMN_NAME = 'updated_at') OR
       (TABLE_NAME = 'users'      AND COLUMN_NAME = 'updated_at') OR
       (TABLE_NAME = 'roles'      AND COLUMN_NAME IN ('created_at', 'updated_at')) OR
       (TABLE_NAME = 'user_roles' AND COLUMN_NAME = 'created_at'))`,
  );
  check("all five constrained columns are NOT NULL", stillNullable === 0, stillNullable);

  // tenants.slug stays nullable until Stage 3 rewrites signup to generate one.
  const slugNullable = await scalar(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ${DB} AND TABLE_NAME = 'tenants'
       AND COLUMN_NAME = 'slug' AND IS_NULLABLE = 'YES'`,
  );
  check(
    "tenants.slug is still nullable (tightened in Stage 3, with signup)",
    slugNullable === 1,
    slugNullable,
  );
}

async function main(): Promise<void> {
  console.log("Stage 1 schema verification");
  console.log(`  database: ${databaseUrl.replace(/:[^:@/]*@/, ":***@")}`);

  await verifyMigrationApplied();
  await verifyPlatformTenant();
  await verifySlugs();
  await verifyBackfilledColumns();
  await verifyUserRolePreservation();
  await verifyRoles();
  await verifyStatuses();
  await verifyFeatureCatalogue();
  await verifyConstraints();

  console.log();
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED.`);
    process.exitCode = 1;
    return;
  }
  console.log(
    skipped > 0
      ? `All checks passed (${skipped} skipped — apply the constrain migration and re-run).`
      : "All checks passed.",
  );
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`Verification failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
