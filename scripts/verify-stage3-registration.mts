/**
 * Stage-3 verification — clinic registration, email verification, and the
 * Platform Owner's decision on an application. Exercised against a LOCAL
 * database.
 *
 *     npm run verify:stage3
 *
 * What it proves, end to end and against the real modules rather than
 * reimplementations of them:
 *
 *   - registration creates a PENDING organisation with NO role attached;
 *   - a pending applicant cannot be handed a tenant-scoped actor context, which
 *     is what blocks the dashboard;
 *   - the verification link marks BOTH the organisation and the applicant, and
 *     a token minted for the other flow is refused;
 *   - rejection and suspension require a written reason;
 *   - approval assigns the account-wide role, sets the plan, writes only the
 *     feature overrides that deviate from it, and unlocks access;
 *   - suspension removes access on the next request and reactivation restores it;
 *   - a rejected organisation stays locked out, and its membershipStatus — the
 *     Tenant Admin's column — is not touched by platform code;
 *   - the reserved platform tenant never appears in the Owner's queue.
 *
 * Refuses to run unless DATABASE_URL points at localhost: it writes and deletes
 * rows, and must never be aimed at a real clinic's data.
 */
import { prisma } from "@/lib/prisma";
import { POST as signupRoute } from "@/app/api/auth/signup/route";
import { GET as verifyEmailRoute } from "@/app/api/auth/verify-email/route";
import {
  clearVerificationTokens,
  issueVerificationToken,
} from "@/lib/verification";
import {
  VERIFICATION_PURPOSES,
  type VerificationPurpose,
} from "@/lib/verificationPurpose";
import { createAppSession } from "@/lib/appSession";
import { loadLiveSession, toTenantActor, UnauthenticatedError } from "@/lib/session";
import { toPlatformOwner } from "@/lib/platform/auth";
import { PlatformAuthorizationError } from "@/lib/platform/context";
import { ensurePlatformTenant } from "@/lib/platform/tenant";
import { decideOnClinicApplication } from "@/lib/platform/decisions";
import {
  getClinicApplication,
  listClinicApplications,
} from "@/lib/platform/applications";
import { seedFeatureCatalogue, DEFAULT_PLAN_KEY } from "@/lib/defaultFeatures";
import { ROLE_KEYS } from "@/lib/defaultRoles";
import { BadRequestError, ConflictError } from "@/lib/apiHandler";
import type { PlatformActorContext } from "@/lib/platform/context";

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

async function expectThrows(
  label: string,
  run: () => Promise<unknown>,
  is: (error: unknown) => boolean,
): Promise<void> {
  try {
    await run();
    check(label, false, "did not throw");
  } catch (error: unknown) {
    check(label, is(error), error);
  }
}

const RUN = Date.now();
const CLINIC_A = `verify-stage3-alpha-${RUN}`;
const CLINIC_B = `verify-stage3-beta-${RUN}`;
const EMAIL_A = `${CLINIC_A}@example.test`;
const EMAIL_B = `${CLINIC_B}@example.test`;
const OWNER_EMAIL = `verify-stage3-owner-${RUN}@medcare.invalid`;
const PASSWORD = "correct horse battery staple";
const ORIGIN = "http://127.0.0.1:3000";

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

