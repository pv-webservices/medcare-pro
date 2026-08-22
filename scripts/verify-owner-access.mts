/**
 * Stage-2 verification — Platform Owner provisioning, the session registry, and
 * the boundary between the platform surface and clinic tenants. Exercised
 * against a LOCAL database.
 *
 *     npm run verify:owner
 *
 * The load-bearing claims here are the ones a security review would ask for:
 * a clinic user cannot reach the Owner surface, an Owner cannot be handed a
 * tenant-scoped context, revocation and suspension bite on the next request,
 * and the provisioning command cannot be tricked into minting a second Owner or
 * promoting an existing account.
 *
 * `create-owner` is invoked as a real subprocess rather than reimplemented, so
 * what is verified is the command operators will actually run.
 *
 * Refuses to run unless DATABASE_URL points at localhost: it writes and deletes
 * rows, and must never be aimed at a real clinic's data.
 */
import { execSync } from "node:child_process";
import { prisma } from "@/lib/prisma";
import { createAppSession, loadSessionContext, revokeSession } from "@/lib/appSession";
import { loadLiveSession, toTenantActor, UnauthenticatedError } from "@/lib/session";
import { toPlatformOwner } from "@/lib/platform/auth";
import { PlatformAuthorizationError } from "@/lib/platform/context";
import { getPlatformOverview } from "@/lib/platform/overview";
import { assertSafeAuditMetadata } from "@/lib/audit";
import { CUSTOMER_TENANT_WHERE } from "@/lib/platformTenant";
import { seedDefaultRoles } from "@/lib/defaultRoles";

const databaseUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl)) {
  console.error("Refusing to run: DATABASE_URL does not point at a local database.");
  process.exit(1);
}

let failures = 0;

