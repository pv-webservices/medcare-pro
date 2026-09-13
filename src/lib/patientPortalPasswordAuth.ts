import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Prisma, PatientPortalTokenPurpose } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createDatabaseRateLimiter } from "@/lib/rateLimit";
import {
  lockPortalPatient,
  lockPortalAccount,
  loadPortalActivation,
} from "@/lib/patientPortalActivation";
import {
  createPatientPortalSession,
  type PatientActorContext,
} from "@/lib/patientPortalSession";
import { requirePatientPortalEntitlement } from "@/lib/patientPortalFeature";
import {
  sendPatientPortalSecurityEmail,
  type PortalMailer,
} from "@/lib/patientPortalEmails";
import {
  portalPasswordSchema,
  portalEmailSchema,
  portalToken,
  hashPortalToken,
  portalRecordLive,
  portalOrigin,
  PatientPortalError,
  RESET_TTL,
  EMAIL_VERIFICATION_TTL,
} from "@/lib/patientPortalSecurity";
// Domain-separated SHA-256 prehash avoids bcrypt's 72-byte truncation for long
// passphrases. All patient password creation and comparison use this encoding.
export const portalPasswordInput = (password: string) =>
  createHash("sha256")
    .update("medcare-patient-password:v1:")
    .update(password)
    .digest("base64");
export const hashPatientPassword = (password: string) =>
  bcrypt.hash(portalPasswordInput(portalPasswordSchema.parse(password)), 12);
export const comparePatientPassword = (password: string, hash: string) =>
  bcrypt.compare(portalPasswordInput(password), hash);
export const DUMMY_PATIENT_HASH =
  "$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW";
const invalidLogin = () =>
  new PatientPortalError(400, "Invalid sign-in details.");