/** Runs the real signup route with a JSON body, as the browser would. */
async function register(clinicName: string, email: string): Promise<number> {
  const response = await signupRoute(
    new Request(`${ORIGIN}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Dr Amelia Rao",
        email,
        clinicName,
        city: "Pune",
        phone: "+91 98765 43210",
        address: "Shop 4, MG Road",
        businessEmail: `billing-${email}`,
        password: PASSWORD,
        acceptTerms: true,
      }),
    }),
  );
  return response.status;
}

/**
 * Mints a fresh verification token and redeems it through the real route.
 *
 * The token mailed at signup exists only as a SHA-256 hash in the database, so
 * it cannot be recovered here. Issuing a new one exercises exactly the same
 * issue-and-consume path.
 */
async function verifyEmailFor(
  email: string,
  purpose: VerificationPurpose = VERIFICATION_PURPOSES.TENANT_EMAIL,
) {
  await clearVerificationTokens(prisma, email);
  const issued = await issueVerificationToken(prisma, email, purpose);
  return verifyEmailRoute(
    new Request(`${ORIGIN}/api/auth/verify-email?token=${issued.token}`),
  );
}

/** A live actor context for a user, through the real session registry. */
async function actorFor(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { tenantId: true },
  });
  const sid = await createAppSession(prisma, { userId, tenantId: user.tenantId });
  return loadLiveSession(sid, userId);
}

async function makeOwner(): Promise<PlatformActorContext> {
  const platformTenantId = await ensurePlatformTenant(prisma);
  const owner = await prisma.user.create({
    data: {
      tenantId: platformTenantId,
      name: "Verify Stage 3 Owner",
      email: OWNER_EMAIL,
      // Never used to sign in here — every check calls the library directly.
      passwordHash: "not-a-real-hash",
      emailVerifiedAt: new Date(),
      accountStatus: "ACTIVE",
      membershipStatus: "ACTIVE",
      platformRole: "SUPER_ADMIN",
    },
    select: { id: true },
  });
  createdUserIds.push(owner.id);

  return toPlatformOwner(await actorFor(owner.id));
}

async function applicantFor(email: string) {
  return prisma.user.findUniqueOrThrow({
    where: { email },
    select: {
      id: true,
      tenantId: true,
      accountStatus: true,
      membershipStatus: true,
      emailVerifiedAt: true,
    },
  });
}

async function main(): Promise<void> {
  await seedFeatureCatalogue(prisma);
  const owner = await makeOwner();

  // -----------------------------------------------------------------------
  console.log("\n1. Registration creates a PENDING organisation");
  // -----------------------------------------------------------------------
  const statusA = await register(CLINIC_A, EMAIL_A);
  // 201 when mail went out; 502 when EMAIL_API_KEY is unset locally. Both mean
  // the rows were committed — the route says so in as many words.
  check("the signup route accepted the registration", statusA === 201 || statusA === 502, statusA);

  const tenantA = await prisma.tenant.findUniqueOrThrow({
    where: { email: EMAIL_A },
    select: {
      id: true,
      status: true,
      slug: true,
      city: true,
      phone: true,
      address: true,
      primaryContactEmail: true,
      termsAcceptedAt: true,
      businessName: true,
      emailVerifiedAt: true,
      planId: true,
    },
  });
  createdTenantIds.push(tenantA.id);

  check("the organisation is PENDING", tenantA.status === "PENDING");
  check("with a generated slug", (tenantA.slug ?? "").length > 0, tenantA.slug);
  check("the clinic name is stored", tenantA.businessName === CLINIC_A);
  check("city, phone and address are stored", tenantA.city === "Pune" && tenantA.phone !== null && tenantA.address !== null);
  check("the optional business contact address is stored", tenantA.primaryContactEmail !== null);
  check("consent is recorded with a timestamp", tenantA.termsAcceptedAt !== null);
  check("no plan is assigned before approval", tenantA.planId === null);

  const applicantA = await applicantFor(EMAIL_A);
  createdUserIds.push(applicantA.id);
  check("the applicant account is PENDING", applicantA.accountStatus === "PENDING");
  check("and their membership is PENDING", applicantA.membershipStatus === "PENDING");
  check("their address is not verified yet", applicantA.emailVerifiedAt === null);

  const rolesA = await prisma.role.count({ where: { tenantId: tenantA.id } });
  check("the tenant's role catalogue was seeded", rolesA > 0, rolesA);

  const grantsA = await prisma.userRole.count({ where: { userId: applicantA.id } });
  check("but the applicant holds NO role before approval", grantsA === 0, grantsA);

  const registeredAudit = await prisma.auditLog.count({
    where: { action: "CLINIC_REGISTERED", targetId: tenantA.id },
  });
  check("the registration was recorded in the audit trail", registeredAudit === 1);

  // -----------------------------------------------------------------------
  console.log("\n2. A pending applicant cannot reach the dashboard");
  // -----------------------------------------------------------------------
  await expectThrows(
    "requireActor refuses a pending organisation",
    async () => toTenantActor(await actorFor(applicantA.id)),
    (error) =>
      error instanceof UnauthenticatedError && error.reason === "tenant",
  );

  // -----------------------------------------------------------------------
  console.log("\n3. Email verification marks the organisation and the person");
  // -----------------------------------------------------------------------
  const wrongPurpose = await verifyEmailFor(EMAIL_A, VERIFICATION_PURPOSES.USER_EMAIL);
  check(
    "a token minted for the other flow is refused",
    wrongPurpose.headers.get("location")?.includes("status=invalid") === true,
    wrongPurpose.headers.get("location"),
  );

  const verified = await verifyEmailFor(EMAIL_A);
  check(
    "a verified but unapproved applicant is sent to the pending screen",
    verified.headers.get("location")?.includes("/pending-approval?status=pending") === true,
    verified.headers.get("location"),
  );

  const afterVerify = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantA.id },
    select: { emailVerifiedAt: true },
  });
  check("the organisation is now verified", afterVerify.emailVerifiedAt !== null);
  check(
    "and so is the applicant, from the same link",
    (await applicantFor(EMAIL_A)).emailVerifiedAt !== null,
  );
  check(
    "verification was recorded in the audit trail",
    (await prisma.auditLog.count({
      where: { action: "CLINIC_EMAIL_VERIFIED", targetId: tenantA.id },
    })) === 1,
  );
  check(
    "verifying still does not grant access",
    (await prisma.tenant.findUniqueOrThrow({
      where: { id: tenantA.id },
      select: { status: true },
    })).status === "PENDING",
  );

  // -----------------------------------------------------------------------
  console.log("\n4. The Owner's queue");
  // -----------------------------------------------------------------------
  const queue = await listClinicApplications(owner, { status: "PENDING" });
  check(
    "the new application is in the pending queue",
    queue.applications.some((row) => row.id === tenantA.id),
  );

  const platformTenantId = await ensurePlatformTenant(prisma);
  check(
    "the reserved platform tenant is not in any queue",
    !queue.applications.some((row) => row.id === platformTenantId),
  );
  check(
    "and cannot be opened by id",
    (await getClinicApplication(owner, platformTenantId)) === null,
  );

  const detail = await getClinicApplication(owner, tenantA.id);
  check("the application detail loads", detail !== null);
  check(
    "and offers the seeded plan",
    detail?.plans.some((plan) => plan.key === DEFAULT_PLAN_KEY) === true,
  );

  // -----------------------------------------------------------------------
  console.log("\n5. Decision policy is enforced server-side");
  // -----------------------------------------------------------------------
  await expectThrows(
    "rejecting without a reason is refused",
    () => decideOnClinicApplication(owner, { tenantId: tenantA.id, decision: "REJECT" }),
    (error) => error instanceof BadRequestError,
  );
  await expectThrows(
    "a one-word reason is refused",
    () =>
      decideOnClinicApplication(owner, {
        tenantId: tenantA.id,
        decision: "REJECT",
        reason: "no",
      }),
    (error) => error instanceof BadRequestError,
  );
  await expectThrows(
    "reactivating something that is not suspended is refused",
    () =>
      decideOnClinicApplication(owner, {
        tenantId: tenantA.id,
        decision: "REACTIVATE",
      }),
    (error) => error instanceof ConflictError,
  );
  await expectThrows(
    "approving without a plan is refused",
    () => decideOnClinicApplication(owner, { tenantId: tenantA.id, decision: "APPROVE" }),
    (error) => error instanceof BadRequestError,
  );
  await expectThrows(
    "an unknown feature key is refused",
    () =>
      decideOnClinicApplication(owner, {
        tenantId: tenantA.id,
        decision: "APPROVE",
        planKey: DEFAULT_PLAN_KEY,
        features: [{ featureKey: "not-a-feature", enabled: true }],
      }),
    (error) => error instanceof BadRequestError,
  );

  const catalogue = await prisma.feature.findMany({ select: { key: true } });
  const planFeatures = await prisma.planFeature.findMany({
    where: { plan: { key: DEFAULT_PLAN_KEY } },
    select: { enabled: true, feature: { select: { key: true } } },
  });
  const planOn = planFeatures.filter((row) => row.enabled).map((row) => row.feature.key);
  const toRevoke = planOn[0];

  await expectThrows(
    "deviating from the plan without a reason is refused",
    () =>
      decideOnClinicApplication(owner, {
        tenantId: tenantA.id,
        decision: "APPROVE",
        planKey: DEFAULT_PLAN_KEY,
        features: catalogue.map((row) => ({
          featureKey: row.key,
          enabled: row.key !== toRevoke && planOn.includes(row.key),
        })),
      }),
    (error) => error instanceof BadRequestError,
  );

  // -----------------------------------------------------------------------
  console.log("\n6. Approval");
  // -----------------------------------------------------------------------
  const outcome = await decideOnClinicApplication(owner, {
    tenantId: tenantA.id,
    decision: "APPROVE",
    planKey: DEFAULT_PLAN_KEY,
    features: catalogue.map((row) => ({
      featureKey: row.key,
      enabled: row.key !== toRevoke && planOn.includes(row.key),
    })),
    entitlementReason: "Withheld pending a signed data agreement.",
  });

  check("the decision reports the new status", outcome.status === "ACTIVE");
  check("and that a role was assigned", outcome.roleAssigned);
  check("exactly one override was written", outcome.overridesSet === 1, outcome.overridesSet);
  check("and nothing was cleared", outcome.overridesCleared === 0);

  const approved = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantA.id },
    select: { status: true, planId: true, approvedById: true, approvedAt: true },
  });
  check("the organisation is ACTIVE", approved.status === "ACTIVE");
  check("the plan is recorded", approved.planId !== null);
  check("the approving Owner is recorded", approved.approvedById === owner.userId);
  check("with a timestamp", approved.approvedAt !== null);

  const approvedApplicant = await applicantFor(EMAIL_A);
  check("the applicant account is ACTIVE", approvedApplicant.accountStatus === "ACTIVE");
  check("and their membership is ACTIVE", approvedApplicant.membershipStatus === "ACTIVE");

  const grant = await prisma.userRole.findFirst({
    where: { userId: approvedApplicant.id },
    select: { clinicId: true, assignedById: true, role: { select: { key: true } } },
  });
  check("the first user now holds the account-wide root role", grant?.role.key === ROLE_KEYS.OWNER, grant?.role.key);
  check("granted account-wide, not scoped to a clinic", grant?.clinicId === null);
  check("and attributed to the Owner who approved", grant?.assignedById === owner.userId);

  const override = await prisma.tenantFeatureOverride.findMany({
    where: { tenantId: tenantA.id },
    select: { enabled: true, reason: true, changedById: true, feature: { select: { key: true } } },
  });
  check("one override row exists", override.length === 1, override.length);
  check("for the feature that was withheld", override[0]?.feature.key === toRevoke);
  check("disabled", override[0]?.enabled === false);
  check("carrying the reason", (override[0]?.reason ?? "").length > 0);
  check("attributed to the Owner", override[0]?.changedById === owner.userId);
  check(
    "features that match the plan get no override row",
    override.length < planOn.length,
  );

  for (const action of ["CLINIC_APPROVED", "CLINIC_ADMIN_ASSIGNED", "TENANT_ENTITLEMENTS_SET"]) {
    check(
      `the audit trail records ${action}`,
      (await prisma.auditLog.count({
        where: { action, OR: [{ targetId: tenantA.id }, { targetId: approvedApplicant.id }] },
      })) >= 1,
    );
  }

  const actor = toTenantActor(await actorFor(approvedApplicant.id));
  check("the applicant can now be scoped to their tenant", actor.tenantId === tenantA.id);

  await expectThrows(
    "approving an already-active organisation is refused",
    () =>
      decideOnClinicApplication(owner, {
        tenantId: tenantA.id,
        decision: "APPROVE",
        planKey: DEFAULT_PLAN_KEY,
      }),
    (error) => error instanceof ConflictError,
  );

  // -----------------------------------------------------------------------
  console.log("\n7. Suspension and reactivation");
  // -----------------------------------------------------------------------
  await expectThrows(
    "suspending without a reason is refused",
    () => decideOnClinicApplication(owner, { tenantId: tenantA.id, decision: "SUSPEND" }),
    (error) => error instanceof BadRequestError,
  );

  await decideOnClinicApplication(owner, {
    tenantId: tenantA.id,
    decision: "SUSPEND",
    reason: "Payment failed three months running.",
  });

  const suspended = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantA.id },
    select: { status: true, suspensionReason: true, suspendedById: true },
  });
  check("the organisation is SUSPENDED", suspended.status === "SUSPENDED");
  check("the reason is stored", (suspended.suspensionReason ?? "").length > 0);
  check("and the suspending Owner is recorded", suspended.suspendedById === owner.userId);

  await expectThrows(
    "an existing session loses access on its next request",
    async () => toTenantActor(await actorFor(approvedApplicant.id)),
    (error) => error instanceof UnauthenticatedError && error.reason === "tenant",
  );

  await decideOnClinicApplication(owner, {
    tenantId: tenantA.id,
    decision: "REACTIVATE",
  });

  const reactivated = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantA.id },
    select: { status: true, suspendedAt: true, suspensionReason: true },
  });
  check("the organisation is ACTIVE again", reactivated.status === "ACTIVE");
  check("the suspension pointers are cleared", reactivated.suspendedAt === null && reactivated.suspensionReason === null);
  check(
    "but the suspension is still in the append-only trail",
    (await prisma.auditLog.count({
      where: { action: "CLINIC_SUSPENDED", targetId: tenantA.id },
    })) === 1,
  );
  check(
    "and access is restored",
    toTenantActor(await actorFor(approvedApplicant.id)).tenantId === tenantA.id,
  );

  // -----------------------------------------------------------------------
  console.log("\n8. Rejection");
  // -----------------------------------------------------------------------
  await register(CLINIC_B, EMAIL_B);
  const tenantB = await prisma.tenant.findUniqueOrThrow({
    where: { email: EMAIL_B },
    select: { id: true },
  });
  createdTenantIds.push(tenantB.id);
  const applicantB = await applicantFor(EMAIL_B);
  createdUserIds.push(applicantB.id);

  await decideOnClinicApplication(owner, {
    tenantId: tenantB.id,
    decision: "REJECT",
    reason: "Duplicate of an existing registration.",
  });

  const rejected = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantB.id },
    select: { status: true, rejectionReason: true, rejectedById: true },
  });
  check("the organisation is REJECTED", rejected.status === "REJECTED");
  check("the reason is stored", (rejected.rejectionReason ?? "").length > 0);
  check("and the rejecting Owner is recorded", rejected.rejectedById === owner.userId);

  await expectThrows(
    "a rejected organisation cannot reach the dashboard",
    async () => toTenantActor(await actorFor(applicantB.id)),
    (error) => error instanceof UnauthenticatedError && error.reason === "tenant",
  );

  const afterReject = await applicantFor(EMAIL_B);
  check(
    "platform code did not touch the Tenant Admin's membership column",
    afterReject.membershipStatus === "PENDING",
    afterReject.membershipStatus,
  );
  check(
    "nor archive the person's own account",
    afterReject.accountStatus === "PENDING",
    afterReject.accountStatus,
  );
  check(
    "no role was granted",
    (await prisma.userRole.count({ where: { userId: applicantB.id } })) === 0,
  );

  await expectThrows(
    "a rejection cannot be reversed by another decision",
    () =>
      decideOnClinicApplication(owner, {
        tenantId: tenantB.id,
        decision: "APPROVE",
        planKey: DEFAULT_PLAN_KEY,
      }),
    (error) => error instanceof ConflictError,
  );

  // -----------------------------------------------------------------------
  console.log("\n9. The clinic surface and the platform surface stay apart");
  // -----------------------------------------------------------------------
  await expectThrows(
    "a clinic user cannot be turned into a Platform Owner context",
    async () => toPlatformOwner(await actorFor(approvedApplicant.id)),
    (error) => error instanceof PlatformAuthorizationError,
  );
}

main()
  .catch((error: unknown) => {
    failures += 1;
    console.error("\nScript error:", error);
  })
  .finally(async () => {
    // audit_logs holds RESTRICT foreign keys to both the actor and the actor's
    // tenant, so a tenant that appears in the trail cannot be deleted while its
    // rows stand. That is the intended production behaviour — real tenants are
    // ARCHIVED, never deleted — so this test-only cleanup removes the rows it
    // created first, scoped to the ids from THIS run.
    if (createdTenantIds.length > 0 || createdUserIds.length > 0) {
      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            { actorTenantId: { in: createdTenantIds } },
            { actorUserId: { in: createdUserIds } },
            { targetId: { in: [...createdTenantIds, ...createdUserIds] } },
          ],
        },
      });
    }

    for (const email of [EMAIL_A, EMAIL_B]) {
      await clearVerificationTokens(prisma, email).catch(() => {});
    }
    await prisma.appSession.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    for (const id of createdTenantIds) {
      await prisma.tenant.delete({ where: { id } }).catch(() => {});
    }

    await prisma.$disconnect();
    console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
    process.exitCode = failures === 0 ? 0 : 1;
  });
