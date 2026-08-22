/**
 * Stage-11 verification — the audit trail's read surfaces, exercised against a
 * LOCAL database.
 *
 *     npm run verify:stage11
 *
 * The unit tests cover the description table and the permission snapshot, both
 * pure. What only a database can answer is the question this stage is really
 * about: whether one organisation's activity log can ever show another
 * organisation's rows.
 *
 * Almost everything here is written from the direction someone would push on
 * it — a tenant admin trying to see a neighbour's team changes, a role without
 * the new permission trying the URL, and the withheld columns (ip, userAgent,
 * beforeValue, afterValue) trying to reach a tenant screen.
 *
 * This script WRITES AUDIT ROWS DIRECTLY. They are the input the read layer is
 * being tested on, and the writers that would otherwise produce them are spread
 * across six stages and several transactions.
 *
 * Refuses to run unless DATABASE_URL points at localhost.
 */
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";
import { getAuditTrail } from "@/lib/auditTrail";
import { toAuditCsv, auditCsvFilename } from "@/lib/auditCsv";
import { seedDefaultRoles } from "@/lib/defaultRoles";
import { seedFeatureCatalogue } from "@/lib/defaultFeatures";
import { PermissionError, type ActorContext } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import {
  ALL_PERMISSIONS,
  PRE_STAGE_11_PERMISSIONS,
  isUntouchedPreStage11AdminSet,
} from "@/lib/permissions";
import { listAuditLog, listAuditLogForExport } from "@/lib/platform/auditLog";
import type { PlatformActorContext } from "@/lib/platform/context";

const databaseUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl)) {
  console.error(
    "Refusing to run: DATABASE_URL does not point at a local database.",
  );
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

async function expectThrows(
  label: string,
  is: (error: unknown) => boolean,
  fn: () => Promise<unknown>,
): Promise<void> {
  try {
    await fn();
    check(label, false, "did not throw");
  } catch (error: unknown) {
    check(label, is(error), error);
  }
}

const TEST_TENANT_NAME = "verify-stage11";

/** A user agent shaped like a spreadsheet formula — the CSV guard's real case. */
const HOSTILE_USER_AGENT = "=cmd|'/c calc'!A1";

async function build() {
  const stamp = Date.now();
  await seedFeatureCatalogue(prisma);

  async function tenant(label: string) {
    const row = await prisma.tenant.create({
      data: {
        businessName: TEST_TENANT_NAME,
        email: `${TEST_TENANT_NAME}-${label}-${stamp}@example.test`,
        slug: `${TEST_TENANT_NAME}-${label}-${stamp}`,
        emailVerifiedAt: new Date(),
        status: "ACTIVE",
      },
      select: { id: true },
    });
    await seedDefaultRoles(prisma, row.id);
    return row.id;
  }

  const alpha = await tenant("alpha");
  const beta = await tenant("beta");

  const alphaRoles = await prisma.role.findMany({
    where: { tenantId: alpha },
    select: { id: true, name: true, permissions: true },
  });
  const roleId = (name: string) => alphaRoles.find((r) => r.name === name)!.id;

  // Holds audit:read and nothing else, so the gate is tested in isolation.
  const auditorRole = await prisma.role.create({
    data: { tenantId: alpha, name: `Auditor-${stamp}`, permissions: ["audit:read"] },
    select: { id: true },
  });
  // Holds everything EXCEPT audit:read — the role that must be refused.
  const nearMissRole = await prisma.role.create({
    data: {
      tenantId: alpha,
      name: `Near Miss-${stamp}`,
      permissions: ALL_PERMISSIONS.filter((p) => p !== "audit:read"),
    },
    select: { id: true },
  });

  const betaRoles = await prisma.role.findMany({
    where: { tenantId: beta },
    select: { id: true, name: true },
  });
  const betaAuditorRole = await prisma.role.create({
    data: { tenantId: beta, name: `Auditor-${stamp}`, permissions: ["audit:read"] },
    select: { id: true },
  });

  async function user(
    label: string,
    tenantId: string,
    roleIds: string[],
    platformRole: "SUPER_ADMIN" | null = null,
  ): Promise<{ id: string; actor: ActorContext }> {
    const created = await prisma.user.create({
      data: {
        tenantId,
        name: label,
        email: `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${stamp}@example.test`,
        passwordHash: "x",
        accountStatus: "ACTIVE",
        membershipStatus: "ACTIVE",
        platformRole,
        userRoles: { create: roleIds.map((id) => ({ roleId: id })) },
      },
      select: { id: true },
    });
    return { id: created.id, actor: { userId: created.id, tenantId } };
  }

  const alphaOwner = await user("Alpha Owner", alpha, [roleId("Owner")]);
  const alphaAuditor = await user("Alpha Auditor", alpha, [auditorRole.id]);
  const alphaNearMiss = await user("Alpha Near Miss", alpha, [nearMissRole.id]);
  const betaAuditor = await user("Beta Auditor", beta, [betaAuditorRole.id]);
  const ownerUser = await user(
    "Platform Owner S11",
    alpha,
    [roleId("Owner")],
    "SUPER_ADMIN",
  );

  const owner: PlatformActorContext = {
    userId: ownerUser.id,
    platformRole: "SUPER_ADMIN",
    sessionId: "verify-stage11",
  };

  // --- The rows under test ------------------------------------------------
  // Alpha's own decision.
  await writeAuditLog(prisma, {
    action: AUDIT_ACTIONS.TEAM_MEMBER_REMOVED,
    targetType: "User",
    targetId: alphaNearMiss.id,
    actorUserId: alphaOwner.id,
    actorTenantId: alpha,
    reason: "Left the practice",
    ip: "203.0.113.9",
    userAgent: HOSTILE_USER_AGENT,
  });
  // Beta's own decision — must never appear on Alpha's screen.
  await writeAuditLog(prisma, {
    action: AUDIT_ACTIONS.TEAM_MEMBER_SUSPENDED,
    targetType: "User",
    targetId: betaAuditor.id,
    actorUserId: betaAuditor.id,
    actorTenantId: beta,
    reason: "Beta's private business",
  });
  // A platform decision ABOUT Alpha — actorTenantId null, so only clause 2
  // reaches it.
  await writeAuditLog(prisma, {
    action: AUDIT_ACTIONS.CLINIC_SUSPENDED,
    targetType: "Tenant",
    targetId: alpha,
    actorUserId: ownerUser.id,
    actorPlatformRole: "SUPER_ADMIN",
    actorTenantId: null,
    reason: "Verification run",
  });
  // A platform decision about BETA — must never appear on Alpha's screen.
  await writeAuditLog(prisma, {
    action: AUDIT_ACTIONS.CLINIC_SUSPENDED,
    targetType: "Tenant",
    targetId: beta,
    actorUserId: ownerUser.id,
    actorPlatformRole: "SUPER_ADMIN",
    actorTenantId: null,
    reason: "Beta's private business",
  });
  // Sign-in noise under Alpha — hidden by default, reachable by filter.
  await writeAuditLog(prisma, {
    action: AUDIT_ACTIONS.LOGIN_CODE_FAILED,
    targetType: "LoginCode",
    targetId: "x",
    actorUserId: alphaOwner.id,
    actorTenantId: alpha,
  });

  return {
    alpha,
    beta,
    owner,
    ownerUserId: ownerUser.id,
    alphaOwnerActor: alphaOwner.actor,
    alphaAuditorActor: alphaAuditor.actor,
    alphaNearMissActor: alphaNearMiss.actor,
    betaAuditorActor: betaAuditor.actor,
  };
}

async function main(): Promise<void> {
  const t = await build();

  // -------------------------------------------------------------------------
  console.log("\nThe gate");
  // -------------------------------------------------------------------------
  await expectThrows(
    "a role holding every permission EXCEPT audit:read is refused",
    (error) => error instanceof PermissionError,
    () => getAuditTrail(t.alphaNearMissActor),
  );
  const auditorTrail = await getAuditTrail(t.alphaAuditorActor);
  check(
    "a role holding only audit:read gets the log",
    auditorTrail.entries.length > 0,
    auditorTrail.total,
  );
  check(
    "the account owner gets it too, through the wildcard",
    (await getAuditTrail(t.alphaOwnerActor)).entries.length > 0,
  );

  // -------------------------------------------------------------------------
  console.log("\nScoping — the whole point of the stage");
  // -------------------------------------------------------------------------
  const alphaTrail = await getAuditTrail(t.alphaOwnerActor);
  const alphaReasons = alphaTrail.entries.map((entry) => entry.reason ?? "");

  check(
    "Alpha sees its own team decision",
    alphaTrail.entries.some(
      (entry) => entry.action === AUDIT_ACTIONS.TEAM_MEMBER_REMOVED,
    ),
  );
  check(
    "Alpha sees the platform's decision about Alpha",
    alphaTrail.entries.some(
      (entry) =>
        entry.action === AUDIT_ACTIONS.CLINIC_SUSPENDED &&
        entry.reason === "Verification run",
    ),
  );
  check(
    "Alpha sees NOTHING belonging to Beta",
    !alphaReasons.includes("Beta's private business"),
    alphaReasons,
  );

  const betaTrail = await getAuditTrail(t.betaAuditorActor);
  const betaReasons = betaTrail.entries.map((entry) => entry.reason ?? "");
  check(
    "and the same holds in the other direction",
    !betaReasons.includes("Left the practice") &&
      !betaReasons.includes("Verification run"),
    betaReasons,
  );
  check(
    "Beta sees its own two rows and no more",
    betaTrail.entries.every(
      (entry) => entry.reason === "Beta's private business" || entry.reason === null,
    ),
    betaTrail.entries.map((entry) => entry.action),
  );

  // -------------------------------------------------------------------------
  console.log("\nWhat a tenant screen withholds");
  // -------------------------------------------------------------------------
  const removal = alphaTrail.entries.find(
    (entry) => entry.action === AUDIT_ACTIONS.TEAM_MEMBER_REMOVED,
  )!;
  const keys = Object.keys(removal);
  for (const withheld of ["ip", "userAgent", "beforeValue", "afterValue"]) {
    check(`the tenant view carries no ${withheld}`, !keys.includes(withheld), keys);
  }
  check(
    "it does carry the sentence, the actor and the reason",
    removal.label === "Team member removed" &&
      removal.actorName === "Alpha Owner" &&
      removal.reason === "Left the practice",
    removal,
  );
  check(
    "a platform action is attributed to MEDCARE PRO, not to a colleague",
    alphaTrail.entries.find(
      (entry) => entry.action === AUDIT_ACTIONS.CLINIC_SUSPENDED,
    )?.byPlatform === true,
  );

  // -------------------------------------------------------------------------
  console.log("\nSign-in noise stays out of the way, not out of reach");
  // -------------------------------------------------------------------------
  check(
    "the default view hides sign-in rows",
    !alphaTrail.entries.some(
      (entry) => entry.action === AUDIT_ACTIONS.LOGIN_CODE_FAILED,
    ),
    alphaTrail.entries.map((entry) => entry.action),
  );
  const accessTrail = await getAuditTrail(t.alphaOwnerActor, { category: "access" });
  check(
    "choosing the sign-in category brings them back",
    accessTrail.entries.some(
      (entry) => entry.action === AUDIT_ACTIONS.LOGIN_CODE_FAILED,
    ),
    accessTrail.entries.map((entry) => entry.action),
  );
  check(
    "and that filter still cannot cross a tenant boundary",
    accessTrail.entries.every((entry) => entry.reason !== "Beta's private business"),
  );

  // -------------------------------------------------------------------------
  console.log("\nFilters");
  // -------------------------------------------------------------------------
  const teamOnly = await getAuditTrail(t.alphaOwnerActor, { category: "team" });
  check(
    "the team category returns team rows only",
    teamOnly.entries.length > 0 &&
      teamOnly.entries.every((entry) => entry.category === "team"),
    teamOnly.entries.map((entry) => entry.category),
  );
  const searched = await getAuditTrail(t.alphaOwnerActor, { search: "Alpha Owner" });
  check(
    "searching by actor name narrows the list",
    searched.entries.every((entry) => entry.actorName === "Alpha Owner"),
    searched.entries.map((entry) => entry.actorName),
  );
  const noMatch = await getAuditTrail(t.alphaOwnerActor, { search: "Beta Auditor" });
  check(
    "and searching for a neighbour's staff finds nothing rather than their rows",
    noMatch.entries.length === 0,
    noMatch.entries.map((entry) => entry.actorName),
  );

  // -------------------------------------------------------------------------
  console.log("\nThe Owner surface sees across organisations");
  // -------------------------------------------------------------------------
  const ownerView = await listAuditLog(t.owner, { search: "" });
  check(
    "the platform log carries rows from both organisations",
    ownerView.entries.some((entry) => entry.reason === "Left the practice") &&
      ownerView.entries.some((entry) => entry.reason === "Beta's private business"),
  );
  const withIp = ownerView.entries.find(
    (entry) => entry.action === AUDIT_ACTIONS.TEAM_MEMBER_REMOVED,
  )!;
  check(
    "and carries the fields the tenant screen withholds",
    withIp.ip === "203.0.113.9" && withIp.userAgent === HOSTILE_USER_AGENT,
    withIp,
  );
  const scoped = await listAuditLog(t.owner, { tenantId: t.beta });
  check(
    "filtering by one organisation returns only its rows and decisions about it",
    scoped.entries.length > 0 &&
      scoped.entries.every((entry) => entry.reason !== "Left the practice"),
    scoped.entries.map((entry) => entry.reason),
  );

  const dated = await listAuditLog(t.owner, {
    from: new Date().toISOString().slice(0, 10),
    to: new Date().toISOString().slice(0, 10),
  });
  check(
    "a single-day range includes rows written today — the upper bound is inclusive",
    dated.entries.length > 0,
    dated.total,
  );

  // -------------------------------------------------------------------------
  console.log("\nThe CSV export");
  // -------------------------------------------------------------------------
  const exported = await listAuditLogForExport(t.owner, { tenantId: t.alpha });
  const csv = toAuditCsv(exported.entries);

  check("the export produces a header row", csv.includes("Timestamp (UTC)"));
  check("with a UTF-8 BOM so Excel reads it correctly", csv.startsWith("﻿"));
  const hostileCell = csv
    .split("\r\n")
    .find((line) => line.includes("cmd|"))
    ?.split(",")
    .find((cell) => cell.includes("cmd|"));
  check(
    "the hostile user agent is neutralised before a spreadsheet sees it",
    // Asserted POSITIVELY — that the cell exists and carries the guard. The
    // obvious alternative, "no cell starts with =", is also true of an export
    // that dropped the column altogether, so it would pass while testing
    // nothing.
    hostileCell !== undefined && hostileCell.startsWith("'="),
    hostileCell,
  );
  check(
    "and no cell anywhere in the file begins with a formula character",
    !csv
      .split("\r\n")
      .some((line) => line.split(",").some((cell) => cell.startsWith("="))),
  );
  check(
    "the file names no organisation, so the header stays safe to encode",
    !auditCsvFilename().includes(TEST_TENANT_NAME),
    auditCsvFilename(),
  );
  check("nothing was truncated at this size", exported.truncated === false);

  // -------------------------------------------------------------------------
  console.log("\nAppend-only stays append-only");
  // -------------------------------------------------------------------------
  const before = await prisma.auditLog.count({ where: { actorTenantId: t.alpha } });
  await getAuditTrail(t.alphaOwnerActor);
  await listAuditLog(t.owner, {});
  await listAuditLogForExport(t.owner, {});
  check(
    "reading the trail writes nothing to it",
    (await prisma.auditLog.count({ where: { actorTenantId: t.alpha } })) === before,
  );

  // -------------------------------------------------------------------------
  console.log("\nThe backfill's rule, on a throwaway role");
  // -------------------------------------------------------------------------
  const untouched = await prisma.role.create({
    data: {
      tenantId: t.alpha,
      name: `Untouched Admin ${Date.now()}`,
      permissions: [...PRE_STAGE_11_PERMISSIONS],
    },
    select: { id: true, permissions: true },
  });
  check(
    "an Admin holding exactly the pre-Stage-11 catalogue is recognised as untouched",
    isUntouchedPreStage11AdminSet(PRE_STAGE_11_PERMISSIONS),
  );
  check(
    "one with a permission removed is not, and would be left alone",
    !isUntouchedPreStage11AdminSet(PRE_STAGE_11_PERMISSIONS.slice(1)),
  );
  check(
    "and a topped-up role is not matched a second time",
    !isUntouchedPreStage11AdminSet([...ALL_PERMISSIONS]),
  );
  await prisma.role.delete({ where: { id: untouched.id } });
}

main()
  .catch((error: unknown) => {
    failures += 1;
    console.error("\nScript error:", error);
  })
  .finally(async () => {
    const stale = await prisma.tenant.findMany({
      where: { businessName: TEST_TENANT_NAME },
      select: { id: true },
    });
    const tenantIds = stale.map((tenant) => tenant.id);
    const userIds = (
      await prisma.user.findMany({
        where: { tenantId: { in: tenantIds } },
        select: { id: true },
      })
    ).map((user) => user.id);

    // AuditLog holds RESTRICT foreign keys onto both actors — deliberately, so
    // the trail outlives what it describes. Its rows therefore go first, or
    // nothing behind them can be deleted at all. This script writes more of
    // them than any other, including rows whose actor is the throwaway owner.
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { actorUserId: { in: userIds } },
          { actorTenantId: { in: tenantIds } },
          { targetType: "Tenant", targetId: { in: tenantIds } },
        ],
      },
    });

    for (const id of tenantIds) {
      await prisma.tenant.delete({ where: { id } }).catch(() => {});
    }

    const residue = await prisma.tenant.count({
      where: { businessName: TEST_TENANT_NAME },
    });
    if (residue > 0) {
      failures += 1;
      console.error(`\nCleanup left ${residue} row(s) behind.`);
    }

    await prisma.$disconnect();
    console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
    process.exitCode = failures === 0 ? 0 : 1;
  });
