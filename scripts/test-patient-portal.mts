import "dotenv/config";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { prisma } from "@/lib/prisma";
import {
  createPatientPortalFixture,
  assertPatientPortalTestDatabase,
} from "./patient-portal-test-fixture";
import {
  createPortalActivation,
  revokePatientPortal,
  loadPortalActivation,
  getStaffPortalStatus,
} from "@/lib/patientPortalActivation";
import {
  requestPatientPortalCode,
  verifyPatientPortalCode,
  portalAuthRateLimit,
} from "@/lib/patientPortalOtp";
import {
  loadPatientActor,
  logoutPatientPortal,
} from "@/lib/patientPortalSession";
import {
  patientPortalProfile,
  patientPortalHistory,
  patientOwnedPrescription,
  patientOwnedRegistration,
  patientOwnedAppointment,
} from "@/lib/patientPortalRecords";
import {
  normalizePatientMobile,
  hashPortalToken,
  PatientPortalError,
  SESSION_TTL,
} from "@/lib/patientPortalSecurity";
import { requirePatientPortalEntitlement } from "@/lib/patientPortalFeature";
import { requirePermission, ScopeError, PermissionError } from "@/lib/rbac";
import { setRoleFeatureAccess } from "@/lib/features";
import { RateLimitError } from "@/lib/rateLimit";
import { PRE_PATIENT_PORTAL_ROLES } from "@/lib/patientPortalRoleMigration";
assertPatientPortalTestDatabase();
process.env.PATIENT_PORTAL_OTP_SECRET =
  "disposable-patient-portal-test-pepper-2026";
process.env.AUTH_URL = "http://127.0.0.1:33322";
let activationToken = "",
  code = "";
