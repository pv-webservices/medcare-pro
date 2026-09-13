import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission, ScopeError, type ActorContext } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { createDatabaseRateLimiter } from "@/lib/rateLimit";
import { requirePatientPortalEntitlement } from "@/lib/patientPortalFeature";
import {
  ACTIVATION_TTL,
  hashPortalToken,
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
export async function lockPortalAccount(
  db: Prisma.TransactionClient,
  id: string,
) {
  await db.$queryRaw`SELECT id FROM patient_portal_accounts WHERE id = ${id} FOR UPDATE`;
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
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: patient.tenantId },
    select: { slug: true },
  });
  const link = await prisma.patientPortalLink.findFirst({
    where: { patientId: id, tenantId: actor.tenantId },
    orderBy: { createdAt: "desc" },
    include: { portalAccount: true },
  });
  const activation = await prisma.patientPortalActivation.findUnique({
    where: { activePatientId: id },
  });
  const pending =
    activation &&
    activation.purpose !== "LEGACY_SMS" &&
    portalRecordLive(activation, new Date());
  return {
    status: pending
      ? activation.purpose === "STAFF_RECOVERY"
        ? "RECOVERY PENDING"
        : "PENDING ACTIVATION"
      : link && !link.revokedAt && link.portalAccount.status === "ACTIVE"
        ? link.portalAccount.passwordHash
          ? "ACTIVE"
          : "SETUP REQUIRED"
        : link
          ? "REVOKED"
          : "NOT ENABLED",
    patientCode: patient.patientCode,
    loginUrl: `${portalOrigin()}/patient/login?org=${encodeURIComponent(tenant.slug)}`,
    activatedAt: link?.verifiedAt.toISOString() ?? null,
    lastLoginAt: link?.portalAccount.lastLoginAt?.toISOString() ?? null,
  };
}
// Caller already holds patient lock. Lock accounts in a stable order, preserving history.
export async function disablePortalAccess(
  db: Prisma.TransactionClient,
  id: string,
  userId?: string,
  clearCredentials = false,
) {
  const now = new Date();
  const links = await db.patientPortalLink.findMany({
    where: { patientId: id },
  });
  const accounts = [...new Set(links.map((l) => l.portalAccountId))].sort();
  for (const account of accounts) await lockPortalAccount(db, account);
  if (
    await db.patientPortalLink.count({
      where: { portalAccountId: { in: accounts }, patientId: { not: id } },
    })
  )
    throw new PatientPortalError(
      409,
      "Portal identity history needs administrator review.",
    );
  await db.patientPortalSession.updateMany({
    where: { portalAccountId: { in: accounts }, revokedAt: null },
    data: { revokedAt: now },
  });
  await db.patientPortalLink.updateMany({
    where: { patientId: id, revokedAt: null },
    data: {
      revokedAt: now,
      revokedByUserId: userId,
      activePatientId: null,
      activeAccountId: null,
    },
  });
  await db.patientPortalAccount.updateMany({
    where: { id: { in: accounts } },
    data: {
      status: "DISABLED",
      ...(clearCredentials
        ? {
            passwordHash: null,
            passwordSetAt: null,
            recoveryEmail: null,
            recoveryEmailVerifiedAt: null,
            pendingRecoveryEmail: null,
          }
        : {}),
    },
  });
  await db.patientPortalSecurityToken.updateMany({
    where: {
      portalAccountId: { in: accounts },
      consumedAt: null,
      revokedAt: null,
    },
    data: { revokedAt: now },
  });
  await db.patientPortalActivation.updateMany({
    where: { patientId: id, consumedAt: null, revokedAt: null },
    data: { revokedAt: now, activePatientId: null },
  });
}
export async function createPortalActivation(
  actor: ActorContext,
  id: string,
  regenerate = false,
  recovery = false,
) {
  await requirePortalStaffPatient(actor, id);
  await createDatabaseRateLimiter(prisma).assertAllowed({
    policy: {
      name: "patient-portal:staff:activation",
      windowMs: 3600000,
      blockMs: 3600000,
      maxCount: 10,
    },
    subject: id,
  });
  const raw = portalToken();
  const activationUrl = `${portalOrigin()}/patient/activate/${raw}`;
  const expiresAt = await prisma.$transaction(
    async (db) => {
      await lockPortalPatient(db, id);
      const patient = await requirePortalStaffPatient(actor, id, db);
      const active = await db.patientPortalLink.findUnique({
        where: { activePatientId: id },
        include: { portalAccount: true },
      });
      if (
        active?.portalAccount.passwordHash &&
        active.portalAccount.status === "ACTIVE" &&
        !recovery
      )
        throw new PatientPortalError(
          409,
          "Use Reset Portal Access to issue a recovery QR.",
        );
      const historical = await db.patientPortalLink.count({
        where: { patientId: id },
      });
      const previous = await db.patientPortalActivation.findUnique({
        where: { activePatientId: id },
      });
      const purpose =
        recovery || previous?.purpose === "STAFF_RECOVERY"
          ? "STAFF_RECOVERY"
          : historical
            ? "REENABLE"
            : "INITIAL";
      await disablePortalAccess(
        db,
        id,
        actor.userId,
        purpose === "STAFF_RECOVERY",
      );
      const now = new Date();
      const expiry = new Date(now.getTime() + ACTIVATION_TTL);
      await db.patientPortalActivation.create({
        data: {
          patientId: id,
          tenantId: patient.tenantId,
          activePatientId: id,
          purpose,
          tokenHash: hashPortalToken(raw),
          expiresAt: expiry,
          createdByUserId: actor.userId,
          identityVerifiedAt: now,
        },
      });
      const event =
        purpose === "STAFF_RECOVERY"
          ? "PORTAL_STAFF_RECOVERY_CREATED"
          : regenerate
            ? "PORTAL_ACTIVATION_QR_REGENERATED"
            : "PORTAL_ACTIVATION_QR_CREATED";
      await db.patientPortalAuditEvent.create({
        data: { tenantId: patient.tenantId, resourceId: id, event },
      });
      await writeAuditLog(db, {
        action: event,
        actorUserId: actor.userId,
        actorTenantId: actor.tenantId,
        targetType: "Patient",
        targetId: id,
      });
      return expiry;
    },
    { isolationLevel: "ReadCommitted" },
  );
  return {
    ...(await getStaffPortalStatus(actor, id)),
    activationUrl,
    expiresAt: expiresAt.toISOString(),
  };
}
export async function revokePatientPortal(actor: ActorContext, id: string) {
  await prisma.$transaction(async (db) => {
    await lockPortalPatient(db, id);
    await requirePortalStaffPatient(actor, id, db);
    await disablePortalAccess(db, id, actor.userId);
    await db.patientPortalAuditEvent.create({
      data: {
        tenantId: actor.tenantId,
        resourceId: id,
        event: "PORTAL_ACCESS_REVOKED",
      },
    });
    await writeAuditLog(db, {
      action: "PORTAL_ACCESS_REVOKED",
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
  const unavailable = () =>
    new PatientPortalError(
      404,
      "This activation is unavailable. Ask your clinic for a new QR.",
    );
  if (!/^[\w-]{43}$/.test(token)) throw unavailable();
  const activation = await db.patientPortalActivation.findUnique({
    where: { tokenHash: hashPortalToken(token) },
    include: { patient: true },
  });
  if (
    !activation ||
    activation.purpose === "LEGACY_SMS" ||
    !portalRecordLive(activation, now) ||
    activation.activePatientId !== activation.patientId ||
    activation.patient.tenantId !== activation.tenantId
  )
    throw unavailable();
  await requirePatientPortalEntitlement(activation.tenantId, db);
  return activation;
}