type Identity = { organization: string; patientCode: string };
type Meta = { ip?: string | null; userAgent?: string | null };
export async function portalAuthRateLimit(
  ip: string | null,
  subject: string,
  action = "login",
  cooldown = false,
) {
  const limiter = createDatabaseRateLimiter(prisma);
  for (const [dimension, value, maxCount] of [
    ["ip", ip ?? "unknown", 50],
    ["subject", hashPortalToken(subject), action === "login" ? 15 : 5],
  ] as const)
    await limiter.assertAllowed({
      policy: {
        name: `patient-portal:${action}:${dimension}`,
        windowMs: 3600000,
        blockMs: 3600000,
        maxCount,
      },
      subject: value,
    });
  if (cooldown)
    await limiter.assertAllowed({
      policy: {
        name: `patient-portal:${action}:cooldown`,
        windowMs: 60000,
        blockMs: 60000,
        maxCount: 1,
      },
      subject: hashPortalToken(subject),
    });
}
export async function resolvePortalIdentity(
  input: Identity,
  db: Prisma.TransactionClient = prisma,
) {
  return db.patientPortalLink.findFirst({
    where: {
      revokedAt: null,
      accessType: "SELF",
      activePatientId: { not: null },
      activeAccountId: { not: null },
      patient: {
        patientCode: input.patientCode,
        tenant: { slug: input.organization },
      },
      portalAccount: { status: "ACTIVE", passwordHash: { not: null } },
    },
    include: { portalAccount: true, patient: true },
  });
}
export async function loginPatientPortal(
  input: Identity & { password: string },
  meta: Meta = {},
) {
  const link = await resolvePortalIdentity(input);
  const valid = await comparePatientPassword(
    input.password,
    link?.portalAccount.passwordHash ?? DUMMY_PATIENT_HASH,
  );
  let session: string | null = null;
  if (link && valid)
    session = await prisma.$transaction(
      async (db) => {
        await lockPortalPatient(db, link.patientId);
        await lockPortalAccount(db, link.portalAccountId);
        const fresh = await resolvePortalIdentity(input, db);
        if (
          !fresh ||
          fresh.id !== link.id ||
          fresh.portalAccount.passwordHash !==
            link.portalAccount.passwordHash ||
          fresh.tenantId !== fresh.patient.tenantId ||
          fresh.activePatientId !== fresh.patientId ||
          fresh.activeAccountId !== fresh.portalAccountId
        )
          return null;
        try {
          await requirePatientPortalEntitlement(fresh.tenantId, db);
        } catch (e) {
          if (e instanceof PatientPortalError) return null;
          throw e;
        }
        const token = await createPatientPortalSession(
          db,
          fresh.portalAccountId,
          fresh.id,
          meta,
          new Date(),
        );
        await db.patientPortalAuditEvent.create({
          data: {
            portalAccountId: fresh.portalAccountId,
            tenantId: fresh.tenantId,
            event: "PORTAL_LOGIN_SUCCESS",
          },
        });
        return token;
      },
      { isolationLevel: "ReadCommitted" },
    );
  if (!session) {
    await prisma.patientPortalAuditEvent.create({
      data: { event: "PORTAL_LOGIN_FAILED" },
    });
    throw invalidLogin();
  }
  return session;
}
async function issueSecurityToken(
  db: Prisma.TransactionClient,
  accountId: string,
  email: string,
  purpose: PatientPortalTokenPurpose,
  now = new Date(),
) {
  await db.patientPortalSecurityToken.updateMany({
    where: {
      portalAccountId: accountId,
      purpose,
      consumedAt: null,
      revokedAt: null,
    },
    data: { revokedAt: now },
  });
  const raw = portalToken();
  const row = await db.patientPortalSecurityToken.create({
    data: {
      portalAccountId: accountId,
      emailSnapshot: email,
      purpose,
      tokenHash: hashPortalToken(raw),
      expiresAt: new Date(
        now.getTime() +
          (purpose === "PASSWORD_RESET" ? RESET_TTL : EMAIL_VERIFICATION_TTL),
      ),
    },
  });
  return {
    id: row.id,
    to: email,
    purpose,
    url: `${portalOrigin()}/patient/${purpose === "PASSWORD_RESET" ? "reset-password" : "verify-email"}?token=${raw}`,
  };
}
async function deliverSecurityMail(
  mail: Awaited<ReturnType<typeof issueSecurityToken>>,
  mailer: PortalMailer,
) {
  try {
    await mailer(mail);
    return true;
  } catch {
    await prisma.patientPortalSecurityToken.updateMany({
      where: { id: mail.id, consumedAt: null },
      data: { revokedAt: new Date() },
    });
    return false;
  }
}
export async function activatePatientPortal(
  input: { token: string; password: string; email?: string },
  meta: Meta = {},
  mailer: PortalMailer = sendPatientPortalSecurityEmail,
) {
  const activation = await loadPortalActivation(input.token);
  const hash = await hashPatientPassword(input.password);
  const email = input.email ? portalEmailSchema.parse(input.email) : null;
  const result = await prisma.$transaction(
    async (db) => {
      await lockPortalPatient(db, activation.patientId);
      const a = await loadPortalActivation(input.token, db);
      const historical = await db.patientPortalLink.findFirst({
        where: { patientId: a.patientId, tenantId: a.tenantId },
        orderBy: { createdAt: "desc" },
        include: { portalAccount: { include: { links: true } } },
      });
      const existing = historical?.portalAccount;
      if (existing) await lockPortalAccount(db, existing.id);
      if (
        existing?.links.some(
          (l) => l.patientId !== a.patientId || l.tenantId !== a.tenantId,
        ) ||
        (await db.patientPortalLink.findUnique({
          where: { activePatientId: a.patientId },
        }))
      )
        throw new PatientPortalError(
          409,
          "Activation could not be completed. Please contact your clinic.",
        );
      const now = new Date();
      const data = {
        status: "ACTIVE" as const,
        verifiedAt: now,
        passwordHash: hash,
        passwordSetAt: now,
        pendingRecoveryEmail: email,
      };
      const account = existing
        ? await db.patientPortalAccount.update({
            where: { id: existing.id },
            data,
          })
        : await db.patientPortalAccount.create({ data });
      await db.patientPortalSession.updateMany({
        where: { portalAccountId: account.id, revokedAt: null },
        data: { revokedAt: now },
      });
      await db.patientPortalSecurityToken.updateMany({
        where: {
          portalAccountId: account.id,
          consumedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: now },
      });
      const link = await db.patientPortalLink.create({
        data: {
          portalAccountId: account.id,
          patientId: a.patientId,
          tenantId: a.tenantId,
          activePatientId: a.patientId,
          activeAccountId: account.id,
          verifiedAt: now,
          identityVerifiedByUserId: a.createdByUserId,
          identityVerifiedAt: a.identityVerifiedAt,
        },
      });
      await db.patientPortalActivation.update({
        where: { id: a.id },
        data: { consumedAt: now, activePatientId: null },
      });
      const sessionToken = await createPatientPortalSession(
        db,
        account.id,
        link.id,
        meta,
        now,
      );
      await db.patientPortalAuditEvent.create({
        data: {
          portalAccountId: account.id,
          tenantId: a.tenantId,
          event: "PORTAL_ACTIVATED",
        },
      });
      const mail = email
        ? await issueSecurityToken(
            db,
            account.id,
            email,
            "VERIFY_RECOVERY_EMAIL",
            now,
          )
        : null;
      if (mail)
        await db.patientPortalAuditEvent.create({
          data: {
            portalAccountId: account.id,
            event: "PORTAL_RECOVERY_EMAIL_REQUESTED",
          },
        });
      return { sessionToken, mail };
    },
    { isolationLevel: "ReadCommitted" },
  );
  const sent = result.mail
    ? await deliverSecurityMail(result.mail, mailer)
    : true;
  return {
    sessionToken: result.sessionToken,
    message: sent
      ? "Portal activated."
      : "Portal activated, but we couldn't send the recovery-email verification. You can resend it from Profile.",
  };
}
export async function resolveSecurityTokenTenant(
  raw: string,
  purpose: PatientPortalTokenPurpose,
  db: Prisma.TransactionClient = prisma,
): Promise<{ slug: string; businessName: string } | null> {
  if (!/^[\w-]{43}$/.test(raw)) return null;
  const token = await db.patientPortalSecurityToken.findUnique({
    where: { tokenHash: hashPortalToken(raw) },
    include: {
      portalAccount: {
        include: {
          links: {
            where: { accessType: "SELF" },
            orderBy: { createdAt: "desc" },
            include: {
              patient: {
                include: {
                  tenant: { select: { slug: true, businessName: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (
    !token ||
    token.purpose !== purpose ||
    !portalRecordLive(token, new Date())
  )
    return null;
  const link =
    token.portalAccount.links.find(
      (l) => !l.revokedAt && l.activePatientId === l.patientId,
    ) ?? token.portalAccount.links[0];
  if (!link?.patient?.tenant?.slug) return null;
  return {
    slug: link.patient.tenant.slug,
    businessName: link.patient.tenant.businessName,
  };
}
async function activeSecurityAccount(db: Prisma.TransactionClient, id: string) {
  const account = await db.patientPortalAccount.findUnique({
    where: { id },
    include: {
      links: {
        where: { revokedAt: null, accessType: "SELF" },
        include: {
          patient: {
            include: {
              tenant: { select: { id: true, slug: true, businessName: true } },
            },
          },
        },
      },
    },
  });
  const link = account?.links.length === 1 ? account.links[0] : null;
  if (
    !account ||
    account.status !== "ACTIVE" ||
    !account.passwordHash ||
    !link ||
    link.activePatientId !== link.patientId ||
    link.activeAccountId !== id
  )
    throw new PatientPortalError(
      400,
      "This security link is invalid or expired.",
    );
  await requirePatientPortalEntitlement(link.tenantId, db);
  return { account, link };
}
async function loadSecurityToken(
  db: Prisma.TransactionClient,
  raw: string,
  purpose: PatientPortalTokenPurpose,
) {
  if (!/^[\w-]{43}$/.test(raw))
    throw new PatientPortalError(
      400,
      "This security link is invalid or expired.",
    );
  const initial = await db.patientPortalSecurityToken.findUnique({
    where: { tokenHash: hashPortalToken(raw) },
  });
  if (!initial)
    throw new PatientPortalError(
      400,
      "This security link is invalid or expired.",
    );
  await lockPortalAccount(db, initial.portalAccountId);
  const token = await db.patientPortalSecurityToken.findUniqueOrThrow({
    where: { id: initial.id },
  });
  if (token.purpose !== purpose || !portalRecordLive(token, new Date()))
    throw new PatientPortalError(
      400,
      "This security link is invalid or expired.",
    );
  const { account, link } = await activeSecurityAccount(
    db,
    token.portalAccountId,
  );
  return { token, account, link };
}
export async function verifyPatientRecoveryEmail(raw: string) {
  try {
    return await prisma.$transaction(
      async (db) => {
        const { token, account, link } = await loadSecurityToken(
          db,
          raw,
          "VERIFY_RECOVERY_EMAIL",
        );
        if (account.pendingRecoveryEmail !== token.emailSnapshot)
          throw new PatientPortalError(
            400,
            "This security link is invalid or expired.",
          );
        const now = new Date();
        await db.patientPortalAccount.update({
          where: { id: account.id },
          data: {
            recoveryEmail: token.emailSnapshot,
            recoveryEmailVerifiedAt: now,
            pendingRecoveryEmail: null,
          },
        });
        await db.patientPortalSecurityToken.update({
          where: { id: token.id },
          data: { consumedAt: now },
        });
        await db.patientPortalSecurityToken.updateMany({
          where: {
            portalAccountId: account.id,
            consumedAt: null,
            revokedAt: null,
          },
          data: { revokedAt: now },
        });
        await db.patientPortalAuditEvent.create({
          data: {
            portalAccountId: account.id,
            tenantId: link.tenantId,
            event: account.recoveryEmail
              ? "PORTAL_RECOVERY_EMAIL_CHANGED"
              : "PORTAL_RECOVERY_EMAIL_VERIFIED",
          },
        });
        return { tenantSlug: link.patient.tenant.slug };
      },
      { isolationLevel: "ReadCommitted" },
    );
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "P2002")
      throw new PatientPortalError(
        400,
        "This email cannot be used as a recovery address.",
      );
    throw e;
  }
}
export async function requestPatientPasswordReset(
  input: Identity & { email: string },
  mailer: PortalMailer = sendPatientPortalSecurityEmail,
) {
  const link = await resolvePortalIdentity(input);
  if (!link) return;
  const mail = await prisma.$transaction(
    async (db) => {
      await lockPortalAccount(db, link.portalAccountId);
      const fresh = await resolvePortalIdentity(input, db);
      if (
        !fresh ||
        fresh.id !== link.id ||
        !fresh.portalAccount.recoveryEmailVerifiedAt ||
        fresh.portalAccount.recoveryEmail !== input.email
      )
        return null;
      try {
        await requirePatientPortalEntitlement(fresh.tenantId, db);
      } catch (e) {
        if (e instanceof PatientPortalError) return null;
        throw e;
      }
      const mail = await issueSecurityToken(
        db,
        fresh.portalAccountId,
        input.email,
        "PASSWORD_RESET",
      );
      await db.patientPortalAuditEvent.create({
        data: {
          portalAccountId: fresh.portalAccountId,
          event: "PORTAL_PASSWORD_RESET_REQUESTED",
        },
      });
      return mail;
    },
    { isolationLevel: "ReadCommitted" },
  );
  if (mail) await deliverSecurityMail(mail, mailer);
}
export async function resetPatientPassword(input: {
  token: string;
  password: string;
}) {
  const hash = await hashPatientPassword(input.password);
  try {
    return await prisma.$transaction(
      async (db) => {
        const { token, account, link } = await loadSecurityToken(
          db,
          input.token,
          "PASSWORD_RESET",
        );
        if (
          !account.recoveryEmailVerifiedAt ||
          account.recoveryEmail !== token.emailSnapshot
        )
          throw new PatientPortalError(
            400,
            "This security link is invalid or expired.",
          );
        const now = new Date();
        await db.patientPortalAccount.update({
          where: { id: account.id },
          data: {
            passwordHash: hash,
            passwordSetAt: now,
            pendingRecoveryEmail: null,
          },
        });
        await db.patientPortalSecurityToken.update({
          where: { id: token.id },
          data: { consumedAt: now },
        });
        // Also invalidate pending email changes authorized with the old credential.
        await db.patientPortalSecurityToken.updateMany({
          where: {
            portalAccountId: account.id,
            consumedAt: null,
            revokedAt: null,
          },
          data: { revokedAt: now },
        });
        await db.patientPortalSession.updateMany({
          where: { portalAccountId: account.id, revokedAt: null },
          data: { revokedAt: now },
        });
        await db.patientPortalAuditEvent.create({
          data: {
            portalAccountId: account.id,
            tenantId: link.tenantId,
            event: "PORTAL_PASSWORD_RESET_COMPLETED",
          },
        });
        return { tenantSlug: link.patient.tenant.slug };
      },
      { isolationLevel: "ReadCommitted" },
    );
  } catch (e) {
    await prisma.patientPortalAuditEvent.create({
      data: { event: "PORTAL_PASSWORD_RESET_FAILED" },
    });
    throw e;
  }
}
const maskEmail = (email: string | null) =>
  email ? `${email[0]}*****@${email.split("@")[1]}` : null;
export async function patientPortalSecurityProfile(actor: PatientActorContext) {
  const account = await prisma.patientPortalAccount.findUniqueOrThrow({
    where: { id: actor.portalAccountId },
  });
  return {
    recoveryEmail: maskEmail(account.recoveryEmail),
    verified: !!account.recoveryEmailVerifiedAt,
    pendingRecoveryEmail: maskEmail(account.pendingRecoveryEmail),
  };
}
export async function changePatientRecoveryEmail(
  actor: PatientActorContext,
  input: { password: string; email: string },
  mailer: PortalMailer = sendPatientPortalSecurityEmail,
) {
  const account = await prisma.patientPortalAccount.findUniqueOrThrow({
    where: { id: actor.portalAccountId },
  });
  if (
    !(await comparePatientPassword(
      input.password,
      account.passwordHash ?? DUMMY_PATIENT_HASH,
    ))
  )
    throw new PatientPortalError(400, "Check your current password.");
  const mail = await prisma.$transaction(
    async (db) => {
      await lockPortalAccount(db, account.id);
      const { account: fresh } = await activeSecurityAccount(db, account.id);
      await loadPatientActorFromSession(actor, db);
      if (fresh.passwordHash !== account.passwordHash)
        throw new PatientPortalError(401, "Please sign in again.");
      const email = portalEmailSchema.parse(input.email);
      await db.patientPortalAccount.update({
        where: { id: account.id },
        data: { pendingRecoveryEmail: email },
      });
      const mail = await issueSecurityToken(
        db,
        account.id,
        email,
        "VERIFY_RECOVERY_EMAIL",
      );
      await db.patientPortalAuditEvent.create({
        data: {
          portalAccountId: account.id,
          event: "PORTAL_RECOVERY_EMAIL_REQUESTED",
        },
      });
      return mail;
    },
    { isolationLevel: "ReadCommitted" },
  );
  if (!(await deliverSecurityMail(mail, mailer)))
    throw new PatientPortalError(
      503,
      "We couldn't send verification. You can resend it from Profile.",
    );
}
// Recheck DB authority inside the account lock without needing the raw cookie.
async function loadPatientActorFromSession(
  actor: PatientActorContext,
  db: Prisma.TransactionClient,
) {
  const session = await db.patientPortalSession.findFirst({
    where: {
      id: actor.sessionId,
      portalAccountId: actor.portalAccountId,
      linkId: actor.linkId,
    },
    include: { link: true },
  });
  if (
    !session ||
    !portalRecordLive(session, new Date()) ||
    session.link.revokedAt ||
    session.link.activeAccountId !== actor.portalAccountId ||
    session.link.activePatientId !== actor.patientId
  )
    throw new PatientPortalError(401, "Please sign in again.");
}
export async function resendPatientRecoveryEmail(
  actor: PatientActorContext,
  mailer: PortalMailer = sendPatientPortalSecurityEmail,
) {
  const mail = await prisma.$transaction(
    async (db) => {
      await lockPortalAccount(db, actor.portalAccountId);
      await loadPatientActorFromSession(actor, db);
      const { account } = await activeSecurityAccount(db, actor.portalAccountId);
      if (!account.pendingRecoveryEmail)
        throw new PatientPortalError(400, "No recovery email is pending.");
      const mail = await issueSecurityToken(
        db,
        account.id,
        account.pendingRecoveryEmail,
        "VERIFY_RECOVERY_EMAIL",
      );
      await db.patientPortalAuditEvent.create({
        data: {
          portalAccountId: account.id,
          event: "PORTAL_RECOVERY_EMAIL_REQUESTED",
        },
      });
      return mail;
    },
    { isolationLevel: "ReadCommitted" },
  );
  if (!(await deliverSecurityMail(mail, mailer)))
    throw new PatientPortalError(
      503,
      "We couldn't send verification. Please try again later.",
    );
}