const sender = {
  async sendActivation(input: { activationUrl: string }) {
    activationToken = input.activationUrl.split("/").at(-1)!;
  },
  async sendLoginCode(input: { code: string }) {
    code = input.code;
  },
};
let checks = 0;
function check(label: string, value: unknown) {
  assert.ok(value, label);
  checks++;
  console.log(`PASS ${label}`);
}
async function rejects(
  label: string,
  work: () => Promise<unknown>,
  status?: number,
  kind?: new (...args: never[]) => Error,
) {
  await assert.rejects(work, (error: unknown) => {
    if (status !== undefined) {
      return (
        (error instanceof PatientPortalError ||
          (error instanceof Error && error.name === "PatientPortalError")) &&
        (error as PatientPortalError).status === status
      );
    }
    if (kind) {
      return (
        error instanceof kind ||
        (error instanceof Error &&
          (error.name === kind.name || error.constructor.name === kind.name))
      );
    }
    return error instanceof Error;
  });
  checks++;
  console.log(`PASS ${label}`);
}
async function ageChallenges(mobile: string) {
  await prisma.patientPortalChallenge.updateMany({
    where: { mobileE164: mobile },
    data: { createdAt: new Date(Date.now() - 61000) },
  });
}
async function main() {
  const f = await createPatientPortalFixture();
  const mobile = normalizePatientMobile(f.number);
  await rejects(
    "Staff without explicit portal permission denied",
    () =>
      createPortalActivation(f.doctorUser.actor, f.patient.id, false, sender),
    undefined,
    PermissionError,
  );
  await rejects(
    "Foreign tenant staff cannot activate patient",
    () => createPortalActivation(f.foreign.actor, f.patient.id, false, sender),
    undefined,
    ScopeError,
  );
  await rejects(
    "Clinic scoped receptionist cannot activate outside clinic",
    () =>
      createPortalActivation(
        f.receptionist.actor,
        f.patientB.id,
        false,
        sender,
      ),
    undefined,
    PermissionError,
  );
  check(
    "Historical patients start NOT ENABLED",
    (await getStaffPortalStatus(f.owner.actor, f.patient.id)).status ===
      "NOT ENABLED",
  );
  await createPortalActivation(
    f.receptionist.actor,
    f.patient.id,
    false,
    sender,
  );
  const first = activationToken;
  check(
    "Staff activation is pending and masked",
    (await getStaffPortalStatus(f.owner.actor, f.patient.id)).status ===
      "PENDING ACTIVATION",
  );
  const activation = await loadPortalActivation(first);
  check(
    "Only activation token hash is persisted",
    activation.tokenHash === hashPortalToken(first) &&
      activation.tokenHash !== first,
  );
  check(
    "Staff identity confirmation recorded",
    activation.createdByUserId === f.receptionist.id &&
      !!activation.identityVerifiedAt,
  );
  await rejects(
    "Staff resend cooldown enforced",
    () => createPortalActivation(f.owner.actor, f.patient.id, true, sender),
    429,
  );
  await prisma.patientPortalActivation.update({
    where: { id: activation.id },
    data: { createdAt: new Date(Date.now() - 61000) },
  });
  await createPortalActivation(f.owner.actor, f.patient.id, true, sender);
  const token = activationToken;
  await rejects(
    "Resend invalidates old token",
    () => loadPortalActivation(first),
    404,
  );
  await requestPatientPortalCode({ token }, sender);
  const wrong = code === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++)
    await rejects(
      `Wrong OTP attempt ${i + 1} rejected`,
      () => verifyPatientPortalCode({ token, code: wrong }),
      400,
    );
  await rejects(
    "Correct code cannot revive exhausted challenge",
    () => verifyPatientPortalCode({ token, code }),
    400,
  );
  const exhausted = await prisma.patientPortalChallenge.findFirstOrThrow({
    where: { activationId: (await loadPortalActivation(token)).id },
    orderBy: { createdAt: "desc" },
  });
  check("Failed OTP attempts committed", exhausted.attemptCount === 5);
  await ageChallenges(mobile);
  await requestPatientPortalCode({ token }, sender);
  await prisma.patientPortalChallenge.updateMany({
    where: { mobileE164: mobile, consumedAt: null },
    data: { expiresAt: new Date(Date.now() - 1) },
  });
  await rejects(
    "Expired OTP refuses the correct code",
    () => verifyPatientPortalCode({ token, code }),
    400,
  );
  await ageChallenges(mobile);
  await requestPatientPortalCode({ token }, sender);
  const concurrent = await Promise.allSettled([
    verifyPatientPortalCode({ token, code }),
    verifyPatientPortalCode({ token, code }),
  ]);
  check(
    "Concurrent activation redemption authenticates exactly once",
    concurrent.filter((r) => r.status === "fulfilled").length === 1,
  );
  const sessionToken = (
    concurrent.find(
      (r) => r.status === "fulfilled",
    ) as PromiseFulfilledResult<string>
  ).value;
  const actor = await loadPatientActor(sessionToken);
  check(
    "Actor derives exact patient/tenant from verified link",
    actor.patientId === f.patient.id && actor.tenantId === f.tenant.id,
  );
  const storedSession = await prisma.patientPortalSession.findUniqueOrThrow({
    where: { id: actor.sessionId },
  });
  check(
    "Session lifetime is twelve hours with no sliding extension",
    Math.abs(
      storedSession.expiresAt.getTime() -
        storedSession.createdAt.getTime() -
        SESSION_TTL,
    ) < 1000,
  );
  await prisma.patientPortalAccount.update({
    where: { id: actor.portalAccountId },
    data: { status: "DISABLED" },
  });
  await rejects(
    "Disabled account denies existing session",
    () => loadPatientActor(sessionToken),
    401,
  );
  await prisma.patientPortalAccount.update({
    where: { id: actor.portalAccountId },
    data: { status: "ACTIVE" },
  });
  await prisma.patient.update({
    where: { id: f.patient.id },
    data: { mobileNumber: `8${f.number.slice(1)}` },
  });
  check(
    "Patient mobile edits do not transfer verified portal identity",
    (
      await prisma.patientPortalAccount.findUniqueOrThrow({
        where: { id: actor.portalAccountId },
      })
    ).mobileE164 === mobile &&
      (await loadPatientActor(sessionToken)).patientId === f.patient.id,
  );
  await prisma.patient.update({
    where: { id: f.patient.id },
    data: { mobileNumber: f.number },
  });
  check(
    "Session token hash persisted and 12 hour absolute TTL",
    (
      await prisma.patientPortalSession.findUniqueOrThrow({
        where: { id: actor.sessionId },
      })
    ).tokenHash === hashPortalToken(sessionToken),
  );
  await rejects(
    "Activation token cannot be replayed",
    () => verifyPatientPortalCode({ token, code }),
    404,
  );
  check(
    "A to A profile allowed",
    (await patientPortalProfile(actor)).patientCode === f.patient.patientCode,
  );
  check(
    "A to A visit allowed",
    (await patientOwnedRegistration(actor, f.visitA.id)).id === f.visitA.id,
  );
  await rejects(
    "A to B visit is 404",
    () => patientOwnedRegistration(actor, f.visitBRow.id),
    404,
  );
  await rejects(
    "A to foreign tenant visit is 404",
    () => patientOwnedRegistration(actor, f.visitCRow.id),
    404,
  );
  check(
    "A to A linked appointment allowed",
    (await patientOwnedAppointment(actor, f.appointmentA.id)).id ===
      f.appointmentA.id,
  );
  await rejects(
    "A to B appointment is 404",
    () => patientOwnedAppointment(actor, f.appointmentB.id),
    404,
  );
  await rejects(
    "A to foreign appointment is 404",
    () => patientOwnedAppointment(actor, f.appointmentC.id),
    404,
  );
  await rejects(
    "Same mobile unlinked appointment hidden",
    () => patientOwnedAppointment(actor, f.unlinked.id),
    404,
  );
  for (const [label, rx] of [
    ["ISSUED", f.issued],
    ["SUPERSEDED", f.superseded],
    ["CANCELLED", f.cancelled],
  ] as const)
    check(
      `A ${label} prescription allowed`,
      (await patientOwnedPrescription(actor, rx.id)).status === label,
    );
  await rejects(
    "A DRAFT prescription is 404",
    () => patientOwnedPrescription(actor, f.draft.id),
    404,
  );
  await rejects(
    "A to B prescription is 404",
    () => patientOwnedPrescription(actor, f.rxB.id),
    404,
  );
  await rejects(
    "A to foreign tenant prescription is 404",
    () => patientOwnedPrescription(actor, f.rxC.id),
    404,
  );
  await rejects(
    "A to B print authorization is 404",
    () => patientOwnedPrescription(actor, f.rxB.id, "PRESCRIPTION_PRINTED"),
    404,
  );
  check(
    "Superseded target is ownership checked",
    (await patientOwnedPrescription(actor, f.superseded.id)).latestId ===
      f.latest.id,
  );
  check(
    "Prescription list excludes drafts and other patients",
    (await patientPortalHistory(actor, "prescriptions")).items.length === 4,
  );
  const dto = await patientOwnedPrescription(actor, f.issued.id);
  check(
    "Patient DTO excludes internal IDs/audit/clinical workspace fields",
    !JSON.stringify(dto).includes("createdBy") &&
      !("id" in dto.patient) &&
      !("id" in dto.doctor) &&
      !("clinicalJson" in dto) &&
      !("historyOfPresentIllness" in dto),
  );
  await prisma.patient.update({
    where: { id: f.patient.id },
    data: { address: "Changed synthetic address" },
  });
  await prisma.doctor.update({
    where: { id: f.doctor.id },
    data: { qualification: "Changed synthetic qualification" },
  });
  await prisma.clinic.update({
    where: { id: f.clinic.id },
    data: { address: "Changed synthetic clinic address" },
  });
  const frozen = await patientOwnedPrescription(actor, f.issued.id);
  check(
    "Issued snapshot remains immutable after profile edits",
    frozen.patient.address === "Original patient address" &&
      frozen.doctor.qualification === "MBBS, MD" &&
      frozen.clinic.address === "Original clinic address",
  );
  await rejects(
    "Shared mobile second patient activation blocked",
    () => createPortalActivation(f.owner.actor, f.patientB.id, false, sender),
    409,
  );
  check(
    "Shared mobile never combines records",
    (await prisma.patientPortalLink.count({
      where: { portalAccountId: actor.portalAccountId, revokedAt: null },
    })) === 1,
  );
  const portalFeature = await prisma.feature.findUniqueOrThrow({
    where: { key: "patient_portal" },
  });
  const rxFeature = await prisma.feature.findUniqueOrThrow({
    where: { key: "prescriptions" },
  });
  await prisma.feature.update({
    where: { id: rxFeature.id },
    data: { globalEnabled: false },
  });
  check(
    "Historical Rx remains visible without staff prescriptions feature",
    (await patientOwnedPrescription(actor, f.issued.id)).id === f.issued.id,
  );
  await prisma.feature.update({
    where: { id: rxFeature.id },
    data: { globalEnabled: true },
  });
  await prisma.feature.update({
    where: { id: portalFeature.id },
    data: { globalEnabled: false },
  });
  await rejects(
    "Global portal kill switch denies live session",
    () => loadPatientActor(sessionToken),
    503,
  );
  await requestPatientPortalCode({ mobile }, sender);
  check("Disabled entitlement login request stays generic", true);
  await prisma.feature.update({
    where: { id: portalFeature.id },
    data: { globalEnabled: true },
  });
  await prisma.tenantFeatureOverride.create({
    data: {
      tenantId: f.tenant.id,
      featureId: portalFeature.id,
      enabled: false,
      reason: "Synthetic test",
    },
  });
  await rejects(
    "Tenant override denies portal",
    () => requirePatientPortalEntitlement(f.tenant.id),
    503,
  );
  await prisma.tenantFeatureOverride.delete({
    where: {
      tenantId_featureId: {
        tenantId: f.tenant.id,
        featureId: portalFeature.id,
      },
    },
  });
  await prisma.tenant.update({
    where: { id: f.tenant.id },
    data: { planId: null },
  });
  await rejects(
    "Missing tenant plan entitlement denies portal",
    () => requirePatientPortalEntitlement(f.tenant.id),
    503,
  );
  await prisma.tenant.update({
    where: { id: f.tenant.id },
    data: { planId: f.tenant.planId },
  });
  await prisma.roleFeatureAccess.create({
    data: {
      roleId: (
        await prisma.role.findFirstOrThrow({
          where: { tenantId: f.tenant.id, key: "DOCTOR" },
        })
      ).id,
      featureId: portalFeature.id,
      enabled: false,
    },
  });
  check(
    "Patient actor does not require staff RoleFeatureAccess",
    (await loadPatientActor(sessionToken)).patientId === f.patient.id,
  );
  await rejects(
    "Patient Portal cannot be controlled through staff role feature switch",
    () =>
      setRoleFeatureAccess(f.owner.actor, {
        roleId: "unused",
        featureKey: "patient_portal",
        enabled: true,
      }),
  );
  await rejects(
    "Future clock expires session",
    () =>
      loadPatientActor(sessionToken, new Date(Date.now() + SESSION_TTL + 1000)),
    401,
  );
  await rejects(
    "Staff session ID cannot be used as patient token",
    () => loadPatientActor("staff-session-id"),
    401,
  );
  await ageChallenges(mobile);
  await requestPatientPortalCode({ mobile }, sender);
  const loginSession = await verifyPatientPortalCode({ mobile, code });
  check(
    "Mobile login resolves linked patient only",
    (await loadPatientActor(loginSession)).patientId === f.patient.id,
  );
  await logoutPatientPortal(loginSession);
  await rejects(
    "Logout revokes session",
    () => loadPatientActor(loginSession),
    401,
  );
  await revokePatientPortal(f.receptionist.actor, f.patient.id);
  await rejects(
    "Revoke invalidates existing session immediately",
    () => loadPatientActor(sessionToken),
    401,
  );
  await rejects(
    "Previously resolved actor cannot read after revoke",
    () => patientOwnedPrescription(actor, f.issued.id),
    401,
  );
  check(
    "Revoke preserves clinical records",
    (await prisma.prescription.count({
      where: { patientId: f.patient.id },
    })) === 5,
  );
  await createPortalActivation(f.owner.actor, f.patient.id, false, sender);
  await ageChallenges(mobile);
  await requestPatientPortalCode({ token: activationToken }, sender);
  const reenabled = await verifyPatientPortalCode({
    token: activationToken,
    code,
  });
  check(
    "Reactivation creates a fresh link generation",
    (await loadPatientActor(reenabled)).linkId !== actor.linkId,
  );
  await rejects(
    "Reactivation cannot revive an old session",
    () => loadPatientActor(sessionToken),
    401,
  );
  await prisma.patient.update({
    where: { id: f.patientB.id },
    data: { mobileNumber: `8${f.number.slice(1)}` },
  });
  await createPortalActivation(f.owner.actor, f.patientB.id, false, sender);
  const mobileChangeToken = activationToken;
  await prisma.patient.update({
    where: { id: f.patientB.id },
    data: { mobileNumber: `7${f.number.slice(1)}` },
  });
  await rejects(
    "Pending patient mobile change refuses old activation",
    () => loadPortalActivation(mobileChangeToken),
    404,
  );
  await prisma.patientPortalActivation.updateMany({
    where: { patientId: f.patientB.id },
    data: { expiresAt: new Date(Date.now() - 1) },
  });
  await rejects(
    "Expired activation denied",
    () => loadPortalActivation(mobileChangeToken),
    404,
  );
  await rejects("DB rejects a forged tenant/patient link", () =>
    prisma.patientPortalLink.create({
      data: {
        portalAccountId: actor.portalAccountId,
        patientId: f.patientB.id,
        tenantId: f.foreignTenant.id,
        activePatientId: f.patientB.id,
        activeAccountId: actor.portalAccountId,
        verifiedAt: new Date(),
        identityVerifiedAt: new Date(),
      },
    }),
  );
  await rejects("DB rejects live link NULL-key cardinality bypass", () =>
    prisma.patientPortalLink.create({
      data: {
        portalAccountId: actor.portalAccountId,
        patientId: f.patientB.id,
        tenantId: f.tenant.id,
        verifiedAt: new Date(),
        identityVerifiedAt: new Date(),
      },
    }),
  );
  for (let i = 0; i < 5; i++) {
    try {
      await portalAuthRateLimit(
        `synthetic-rate-${f.patient.id}`,
        `rate-${f.patient.id}`,
        true,
      );
    } catch {
      /* capped below */
    }
  }
  for (let i = 0; i < 10; i++)
    await portalAuthRateLimit(
      `synthetic-rate-${f.patient.id}`,
      `rate-${f.patient.id}`,
      true,
    );
  await rejects(
    "Database rate limiter refuses OTP brute force",
    () =>
      portalAuthRateLimit(
        `synthetic-rate-${f.patient.id}`,
        `rate-${f.patient.id}`,
        true,
      ),
    undefined,
    RateLimitError,
  );
  const rolesBefore = await prisma.role.create({
    data: {
      tenantId: f.tenant.id,
      key: null,
      name: `Customized ${f.patient.id}`,
      isSystem: false,
      permissions: PRE_PATIENT_PORTAL_ROLES.RECEPTIONIST.slice(1),
    },
  });
  const beforeAccounts = await prisma.patientPortalAccount.count();
  const historicalAdmin = await prisma.role.findFirstOrThrow({
    where: { tenantId: f.tenant.id, key: "CLINIC_ADMIN" },
  });
  await prisma.role.update({
    where: { id: historicalAdmin.id },
    data: { permissions: [...PRE_PATIENT_PORTAL_ROLES.CLINIC_ADMIN] },
  });
  const customReception = await prisma.role.findFirstOrThrow({
    where: { tenantId: f.tenant.id, key: "RECEPTIONIST" },
  });
  const customPermissions = [
    ...PRE_PATIENT_PORTAL_ROLES.RECEPTIONIST,
    "custom:right",
  ];
  await prisma.role.update({
    where: { id: customReception.id },
    data: { permissions: customPermissions },
  });
  execFileSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "scripts/backfill-patient-portal.mts"],
    { env: process.env, stdio: "pipe" },
  );
  check(
    "Backfill dry run creates no patient identity",
    beforeAccounts === (await prisma.patientPortalAccount.count()),
  );
  check(
    "Backfill dry run does not broaden exact historical role",
    !(
      await prisma.role.findUniqueOrThrow({ where: { id: historicalAdmin.id } })
    ).permissions
      ?.toString()
      .includes("patient_portal:manage"),
  );
  execFileSync(
    process.execPath,
    [
      "node_modules/tsx/dist/cli.mjs",
      "scripts/backfill-patient-portal.mts",
      "--apply",
    ],
    { env: process.env, stdio: "pipe" },
  );
  check(
    "Backfill apply upgrades exact historical system Admin",
    (
      await prisma.role.findUniqueOrThrow({ where: { id: historicalAdmin.id } })
    ).permissions
      ?.toString()
      .includes("patient_portal:manage"),
  );
  check(
    "Backfill apply preserves customized system Receptionist",
    JSON.stringify(
      (
        await prisma.role.findUniqueOrThrow({
          where: { id: customReception.id },
        })
      ).permissions,
    ) === JSON.stringify(customPermissions),
  );
  check(
    "Backfill apply never creates portal accounts",
    beforeAccounts === (await prisma.patientPortalAccount.count()),
  );
  let remoteBlocked = false;
  try {
    execFileSync(
      process.execPath,
      [
        "node_modules/tsx/dist/cli.mjs",
        "scripts/backfill-patient-portal.mts",
        "--apply",
      ],
      {
        env: {
          ...process.env,
          DATABASE_URL: "mysql://synthetic@remote.example/medcare_pro",
        },
        stdio: "pipe",
      },
    );
  } catch {
    remoteBlocked = true;
  }
  check(
    "Remote backfill writes require explicit allow-remote flag",
    remoteBlocked,
  );
  check(
    "Backfill preserves customized roles",
    JSON.stringify(
      (await prisma.role.findUniqueOrThrow({ where: { id: rolesBefore.id } }))
        .permissions,
    ) === JSON.stringify(rolesBefore.permissions),
  );
  check(
    "Patient audit excludes secrets and clinical content",
    !(
      await prisma.patientPortalAuditEvent.findMany({
        where: { portalAccountId: actor.portalAccountId },
      })
    ).some(
      (e) =>
        JSON.stringify(e).includes("Synthetic portal diagnosis") ||
        JSON.stringify(e).includes(sessionToken),
    ),
  );
  await rejects(
    "Doctor never gained management permission",
    () =>
      requirePermission(
        f.doctorUser.actor,
        "patient_portal:manage",
        f.clinic.id,
      ),
    undefined,
    PermissionError,
  );
  console.log(`Patient Portal database checks: ${checks} passed`);
}
main()
  .catch((e) => {
    console.error(
      e instanceof assert.AssertionError
        ? e.message
        : `Patient Portal database check failed: ${e instanceof Error ? e.name : "unknown"} ${(e as { code?: string }).code ?? ""}; sensitive payload withheld.`,
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
