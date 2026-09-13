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
  activatePatientPortal,
  loginPatientPortal,
  verifyPatientRecoveryEmail,
  requestPatientPasswordReset,
  resetPatientPassword,
  resolveSecurityTokenTenant,
  changePatientRecoveryEmail,
  resendPatientRecoveryEmail,
  portalAuthRateLimit,
} from "@/lib/patientPortalPasswordAuth";
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
  hashPortalToken,
  PatientPortalError,
  SESSION_TTL,
  portalToken,
} from "@/lib/patientPortalSecurity";
import { PermissionError, ScopeError } from "@/lib/rbac";
import { RateLimitError } from "@/lib/rateLimit";
import type { PortalSecurityMail } from "@/lib/patientPortalEmails";
assertPatientPortalTestDatabase();
process.env.AUTH_URL = "http://127.0.0.1:33322";
const password = "synthetic patient passphrase";
const newPassword = "synthetic replacement passphrase";
const mails: PortalSecurityMail[] = [];
const mailer = async (mail: PortalSecurityMail) => {
  mails.push(mail);
};
const secret = (url: string) => new URL(url).searchParams.get("token")!;
const activationSecret = (url: string) => url.split("/").at(-1)!;
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
        (error as { status?: number }).status === status
      );
    }
    if (kind) {
      return (
        error instanceof kind ||
        (error instanceof Error && error.name === kind.name)
      );
    }
    return error instanceof Error;
  });
  checks++;
  console.log(`PASS ${label}`);
}
async function main() {
  const f = await createPatientPortalFixture();
  await prisma.patient.update({
    where: { id: f.patientC.id },
    data: { patientCode: f.patient.patientCode },
  });
  const emailA = `patient-a-${f.patient.id}@example.test`,
    emailB = `patient-b-${f.patient.id}@example.test`;
  await rejects(
    "Staff without portal permission denied",
    () => createPortalActivation(f.doctorUser.actor, f.patient.id),
    undefined,
    PermissionError,
  );
  await rejects(
    "Cross-tenant staff activation denied",
    () => createPortalActivation(f.foreign.actor, f.patient.id),
    undefined,
    ScopeError,
  );
  await rejects(
    "Cross-clinic receptionist activation denied",
    () => createPortalActivation(f.receptionist.actor, f.patientB.id),
    undefined,
    PermissionError,
  );
  const firstQR = await createPortalActivation(
    f.receptionist.actor,
    f.patient.id,
  );
  const first = activationSecret(firstQR.activationUrl);
  check(
    "Staff receives one-time QR only on authorized creation",
    first.length === 43 &&
      firstQR.activationUrl.startsWith(process.env.AUTH_URL!),
  );
  check(
    "Reload status cannot reconstruct raw QR",
    !(
      "activationUrl" in
      (await getStaffPortalStatus(f.owner.actor, f.patient.id))
    ),
  );
  check(
    "QR TTL is 15 minutes and hash only is stored",
    (await loadPortalActivation(first)).tokenHash === hashPortalToken(first) &&
      new Date(firstQR.expiresAt).getTime() - Date.now() <= 900000,
  );
  const secondQR = await createPortalActivation(
    f.owner.actor,
    f.patient.id,
    true,
  );
  const token = activationSecret(secondQR.activationUrl);
  await rejects(
    "Regenerated QR invalidates previous QR",
    () => loadPortalActivation(first),
    404,
  );
  const concurrent = await Promise.allSettled([
    activatePatientPortal({ token, password, email: emailA }, {}, mailer),
    activatePatientPortal({ token, password, email: emailA }, {}, mailer),
  ]);
  check(
    "Concurrent activation succeeds exactly once",
    concurrent.filter((r) => r.status === "fulfilled").length === 1,
  );
  const sessionToken = (
    concurrent.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<{
      sessionToken: string;
    }>
  ).value.sessionToken;
  const actor = await loadPatientActor(sessionToken);
  const identity = {
    organization: f.tenant.slug,
    patientCode: f.patient.patientCode,
  };
  check(
    "Token derives exact patient and tenant",
    actor.patientId === f.patient.id && actor.tenantId === f.tenant.id,
  );
  const account = await prisma.patientPortalAccount.findUniqueOrThrow({
    where: { id: actor.portalAccountId },
  });
  check(
    "New account has no copied mobile and email is pending only",
    account.mobileE164 === null &&
      account.recoveryEmail === null &&
      account.pendingRecoveryEmail === emailA &&
      !!account.passwordHash,
  );
  await rejects(
    "QR single use",
    () => activatePatientPortal({ token, password }, {}, mailer),
    404,
  );
  const storedSession = await prisma.patientPortalSession.findUniqueOrThrow({
    where: { id: actor.sessionId },
  });
  check(
    "Session opaque hash and absolute 12 hour TTL",
    storedSession.tokenHash === hashPortalToken(sessionToken) &&
      Math.abs(
        storedSession.expiresAt.getTime() -
          storedSession.createdAt.getTime() -
          SESSION_TTL,
      ) < 1000,
  );
  for (const [label, input] of [
    [
      "wrong organization",
      { ...identity, organization: "unknown-org", password },
    ],
    ["wrong patient code", { ...identity, patientCode: "UNKNOWN", password }],
    ["wrong password", { ...identity, password: "wrong password" }],
  ] as const) {
    await assert.rejects(
      () => loginPatientPortal(input),
      (e: unknown) =>
        (e instanceof PatientPortalError ||
          (e instanceof Error && e.name === "PatientPortalError")) &&
        (e as Error).message === "Invalid sign-in details.",
    );
    check(`Generic login error: ${label}`, true);
  }
  const savedHash = account.passwordHash;
  await prisma.patientPortalAccount.update({
    where: { id: account.id },
    data: { passwordHash: null },
  });
  check(
    "Legacy mobile-only account derives SETUP REQUIRED",
    (await getStaffPortalStatus(f.owner.actor, f.patient.id)).status ===
      "SETUP REQUIRED",
  );
  await rejects(
    "Legacy account cannot password login",
    () => loginPatientPortal({ ...identity, password }),
    400,
  );
  await prisma.patientPortalAccount.update({
    where: { id: account.id },
    data: { passwordHash: savedHash, status: "DISABLED" },
  });
  await rejects(
    "Disabled account cannot login",
    () => loginPatientPortal({ ...identity, password }),
    400,
  );
  await rejects(
    "Disabled account kills session",
    () => loadPatientActor(sessionToken),
    401,
  );
  await prisma.patientPortalAccount.update({
    where: { id: account.id },
    data: { status: "ACTIVE" },
  });
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

  const qrB = await createPortalActivation(f.owner.actor, f.patientB.id);
  const portalFeature = await prisma.feature.findUniqueOrThrow({
    where: { key: "patient_portal" },
  });
  await prisma.feature.update({
    where: { id: portalFeature.id },
    data: { globalEnabled: false },
  });
  await rejects(
    "Entitlement kill switch immediately denies patient session",
    () => loadPatientActor(sessionToken),
    503,
  );
  await rejects(
    "Entitlement kill switch keeps password login generic",
    () => loginPatientPortal({ ...identity, password }),
    400,
  );
  await rejects(
    "Entitlement kill switch denies live QR redemption",
    () =>
      activatePatientPortal(
        { token: activationSecret(qrB.activationUrl), password },
        {},
        mailer,
      ),
    503,
  );
  await prisma.feature.update({
    where: { id: portalFeature.id },
    data: { globalEnabled: true },
  });
  await prisma.tenantFeatureOverride.create({
    data: {
      tenantId: f.tenant.id,
      featureId: portalFeature.id,
      enabled: false,
      reason: "Synthetic portal auth regression",
    },
  });
  await rejects(
    "Tenant portal override immediately denies session",
    () => loadPatientActor(sessionToken),
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
  const sessionB = await activatePatientPortal(
    {
      token: activationSecret(qrB.activationUrl),
      password: "patient b unique passphrase",
      email: emailB,
    },
    {},
    mailer,
  );
  const actorB = await loadPatientActor(sessionB.sessionToken);
  check(
    "Shared mobile creates separate accounts and sessions",
    actorB.portalAccountId !== actor.portalAccountId &&
      actorB.patientId === f.patientB.id,
  );
  await rejects(
    "Shared mobile does not share passwords",
    () =>
      loginPatientPortal({
        organization: f.tenant.slug,
        patientCode: f.patientB.patientCode,
        password,
      }),
    400,
  );
  const verifyA = secret(mails.find((m) => m.to === emailA)!.url);
  const count = mails.length;
  await requestPatientPasswordReset({ ...identity, email: emailA }, mailer);
  check("Pending email has no recovery authority", mails.length === count);
  const resolvedA = await resolveSecurityTokenTenant(
    verifyA,
    "VERIFY_RECOVERY_EMAIL",
  );
  check(
    "Unconsumed security token resolves tenant slug and businessName",
    resolvedA?.slug === f.tenant.slug &&
      resolvedA?.businessName === f.tenant.businessName,
  );
  const verifyResult = await verifyPatientRecoveryEmail(verifyA);
  check(
    "Recovery email verification returns tenantSlug",
    verifyResult.tenantSlug === f.tenant.slug,
  );
  await rejects(
    "Verification token replay denied",
    () => verifyPatientRecoveryEmail(verifyA),
    400,
  );
  const verifyB = secret(mails.find((m) => m.to === emailB)!.url);
  await verifyPatientRecoveryEmail(verifyB);
  await changePatientRecoveryEmail(
    actor,
    { password, email: `pending-${f.patient.id}@example.test` },
    mailer,
  );
  const oldVerification = secret(mails.at(-1)!.url);
  await resendPatientRecoveryEmail(actor, mailer);
  await rejects(
    "Resend invalidates previous email verification",
    () => verifyPatientRecoveryEmail(oldVerification),
    400,
  );
  check(
    "Pending email change preserves original verified inbox",
    (
      await prisma.patientPortalAccount.findUniqueOrThrow({
        where: { id: actor.portalAccountId },
      })
    ).recoveryEmail === emailA,
  );
  await rejects(
    "Email change needs current password",
    () =>
      changePatientRecoveryEmail(
        actor,
        { password: "wrong password", email: "replacement@example.test" },
        mailer,
      ),
    400,
  );
  await changePatientRecoveryEmail(
    actorB,
    { password: "patient b unique passphrase", email: emailA },
    mailer,
  );
  await rejects(
    "Recovery inbox uniqueness enforced atomically",
    () => verifyPatientRecoveryEmail(secret(mails.at(-1)!.url)),
    400,
  );
  check(
    "Failed uniqueness preserves original verified email",
    (
      await prisma.patientPortalAccount.findUniqueOrThrow({
        where: { id: actorB.portalAccountId },
      })
    ).recoveryEmail === emailB,
  );
  const beforeUnknown = mails.length;
  for (const input of [
    { ...identity, email: "wrong@example.test" },
    { ...identity, organization: "unknown", email: emailA },
    { ...identity, patientCode: "UNKNOWN", email: emailA },
  ])
    await requestPatientPasswordReset(input, mailer);
  check(
    "Unknown identities and wrong email send nothing",
    mails.length === beforeUnknown,
  );
  await requestPatientPasswordReset({ ...identity, email: emailA }, mailer);
  const expired = secret(mails.at(-1)!.url);
  await prisma.patientPortalSecurityToken.update({
    where: { tokenHash: hashPortalToken(expired) },
    data: { expiresAt: new Date(0) },
  });
  await rejects(
    "Expired password reset denied",
    () => resetPatientPassword({ token: expired, password: newPassword }),
    400,
  );
  await requestPatientPasswordReset({ ...identity, email: emailA }, mailer);
  const previousReset = secret(mails.at(-1)!.url);
  await requestPatientPasswordReset({ ...identity, email: emailA }, mailer);
  const reset = secret(mails.at(-1)!.url);
  await rejects(
    "New reset revokes previous reset",
    () => resetPatientPassword({ token: previousReset, password: newPassword }),
    400,
  );
  const resolvedReset = await resolveSecurityTokenTenant(
    reset,
    "PASSWORD_RESET",
  );
  check(
    "Unconsumed password reset token resolves tenant slug and businessName",
    resolvedReset?.slug === f.tenant.slug &&
      resolvedReset?.businessName === f.tenant.businessName,
  );
  const loginSession = await loginPatientPortal({ ...identity, password });
  const resets = await Promise.allSettled([
    resetPatientPassword({ token: reset, password: newPassword }),
    resetPatientPassword({ token: reset, password: newPassword }),
  ]);
  check(
    "Concurrent reset succeeds exactly once",
    resets.filter((r) => r.status === "fulfilled").length === 1,
  );
  const fulfilledReset = resets.find(
    (r): r is PromiseFulfilledResult<{ tenantSlug: string }> =>
      r.status === "fulfilled",
  );
  check(
    "Password reset returns tenantSlug",
    fulfilledReset?.value.tenantSlug === f.tenant.slug,
  );
  await rejects(
    "Reset token replay denied",
    () => resetPatientPassword({ token: reset, password: newPassword }),
    400,
  );
  await rejects(
    "Old activation session revoked after reset",
    () => loadPatientActor(sessionToken),
    401,
  );
  await rejects(
    "Every old login session revoked after reset",
    () => loadPatientActor(loginSession),
    401,
  );
  await rejects(
    "Old password fails after reset",
    () => loginPatientPortal({ ...identity, password }),
    400,
  );
  const replacementSession = await loginPatientPortal({
    ...identity,
    password: newPassword,
  });
  check(
    "New password works",
    (await loadPatientActor(replacementSession)).patientId === f.patient.id,
  );
  await logoutPatientPortal(replacementSession);
  await rejects(
    "Logout revokes session",
    () => loadPatientActor(replacementSession),
    401,
  );
  const liveBeforeRecovery = await loginPatientPortal({
    ...identity,
    password: newPassword,
  });
  await requestPatientPasswordReset({ ...identity, email: emailA }, mailer);
  const resetBeforeRecovery = secret(mails.at(-1)!.url);
  const recovery = await createPortalActivation(
    f.owner.actor,
    f.patient.id,
    false,
    true,
  );
  await rejects(
    "Staff recovery immediately kills password",
    () => loginPatientPortal({ ...identity, password: newPassword }),
    400,
  );
  await rejects(
    "Staff recovery immediately kills session",
    () => loadPatientActor(liveBeforeRecovery),
    401,
  );
  check(
    "Staff recovery clears compromised recovery authority",
    (
      await prisma.patientPortalAccount.findUniqueOrThrow({
        where: { id: actor.portalAccountId },
      })
    ).recoveryEmail === null && recovery.status === "RECOVERY PENDING",
  );
  await rejects(
    "Staff recovery invalidates outstanding email reset token",
    () =>
      resetPatientPassword({
        token: resetBeforeRecovery,
        password: newPassword,
      }),
    400,
  );
  const recovered = await activatePatientPortal(
    {
      token: activationSecret(recovery.activationUrl),
      password: "fresh recovery passphrase",
    },
    {},
    mailer,
  );
  check(
    "Staff recovery creates fresh link generation",
    (await loadPatientActor(recovered.sessionToken)).linkId !== actor.linkId,
  );
  await revokePatientPortal(f.owner.actor, f.patient.id);
  await rejects(
    "Revoke prevents password login",
    () =>
      loginPatientPortal({
        ...identity,
        password: "fresh recovery passphrase",
      }),
    400,
  );
  await rejects(
    "Revoke immediately kills session",
    () => loadPatientActor(recovered.sessionToken),
    401,
  );
  await rejects(
    "Previously resolved actor loses records",
    () => patientOwnedPrescription(actor, f.issued.id),
    401,
  );
  const reenable = await createPortalActivation(f.owner.actor, f.patient.id);
  const reenabled = await activatePatientPortal(
    {
      token: activationSecret(reenable.activationUrl),
      password: "reenabled fresh passphrase",
    },
    {},
    mailer,
  );
  await rejects(
    "Reenable never revives old session",
    () => loadPatientActor(recovered.sessionToken),
    401,
  );
  check(
    "Reenable creates a new active link",
    (await loadPatientActor(reenabled.sessionToken)).linkId !== actor.linkId,
  );
  const qrC = await createPortalActivation(
    f.owner.actor,
    f.patient.id,
    false,
    true,
  );
  await prisma.patientPortalActivation.updateMany({
    where: { activePatientId: f.patient.id },
    data: { expiresAt: new Date(0) },
  });
  await rejects(
    "Expired activation denied",
    () => loadPortalActivation(activationSecret(qrC.activationUrl)),
    404,
  );
  for (let i = 0; i < 15; i++)
    await portalAuthRateLimit(
      `synthetic-ip-${f.patient.id}`,
      `synthetic-subject-${f.patient.id}`,
    );
  await rejects(
    "DB rate limiter blocks brute force",
    () =>
      portalAuthRateLimit(
        `synthetic-ip-${f.patient.id}`,
        `synthetic-subject-${f.patient.id}`,
      ),
    undefined,
    RateLimitError,
  );
  await prisma.patientPortalActivation.updateMany({
    where: { activePatientId: f.patient.id },
    data: { revokedAt: new Date(), activePatientId: null },
  });
  const legacy = await prisma.patientPortalActivation.create({
    data: {
      patientId: f.patient.id,
      activePatientId: f.patient.id,
      tenantId: f.tenant.id,
      mobileE164: "+919999999999",
      tokenHash: hashPortalToken(portalToken()),
      expiresAt: new Date(Date.now() + 10000),
      identityVerifiedAt: new Date(),
    },
  });
  await prisma.patientPortalChallenge.create({
    data: {
      activationId: legacy.id,
      mobileE164: "+919999999999",
      purpose: "ACTIVATION",
      codeDigest: "0".repeat(64),
      expiresAt: new Date(Date.now() + 10000),
    },
  });
  const runBackfill = (...args: string[]) =>
    execFileSync(
      process.execPath,
      [
        "node_modules/tsx/dist/cli.mjs",
        "scripts/backfill-patient-portal-password-auth.mts",
        ...args,
      ],
      { env: process.env, encoding: "utf8" },
    );
  const historyCounts = {
    accounts: await prisma.patientPortalAccount.count(),
    links: await prisma.patientPortalLink.count(),
    sessions: await prisma.patientPortalSession.count(),
    rx: await prisma.prescription.count(),
  };
  runBackfill();
  check(
    "Backfill dry run leaves activation intact",
    !(
      await prisma.patientPortalActivation.findUniqueOrThrow({
        where: { id: legacy.id },
      })
    ).revokedAt,
  );
  runBackfill("--apply");
  check(
    "Backfill invalidates only legacy SMS activation",
    !!(
      await prisma.patientPortalActivation.findUniqueOrThrow({
        where: { id: legacy.id },
      })
    ).revokedAt,
  );
  const second = JSON.parse(runBackfill("--apply"));
  check(
    "Backfill second apply is idempotent",
    second.revokedActivations === 0 && second.invalidatedChallenges === 0,
  );
  check(
    "Backfill preserves accounts links sessions and prescriptions",
    JSON.stringify(historyCounts) ===
      JSON.stringify({
        accounts: await prisma.patientPortalAccount.count(),
        links: await prisma.patientPortalLink.count(),
        sessions: await prisma.patientPortalSession.count(),
        rx: await prisma.prescription.count(),
      }),
  );
  await rejects("Remote backfill apply guard", async () =>
    execFileSync(
      process.execPath,
      [
        "node_modules/tsx/dist/cli.mjs",
        "scripts/backfill-patient-portal-password-auth.mts",
        "--apply",
      ],
      {
        env: {
          ...process.env,
          DATABASE_URL:
            "mysql://synthetic@remote.example/medcare_ep_portal_test",
        },
        stdio: "pipe",
      },
    ),
  );
  check(
    "Audits contain no password or raw security tokens",
    !(await prisma.patientPortalAuditEvent.findMany()).some(
      (e) =>
        JSON.stringify(e).includes(password) ||
        JSON.stringify(e).includes(reset) ||
        JSON.stringify(e).includes(sessionToken),
    ),
  );
  const failureQR = await createPortalActivation(
    f.foreign.actor,
    f.patientC.id,
  );
  const deliveryFailure = await activatePatientPortal(
    {
      token: activationSecret(failureQR.activationUrl),
      password: "foreign patient unique passphrase",
      email: `delivery-${f.patientC.id}@example.test`,
    },
    {},
    async () => {
      throw new Error("Synthetic delivery failure");
    },
  );
  await rejects(
    "Tenant patient-code collision cannot use another account password",
    () =>
      loginPatientPortal({
        organization: f.foreignTenant.slug,
        patientCode: f.patient.patientCode,
        password,
      }),
    400,
  );
  const failureActor = await loadPatientActor(deliveryFailure.sessionToken);
  check(
    "Email delivery failure preserves activated password and session",
    deliveryFailure.message.includes("couldn't send") &&
      failureActor.patientId === f.patientC.id,
  );
  check(
    "Failed delivery leaves email pending and untrusted",
    (
      await prisma.patientPortalAccount.findUniqueOrThrow({
        where: { id: failureActor.portalAccountId },
      })
    ).recoveryEmailVerifiedAt === null,
  );
  await resendPatientRecoveryEmail(failureActor, mailer);
  const resendToken = secret(mails.at(-1)!.url);
  await prisma.patientPortalSecurityToken.update({
    where: { tokenHash: hashPortalToken(resendToken) },
    data: { expiresAt: new Date(0) },
  });
  await rejects(
    "Expired recovery email verification denied",
    () => verifyPatientRecoveryEmail(resendToken),
    400,
  );
  await portalAuthRateLimit(
    `cooldown-${f.patient.id}`,
    actor.portalAccountId,
    "email-request",
    true,
  );
  await rejects(
    "Email resend 60-second cooldown enforced",
    () =>
      portalAuthRateLimit(
        `cooldown-${f.patient.id}`,
        actor.portalAccountId,
        "email-request",
        true,
      ),
    undefined,
    RateLimitError,
  );
  console.log(`Patient Portal database checks: ${checks} passed`);
}
main()
  .catch((e) => {
    console.error(
      e instanceof assert.AssertionError
        ? e.message
        : `Patient Portal check failed: ${e instanceof Error ? e.name : "unknown"}; sensitive payload withheld.`,
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
