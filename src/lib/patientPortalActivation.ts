import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission, ScopeError, type ActorContext } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { createDatabaseRateLimiter } from "@/lib/rateLimit";
import { requirePatientPortalEntitlement } from "@/lib/patientPortalFeature";
import {
  patientPortalSender,
  type PatientPortalVerificationSender,
} from "@/lib/patientPortalSender";
import {
  ACTIVATION_TTL,
  hashPortalToken,
  maskPatientMobile,
  normalizePatientMobile,
  PatientPortalError,
  portalOrigin,
  portalRecordLive,
  portalToken,
} from "@/lib/patientPortalSecurity";

export async function lockPortalPatient(
  db: Prisma.TransactionClient,
  id: string,
) {
  await db.$queryRaw`SELECT id FROM patients WHERE id = ${id} FOR UPDATE`;
}
export async function requirePortalStaffPatient(
  actor: ActorContext,
  id: string,
  db: Prisma.TransactionClient = prisma,
) {
  const patient = await db.patient.findFirst({
    where: { id, tenantId: actor.tenantId },
  });
  if (!patient) throw new ScopeError();
  await requirePermission(actor, "patient_portal:manage", patient.clinicId, db);
  await requirePatientPortalEntitlement(patient.tenantId, db);
  return patient;
}
export async function getStaffPortalStatus(actor: ActorContext, id: string) {
  const patient = await requirePortalStaffPatient(actor, id);
  const link = await prisma.patientPortalLink.findFirst({
    where: { patientId: id, tenantId: actor.tenantId },
    orderBy: { createdAt: "desc" },
    include: { portalAccount: true },
  });
  const activation = await prisma.patientPortalActivation.findFirst({
    where: { activePatientId: id, tenantId: actor.tenantId },
  });
  const pending =
    activation &&
    portalRecordLive(activation, new Date()) &&
    normalizePatientMobile(patient.mobileNumber) === activation.mobileE164;
  return {
    status:
      link && !link.revokedAt && link.portalAccount.status === "ACTIVE"
        ? "ACTIVE"
        : pending
          ? "PENDING ACTIVATION"
          : link
            ? "REVOKED"
            : "NOT ENABLED",
    mobile: maskPatientMobile(
      pending
        ? activation.mobileE164
        : (link?.portalAccount.mobileE164 ??
            normalizePatientMobile(patient.mobileNumber)),
    ),
    activatedAt: link?.verifiedAt.toISOString() ?? null,
    lastLoginAt: link?.portalAccount.lastLoginAt?.toISOString() ?? null,
  };
}
export async function createPortalActivation(
  actor: ActorContext,
  id: string,
  resend = false,
  sender?: PatientPortalVerificationSender,
) {
  await requirePortalStaffPatient(actor, id);
  await createDatabaseRateLimiter(prisma).assertAllowed({
    policy: {
      name: "patient-portal:staff:activation",
      windowMs: 3600000,
      blockMs: 3600000,
      maxCount: 5,
    },
    subject: id,
  });
  const transport = sender ?? (await patientPortalSender());
  const raw = portalToken();
  const activationUrl = `${portalOrigin()}/patient/activate/${raw}`;
  const activation = await prisma.$transaction(async (db) => {
    await lockPortalPatient(db, id);
    const patient = await requirePortalStaffPatient(actor, id, db);
    const mobileE164 = normalizePatientMobile(patient.mobileNumber);
    const now = new Date();
    const active = await db.patientPortalLink.findUnique({
      where: { activePatientId: id },
    });
    if (active)
      throw new PatientPortalError(
        409,
        "Revoke current portal access before creating a new activation.",
      );
    const account = await db.patientPortalAccount.findUnique({
      where: { mobileE164 },
      include: { links: true },
    });
    // Never reassign an account, including a previously revoked one, to a different patient.
    if (
      account?.links.some(
        (link) => link.patientId !== id || link.tenantId !== patient.tenantId,
      )
    )
      throw new PatientPortalError(
        409,
        "This mobile number is already associated with a Patient Portal account. Verify the patient's contact number or contact an administrator.",
      );
    const previous = await db.patientPortalActivation.findUnique({
      where: { activePatientId: id },
    });
    if (previous && previous.createdAt.getTime() + 60000 > now.getTime())
      throw new PatientPortalError(
        429,
        "Wait one minute before resending activation.",
      );
    await db.patientPortalChallenge.updateMany({
      where: { activation: { patientId: id }, consumedAt: null },
      data: { consumedAt: now },
    });
    await db.patientPortalActivation.updateMany({
      where: { patientId: id, revokedAt: null, consumedAt: null },
      data: { revokedAt: now, activePatientId: null },
    });
    const row = await db.patientPortalActivation.create({
      data: {
        patientId: id,
        tenantId: patient.tenantId,
        activePatientId: id,
        mobileE164,
        tokenHash: hashPortalToken(raw),
        expiresAt: new Date(now.getTime() + ACTIVATION_TTL),
        createdByUserId: actor.userId,
        identityVerifiedAt: now,
      },
    });
    const historical = await db.patientPortalLink.count({
      where: { patientId: id },
    });
    await writeAuditLog(db, {
      action: resend
        ? "PATIENT_PORTAL_ACTIVATION_RESENT"
        : historical
          ? "PATIENT_PORTAL_ACCESS_REENABLED"
          : "PATIENT_PORTAL_ACTIVATION_CREATED",
      actorUserId: actor.userId,
      actorTenantId: actor.tenantId,
      targetType: "Patient",
      targetId: id,
    });
    return row;
  });
  try {
    await transport.sendActivation({
      mobileE164: activation.mobileE164,
      activationUrl,
    });
  } catch {
    await prisma.patientPortalActivation.updateMany({
      where: { id: activation.id, consumedAt: null },
      data: { revokedAt: new Date(), activePatientId: null },
    });
    throw new PatientPortalError(
      503,
      "Activation could not be delivered. Please try again later.",
    );
  }
  return getStaffPortalStatus(actor, id);
}
export async function revokePatientPortal(actor: ActorContext, id: string) {
  await prisma.$transaction(async (db) => {
    await lockPortalPatient(db, id);
    await requirePortalStaffPatient(actor, id, db);
    const now = new Date();
    const links = await db.patientPortalLink.findMany({
      where: { patientId: id, tenantId: actor.tenantId },
    });
    const accounts = links.map((link) => link.portalAccountId);
    await db.patientPortalSession.updateMany({
      where: { portalAccountId: { in: accounts }, revokedAt: null },
      data: { revokedAt: now },
    });
    await db.patientPortalLink.updateMany({
      where: { patientId: id, revokedAt: null },
      data: {
        revokedAt: now,
        revokedByUserId: actor.userId,
        activePatientId: null,
        activeAccountId: null,
      },
    });
    await db.patientPortalAccount.updateMany({
      where: { id: { in: accounts } },
      data: { status: "DISABLED" },
    });
    await db.patientPortalChallenge.updateMany({
      where: {
        consumedAt: null,
        OR: [
          { portalAccountId: { in: accounts } },
          { activation: { patientId: id } },
        ],
      },
      data: { consumedAt: now },
    });
    await db.patientPortalActivation.updateMany({
      where: { patientId: id, consumedAt: null, revokedAt: null },
      data: { revokedAt: now, activePatientId: null },
    });
    await writeAuditLog(db, {
      action: "PATIENT_PORTAL_ACCESS_REVOKED",
      actorUserId: actor.userId,
      actorTenantId: actor.tenantId,
      targetType: "Patient",
      targetId: id,
    });
  });
  return getStaffPortalStatus(actor, id);
}
export async function loadPortalActivation(
  token: string,
  db: Prisma.TransactionClient = prisma,
  now = new Date(),
) {
  if (!/^[\w-]{43}$/.test(token))
    throw new PatientPortalError(
      404,
      "This activation is unavailable. Ask your clinic for a new link.",
    );
  const activation = await db.patientPortalActivation.findUnique({
    where: { tokenHash: hashPortalToken(token) },
    include: { patient: true },
  });
  if (
    !activation ||
    !portalRecordLive(activation, now) ||
    activation.activePatientId !== activation.patientId ||
    activation.patient.tenantId !== activation.tenantId ||
    normalizePatientMobile(activation.patient.mobileNumber) !==
      activation.mobileE164
  )
    throw new PatientPortalError(
      404,
      "This activation is unavailable. Ask your clinic for a new link.",
    );
  await requirePatientPortalEntitlement(activation.tenantId, db);
  return activation;
}
