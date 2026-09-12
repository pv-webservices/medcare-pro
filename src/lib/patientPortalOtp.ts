import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { createDatabaseRateLimiter } from "@/lib/rateLimit";
import {
  lockPortalPatient,
  loadPortalActivation,
} from "@/lib/patientPortalActivation";
import { createPatientPortalSession } from "@/lib/patientPortalSession";
import { requirePatientPortalEntitlement } from "@/lib/patientPortalFeature";
import {
  patientPortalSender,
  type PatientPortalVerificationSender,
} from "@/lib/patientPortalSender";
import {
  portalCode,
  portalCodeDigest,
  portalCodeMatches,
  portalChallengeLive,
  portalPepper,
  OTP_TTL,
  OTP_ATTEMPTS,
  PatientPortalError,
} from "@/lib/patientPortalSecurity";

export async function portalAuthRateLimit(
  ip: string | null,
  subject: string,
  verify = false,
) {
  const limiter = createDatabaseRateLimiter(prisma);
  for (const [dimension, value, max] of [
    ["ip", ip ?? "unknown", verify ? 50 : 20],
    ["subject", subject, verify ? 15 : 5],
  ] as const)
    await limiter.assertAllowed({
      policy: {
        name: `patient-portal:${verify ? "verify" : "request"}:${dimension}`,
        windowMs: 3600000,
        blockMs: 3600000,
        maxCount: max,
      },
      subject: value,
    });
  if (!verify)
    await limiter.assertAllowed({
      policy: {
        name: "patient-portal:cooldown",
        windowMs: 60000,
        blockMs: 60000,
        maxCount: 1,
      },
      subject,
    });
}
export async function requestPatientPortalCode(
  input: { mobile?: string; token?: string },
  sender?: PatientPortalVerificationSender,
) {
  const pepper = portalPepper();
  // Resolve transport for both known and unknown mobiles: missing provider cannot enumerate.
  const transport = sender ?? (await patientPortalSender());
  const activation = input.token
    ? await loadPortalActivation(input.token)
    : null;
  const account =
    !activation && input.mobile
      ? await prisma.patientPortalAccount.findUnique({
          where: { mobileE164: input.mobile },
          include: { links: { where: { revokedAt: null } } },
        })
      : null;
  const link = account?.links.length === 1 ? account.links[0] : null;
  if (!activation && (!account || account.status !== "ACTIVE" || !link)) return;
  if (link) {
    try {
      await requirePatientPortalEntitlement(link.tenantId);
    } catch (e) {
      if (e instanceof PatientPortalError) return;
      throw e;
    }
  }
  const patientId = activation?.patientId ?? link!.patientId;
  const code = portalCode();
  const id = randomUUID();
  const challenge = await prisma.$transaction(async (db) => {
    await lockPortalPatient(db, patientId);
    const freshActivation = input.token
      ? await loadPortalActivation(input.token, db)
      : null;
    const freshLink = link
      ? await db.patientPortalLink.findFirst({
          where: {
            id: link.id,
            revokedAt: null,
            portalAccount: { status: "ACTIVE" },
          },
        })
      : null;
    if (!freshActivation && !freshLink) return null;
    try {
      await requirePatientPortalEntitlement(
        freshActivation?.tenantId ?? freshLink!.tenantId,
        db,
      );
    } catch (error) {
      if (!freshActivation && error instanceof PatientPortalError) return null;
      throw error;
    }
    const mobileE164 = freshActivation?.mobileE164 ?? account!.mobileE164;
    const purpose = freshActivation ? "ACTIVATION" : "LOGIN";
    const now = new Date();
    const recent = await db.patientPortalChallenge.findFirst({
      where: { mobileE164, purpose },
      orderBy: { createdAt: "desc" },
    });
    if (recent && recent.createdAt.getTime() + 60000 > now.getTime())
      return null;
    await db.patientPortalChallenge.updateMany({
      where: { mobileE164, purpose, consumedAt: null },
      data: { consumedAt: now },
    });
    return db.patientPortalChallenge.create({
      data: {
        id,
        mobileE164,
        purpose,
        portalAccountId: freshActivation ? null : account!.id,
        activationId: freshActivation?.id,
        codeDigest: portalCodeDigest(id, code, pepper),
        expiresAt: new Date(now.getTime() + OTP_TTL),
        maxAttempts: OTP_ATTEMPTS,
      },
    });
  });
  if (!challenge) return;
  try {
    await transport.sendLoginCode({
      mobileE164: challenge.mobileE164,
      code,
      purpose: challenge.purpose,
    });
  } catch {
    await prisma.patientPortalChallenge.updateMany({
      where: { id },
      data: { consumedAt: new Date() },
    });
    // Login request still returns the same generic response as an unknown mobile.
    if (activation) throw new PatientPortalError(503);
  }
}
export async function verifyPatientPortalCode(
  input: { mobile?: string; token?: string; code: string },
  meta: { ip?: string | null; userAgent?: string | null } = {},
) {
  const pepper = portalPepper();
  const activation = input.token
    ? await loadPortalActivation(input.token)
    : null;
  const account =
    !activation && input.mobile
      ? await prisma.patientPortalAccount.findUnique({
          where: { mobileE164: input.mobile },
          include: { links: { where: { revokedAt: null } } },
        })
      : null;
  const link = account?.links.length === 1 ? account.links[0] : null;
  if (!activation && (!account || account.status !== "ACTIVE" || !link)) {
    await prisma.patientPortalAuditEvent.create({
      data: { event: "PORTAL_LOGIN_FAILED" },
    });
    throw new PatientPortalError(
      400,
      "The verification code is invalid or expired.",
    );
  }
  // Failures return null within transaction, so attempt increments COMMIT.
  const token = await prisma.$transaction(
    async (db) => {
      await lockPortalPatient(db, activation?.patientId ?? link!.patientId);
      const now = new Date();
      const a = input.token
        ? await loadPortalActivation(input.token, db, now)
        : null;
      let currentLink = link
        ? await db.patientPortalLink.findFirst({
            where: {
              id: link.id,
              revokedAt: null,
              portalAccount: { status: "ACTIVE" },
            },
          })
        : null;
      if (!a && !currentLink) return null;
      try {
        await requirePatientPortalEntitlement(
          a?.tenantId ?? currentLink!.tenantId,
          db,
        );
      } catch (error) {
        if (!a && error instanceof PatientPortalError) return null;
        throw error;
      }
      const challenge = await db.patientPortalChallenge.findFirst({
        where: a
          ? {
              activationId: a.id,
              purpose: "ACTIVATION",
              mobileE164: a.mobileE164,
            }
          : {
              portalAccountId: account!.id,
              purpose: "LOGIN",
              mobileE164: account!.mobileE164,
            },
        orderBy: { createdAt: "desc" },
      });
      if (!challenge || !portalChallengeLive(challenge, now)) return null;
      await db.patientPortalChallenge.update({
        where: { id: challenge.id },
        data: { attemptCount: { increment: 1 } },
      });
      if (
        !portalCodeMatches(
          challenge.id,
          input.code,
          challenge.codeDigest,
          pepper,
        )
      )
        return null;
      await db.patientPortalChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: now },
      });
      let accountId = account?.id;
      if (a) {
        const existing = await db.patientPortalAccount.findUnique({
          where: { mobileE164: a.mobileE164 },
          include: { links: true },
        });
        if (
          existing?.links.some(
            (l) =>
              l.patientId !== a.patientId ||
              l.tenantId !== a.tenantId ||
              !l.revokedAt,
          ) ||
          (await db.patientPortalLink.findUnique({
            where: { activePatientId: a.patientId },
          }))
        )
          throw new PatientPortalError(
            409,
            "Activation could not be completed. Please contact your clinic.",
          );
        const created = existing
          ? await db.patientPortalAccount.update({
              where: { id: existing.id },
              data: { status: "ACTIVE", verifiedAt: now },
            })
          : await db.patientPortalAccount.create({
              data: { mobileE164: a.mobileE164, verifiedAt: now },
            });
        accountId = created.id;
        currentLink = await db.patientPortalLink.create({
          data: {
            portalAccountId: accountId,
            patientId: a.patientId,
            tenantId: a.tenantId,
            activePatientId: a.patientId,
            activeAccountId: accountId,
            verifiedAt: now,
            identityVerifiedByUserId: a.createdByUserId,
            identityVerifiedAt: a.identityVerifiedAt,
          },
        });
        await db.patientPortalActivation.update({
          where: { id: a.id },
          data: { consumedAt: now, activePatientId: null },
        });
      }
      const sessionToken = await createPatientPortalSession(
        db,
        accountId!,
        currentLink!.id,
        meta,
        now,
      );
      await db.patientPortalAuditEvent.create({
        data: {
          portalAccountId: accountId,
          tenantId: currentLink!.tenantId,
          event: a ? "PORTAL_ACTIVATED" : "PORTAL_LOGIN_SUCCESS",
        },
      });
      return sessionToken;
    },
    { isolationLevel: "ReadCommitted" },
  );
  if (!token) {
    await prisma.patientPortalAuditEvent.create({
      data: { portalAccountId: account?.id, event: "PORTAL_LOGIN_FAILED" },
    });
    throw new PatientPortalError(
      400,
      "The verification code is invalid or expired.",
    );
  }
  return token;
}