function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL  ${label}`, detail === undefined ? "" : detail);
}

const TEST_TENANT_NAME = "verify-owner";
const OWNER_EMAIL = "verify-owner-primary@medcare.invalid";
const SECOND_OWNER_EMAIL = "verify-owner-second@medcare.invalid";
const STRONG_PASSWORD = "correct horse battery staple";

interface CommandResult {
  ok: boolean;
  output: string;
}

/**
 * Runs the real provisioning command with a controlled environment.
 *
 * The command string is a fixed literal and the inputs travel as environment
 * variables, so nothing a caller supplies is ever concatenated into a shell
 * line — which is also how an operator is meant to invoke it.
 */
function runCreateOwner(env: Record<string, string | undefined>): CommandResult {
  try {
    const output = execSync("npm run --silent create-owner", {
      env: { ...process.env, ...env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, output };
  } catch (error: unknown) {
    const failure = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

async function countOwners(): Promise<number> {
  return prisma.user.count({ where: { platformRole: "SUPER_ADMIN" } });
}

/** A throwaway clinic tenant with one Admin user, standing in for a customer. */
async function makeClinicTenant(label: string) {
  const tenant = await prisma.tenant.create({
    data: {
      businessName: TEST_TENANT_NAME,
      email: `${TEST_TENANT_NAME}-${label}-${Date.now()}@example.test`,
      // Stage 3 made tenants.slug NOT NULL. Mirrors the email's uniqueness.
      slug: `${TEST_TENANT_NAME}-${label}-${Date.now()}`,
      emailVerifiedAt: new Date(),
      status: "ACTIVE",
    },
    select: { id: true },
  });

  await seedDefaultRoles(prisma, tenant.id);

  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      name: `Clinic user ${label}`,
      email: `${TEST_TENANT_NAME}-${label}-${tenant.id}@example.test`,
      passwordHash: "x",
      emailVerifiedAt: new Date(),
      accountStatus: "ACTIVE",
      membershipStatus: "ACTIVE",
    },
    select: { id: true },
  });

  const sid = await createAppSession(prisma, { userId: user.id, tenantId: tenant.id });

  return { tenantId: tenant.id, userId: user.id, sid };
}

async function main(): Promise<void> {
  console.log("Stage 2 verification — Platform Owner access");
  console.log(`  database: ${databaseUrl.replace(/:\/\/[^@]*@/, "://***:***@")}`);

  const ownersBefore = await countOwners();
  check("no Platform Owner exists yet on this database", ownersBefore === 0, ownersBefore);
  if (ownersBefore !== 0) {
    console.log(
      "  (this script provisions and removes its own Owner. Remove the existing one,",
    );
    console.log("   or point DATABASE_URL at a scratch database, and run again.)");
  }

  console.log("\n1. create-owner refuses bad input");

  check(
    "refuses with no OWNER_PASSWORD",
    !runCreateOwner({ OWNER_EMAIL: OWNER_EMAIL, OWNER_NAME: "V", OWNER_PASSWORD: undefined }).ok,
  );
  check(
    "refuses a password under the 12-character minimum",
    !runCreateOwner({ OWNER_EMAIL, OWNER_NAME: "V", OWNER_PASSWORD: "short" }).ok,
  );
  check(
    "refuses a malformed email",
    !runCreateOwner({ OWNER_EMAIL: "not-an-email", OWNER_NAME: "V", OWNER_PASSWORD: STRONG_PASSWORD }).ok,
  );
  check("and created nothing while refusing", (await countOwners()) === ownersBefore);

  console.log("\n2. create-owner provisions exactly one Owner");

  const created = runCreateOwner({
    OWNER_EMAIL,
    OWNER_NAME: "Verify Owner",
    OWNER_PASSWORD: STRONG_PASSWORD,
  });
  check("the command succeeds", created.ok, created.output);

  const owner = await prisma.user.findUnique({
    where: { email: OWNER_EMAIL },
    select: {
      id: true,
      platformRole: true,
      accountStatus: true,
      membershipStatus: true,
      emailVerifiedAt: true,
      passwordHash: true,
      tenant: { select: { isPlatform: true, status: true, slug: true } },
      userRoles: { select: { id: true } },
    },
  });

  check("the Owner exists", owner !== null);
  check("with platformRole SUPER_ADMIN", owner?.platformRole === "SUPER_ADMIN");
  check("with an ACTIVE account", owner?.accountStatus === "ACTIVE");
  check("already email-verified, since there is no mailbox to confirm", owner?.emailVerifiedAt !== null);
  check("under the reserved platform tenant", owner?.tenant.isPlatform === true);
  check("whose slug is the reserved one", owner?.tenant.slug === "platform");
  check("with a real bcrypt hash, not the plaintext", owner?.passwordHash.startsWith("$2") === true);
  check("and the password is not stored anywhere in plaintext", owner?.passwordHash !== STRONG_PASSWORD);
  check(
    "the Owner holds NO clinic role: they sit outside tenant RBAC",
    owner?.userRoles.length === 0,
    owner?.userRoles,
  );

  console.log("\n3. the provisioning is audited, without secrets");

  const auditRows = await prisma.auditLog.findMany({
    where: { action: "OWNER_CREATED", targetId: owner?.id },
    select: { actorUserId: true, targetType: true, afterValue: true, reason: true },
  });

  check("exactly one OWNER_CREATED row was written", auditRows.length === 1, auditRows.length);
  check("targeting the User", auditRows[0]?.targetType === "User");
  check("with a null actor, since a shell command has no signed-in user", auditRows[0]?.actorUserId === null);

  let metadataSafe = true;
  try {
    assertSafeAuditMetadata(auditRows[0]?.afterValue);
  } catch {
    metadataSafe = false;
  }
  check("and metadata carrying no password, code or token", metadataSafe, auditRows[0]?.afterValue);

  console.log("\n4. create-owner will not mint a duplicate");

  const rerun = runCreateOwner({
    OWNER_EMAIL,
    OWNER_NAME: "Verify Owner",
    OWNER_PASSWORD: STRONG_PASSWORD,
  });
  check("re-running with the same address succeeds as a no-op", rerun.ok, rerun.output);
  check("and still exactly one Owner exists", (await countOwners()) === ownersBefore + 1);

  const second = runCreateOwner({
    OWNER_EMAIL: SECOND_OWNER_EMAIL,
    OWNER_NAME: "Second Owner",
    OWNER_PASSWORD: STRONG_PASSWORD,
  });
  check("a second, different Owner is REFUSED by default", !second.ok);
  check("and was not created", (await prisma.user.count({ where: { email: SECOND_OWNER_EMAIL } })) === 0);

  const clinic = await makeClinicTenant("promote");
  const clinicEmail = (await prisma.user.findUniqueOrThrow({
    where: { id: clinic.userId },
    select: { email: true },
  })).email;

  const promote = runCreateOwner({
    OWNER_EMAIL: clinicEmail,
    OWNER_NAME: "Sneaky",
    OWNER_PASSWORD: STRONG_PASSWORD,
    ALLOW_ADDITIONAL_OWNER: "1",
  });
  check("promoting an existing CLINIC user to Owner is REFUSED", !promote.ok, promote.output);

  const stillClinic = await prisma.user.findUniqueOrThrow({
    where: { id: clinic.userId },
    select: { platformRole: true, tenantId: true },
  });
  check("and that user keeps no platform role", stillClinic.platformRole === null);
  check("and stays in their own tenant", stillClinic.tenantId === clinic.tenantId);

  console.log("\n5. the session registry decides, not the token");

  const ownerId = owner!.id;
  const platformTenantId = (await prisma.user.findUniqueOrThrow({
    where: { id: ownerId },
    select: { tenantId: true },
  })).tenantId;

  const ownerSid = await createAppSession(prisma, {
    userId: ownerId,
    tenantId: platformTenantId,
    ip: "203.0.113.7",
    userAgent: "verify-owner",
  });

  check("a created session is found by its sid", (await loadSessionContext(ownerSid)) !== null);
  check("an unknown sid resolves to nothing", (await loadSessionContext("no-such-sid")) === null);

  check(
    "a token with no sid at all is unauthenticated",
    (await loadLiveSession(null, ownerId)).reason === "no-sid",
  );
  check(
    "a sid with no row behind it is unauthenticated",
    (await loadLiveSession("no-such-sid", ownerId)).reason === "unknown-sid",
  );
  check(
    "a live sid paired with somebody else's user id is refused",
    (await loadLiveSession(ownerSid, clinic.userId)).reason === "user-mismatch",
  );

  console.log("\n6. Owner authorization");

  const ownerResolved = await loadLiveSession(ownerSid, ownerId);
  let ownerContext;
  try {
    ownerContext = toPlatformOwner(ownerResolved);
    check("the Owner is admitted to the platform surface", true);
  } catch (error: unknown) {
    check("the Owner is admitted to the platform surface", false, error);
  }

  check("and the context carries no tenantId", !("tenantId" in (ownerContext ?? {})));
  check("but does carry the session it is running under", ownerContext?.sessionId === ownerSid);

  const clinicResolved = await loadLiveSession(clinic.sid, clinic.userId);
  try {
    toPlatformOwner(clinicResolved);
    check("a normal clinic user CANNOT reach the Owner surface", false, "was admitted");
  } catch (error: unknown) {
    check(
      "a normal clinic user CANNOT reach the Owner surface",
      error instanceof PlatformAuthorizationError && error.reason === "not-platform-user",
      error,
    );
  }

  try {
    toPlatformOwner(await loadLiveSession(null, null));
    check("an unauthenticated request CANNOT reach the Owner surface", false, "was admitted");
  } catch (error: unknown) {
    check(
      "an unauthenticated request CANNOT reach the Owner surface",
      error instanceof PlatformAuthorizationError && error.reason === "no-session",
      error,
    );
  }

  console.log("\n7. revocation and suspension bite on the next request");

  const revocable = await createAppSession(prisma, { userId: ownerId, tenantId: platformTenantId });
  check("a fresh session is live", (await loadLiveSession(revocable, ownerId)).context !== null);

  const revoked = await revokeSession(prisma, {
    sessionId: revocable,
    revokedById: ownerId,
    reason: "verify-owner",
  });
  check("revoking it reports success", revoked);
  check(
    "and the very next request is refused",
    (await loadLiveSession(revocable, ownerId)).reason === "revoked",
  );
  check("revoking twice is a no-op, so the first reason survives", !(await revokeSession(prisma, { sessionId: revocable })));
  const revokedRow = await prisma.appSession.findUniqueOrThrow({
    where: { id: revocable },
    select: { revokeReason: true, revokedById: true },
  });
  check("the original revoker is not overwritten", revokedRow.revokedById === ownerId);
  check("nor the original reason", revokedRow.revokeReason === "verify-owner");

  const expired = await prisma.appSession.create({
    data: {
      userId: ownerId,
      tenantId: platformTenantId,
      expiresAt: new Date(Date.now() - 1000),
    },
    select: { id: true },
  });
  check(
    "an expired session is refused",
    (await loadLiveSession(expired.id, ownerId)).reason === "expired",
  );

  await prisma.user.update({ where: { id: ownerId }, data: { accountStatus: "SUSPENDED" } });
  try {
    toPlatformOwner(await loadLiveSession(ownerSid, ownerId));
    check("a SUSPENDED Owner is locked out of the platform surface", false, "was admitted");
  } catch (error: unknown) {
    check(
      "a SUSPENDED Owner is locked out of the platform surface",
      error instanceof PlatformAuthorizationError && error.reason === "account-inactive",
      error,
    );
  }
  await prisma.user.update({ where: { id: ownerId }, data: { accountStatus: "ACTIVE" } });

  await prisma.user.update({ where: { id: ownerId }, data: { membershipStatus: "REMOVED" } });
  let ownerSurvivesMembership = false;
  try {
    toPlatformOwner(await loadLiveSession(ownerSid, ownerId));
    ownerSurvivesMembership = true;
  } catch {
    ownerSurvivesMembership = false;
  }
  check(
    "an Owner is NOT governed by tenant-level staff approval (membershipStatus ignored)",
    ownerSurvivesMembership,
  );
  await prisma.user.update({ where: { id: ownerId }, data: { membershipStatus: "ACTIVE" } });

  console.log("\n8. the Owner cannot obtain a tenant-scoped context");

  try {
    toTenantActor(await loadLiveSession(ownerSid, ownerId));
    check("requireActor refuses the reserved platform tenant", false, "handed out a tenant context");
  } catch (error: unknown) {
    check(
      "requireActor refuses the reserved platform tenant",
      error instanceof UnauthenticatedError && error.reason === "platform-tenant",
      error,
    );
  }

  console.log("\n9. clinic users get a tenant context, subject to the core rule");

  const clinicActor = toTenantActor(await loadLiveSession(clinic.sid, clinic.userId));
  check("an active clinic user is admitted", clinicActor.userId === clinic.userId);
  check("scoped to their own tenant", clinicActor.tenantId === clinic.tenantId);
  check("and never to the platform tenant", clinicActor.tenantId !== platformTenantId);

  const denials: Array<[string, () => Promise<void>, () => Promise<void>]> = [
    [
      "a SUSPENDED account is refused",
      () => prisma.user.update({ where: { id: clinic.userId }, data: { accountStatus: "SUSPENDED" } }).then(() => undefined),
      () => prisma.user.update({ where: { id: clinic.userId }, data: { accountStatus: "ACTIVE" } }).then(() => undefined),
    ],
    [
      "a REMOVED membership is refused",
      () => prisma.user.update({ where: { id: clinic.userId }, data: { membershipStatus: "REMOVED" } }).then(() => undefined),
      () => prisma.user.update({ where: { id: clinic.userId }, data: { membershipStatus: "ACTIVE" } }).then(() => undefined),
    ],
    [
      "a SUSPENDED clinic organisation is refused",
      () => prisma.tenant.update({ where: { id: clinic.tenantId }, data: { status: "SUSPENDED" } }).then(() => undefined),
      () => prisma.tenant.update({ where: { id: clinic.tenantId }, data: { status: "ACTIVE" } }).then(() => undefined),
    ],
  ];

  for (const [label, apply, undo] of denials) {
    await apply();
    try {
      toTenantActor(await loadLiveSession(clinic.sid, clinic.userId));
      check(label, false, "was admitted");
    } catch (error: unknown) {
      check(label, error instanceof UnauthenticatedError, error);
    }
    await undo();
  }

  console.log("\n10. the platform tenant stays out of customer figures");

  const overview = await getPlatformOverview({
    userId: ownerId,
    platformRole: "SUPER_ADMIN",
    sessionId: ownerSid,
  });
  const customerCount = await prisma.tenant.count({ where: CUSTOMER_TENANT_WHERE });
  const totalCount = await prisma.tenant.count();

  check("the overview counts only customer organisations", overview.totalCustomerTenants === customerCount);
  check("which is strictly fewer than every tenant row", customerCount < totalCount);
  check(
    "and the reserved row is not counted under any status",
    overview.totalCustomerTenants === totalCount - 1,
    { customerCount, totalCount },
  );
}

main()
  .catch((error: unknown) => {
    failures += 1;
    console.error("\nScript error:", error);
  })
  .finally(async () => {
    // Owners and test tenants created here are removed. Audit rows reference
    // the Owner only by `targetId`, which is not a foreign key, so the user can
    // go; the row stays, as an append-only trail should.
    const provisioned = await prisma.user.findMany({
      where: { email: { in: [OWNER_EMAIL, SECOND_OWNER_EMAIL] } },
      select: { id: true },
    });

    if (provisioned.length > 0) {
      // Scoped to the ids this run created. A blanket delete on
      // action = OWNER_CREATED would take a real operator's row with it.
      await prisma.auditLog.deleteMany({
        where: { action: "OWNER_CREATED", targetId: { in: provisioned.map((u) => u.id) } },
      });
      await prisma.user.deleteMany({ where: { id: { in: provisioned.map((u) => u.id) } } });
    }

    const stale = await prisma.tenant.findMany({
      where: { businessName: TEST_TENANT_NAME },
      select: { id: true },
    });
    for (const { id } of stale) {
      await prisma.tenant.delete({ where: { id } }).catch(() => {});
    }

    await prisma.$disconnect();
    console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
    process.exitCode = failures === 0 ? 0 : 1;
  });
