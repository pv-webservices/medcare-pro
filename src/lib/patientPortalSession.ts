import { cookies } from "next/headers";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePatientPortalEntitlement } from "@/lib/patientPortalFeature";
import {
  hashPortalToken,
  portalToken,
  portalRecordLive,
  PORTAL_COOKIE,
  SESSION_TTL,
  PatientPortalError,
} from "@/lib/patientPortalSecurity";

/** Incompatible with staff ActorContext: no userId and no staff permission. */
export interface PatientActorContext {
  portalAccountId: string;
  patientId: string;
  tenantId: string;
  sessionId: string;
  linkId: string;
}
export async function loadPatientActor(
  token: string | undefined,
  now = new Date(),
  db: Prisma.TransactionClient = prisma,
): Promise<PatientActorContext> {
  if (!token || !/^[\w-]{43}$/.test(token))
    throw new PatientPortalError(401, "Please sign in to your Patient Portal.");
  const session = await db.patientPortalSession.findUnique({
    where: { tokenHash: hashPortalToken(token) },
    include: { portalAccount: true, link: { include: { patient: true } } },
  });
  if (
    !session ||
    !portalRecordLive(session, now) ||
    session.portalAccount.status !== "ACTIVE" ||
    session.link.revokedAt ||
    session.link.accessType !== "SELF" ||
    session.link.activeAccountId !== session.portalAccountId ||
    session.link.activePatientId !== session.link.patientId ||
    session.link.tenantId !== session.link.patient.tenantId ||
    session.link.portalAccountId !== session.portalAccountId
  )
    throw new PatientPortalError(401, "Please sign in to your Patient Portal.");
  await requirePatientPortalEntitlement(session.link.tenantId, db);
  return {
    portalAccountId: session.portalAccountId,
    patientId: session.link.patientId,
    tenantId: session.link.tenantId,
    sessionId: session.id,
    linkId: session.linkId,
  };
}
export async function requirePatientActor() {
  return loadPatientActor((await cookies()).get(PORTAL_COOKIE)?.value);
}
export async function createPatientPortalSession(
  db: Prisma.TransactionClient,
  portalAccountId: string,
  linkId: string,
  meta: { ip?: string | null; userAgent?: string | null },
  now: Date,
) {
  const token = portalToken();
  await db.patientPortalSession.create({
    data: {
      portalAccountId,
      linkId,
      tokenHash: hashPortalToken(token),
      expiresAt: new Date(now.getTime() + SESSION_TTL),
      ip: meta.ip?.slice(0, 45),
      userAgent: meta.userAgent?.slice(0, 512),
    },
  });
  await db.patientPortalAccount.update({
    where: { id: portalAccountId },
    data: { lastLoginAt: now },
  });
  return token;
}
export const patientCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_TTL / 1000,
});
export async function logoutPatientPortal(token: string | undefined) {
  if (!token) return;
  await prisma.$transaction(async (db) => {
    const session = await db.patientPortalSession.findUnique({
      where: { tokenHash: hashPortalToken(token) },
    });
    if (!session) return;
    await db.patientPortalSession.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await db.patientPortalAuditEvent.create({
      data: {
        portalAccountId: session.portalAccountId,
        event: "PORTAL_LOGOUT",
      },
    });
  });
}
