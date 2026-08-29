import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";
import { BadRequestError, ConflictError } from "@/lib/apiHandler";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";
import {
  sendInvitationEmail,
  type InvitationMailer,
} from "@/lib/invitationEmails";
import {
  INVITATION_TTL_MS,
  computeInvitationExpiry,
  describeInvitationRefusal,
  evaluateInvitation,
  isInvitationOutstanding,
  normaliseInviteEmail,
  type InvitationRefusal,
} from "@/lib/invitationPolicy";
import { activateInvitedMemberAccount } from "@/lib/platform/memberActivation";
import { prisma } from "@/lib/prisma";
import {
  assertClinicInTenant,
  requirePermission,
  ScopeError,
  toPermissionList,
  type ActorContext,
} from "@/lib/rbac";
import {
  RATE_LIMIT_POLICIES,
  createDatabaseRateLimiter,
  type RateLimiter,
} from "@/lib/rateLimit";
import { assertRoleGrantableBy } from "@/lib/roles";
import {
  MAX_EMAIL_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "@/lib/signupInput";
import { hashToken } from "@/lib/verification";

/**
 * Team invitations — Stage 6.
 *
 * The lifecycle in one place: an admin issues an invitation, a person accepts
 * it, and a login exists that did not exist before. Every rule that decides
 * whether that happens lives here or in the two pure modules it leans on
 * (lib/invitationPolicy.ts for the invitation's own state, lib/rbac.ts for the
 * inviter's authority).
 *
 * THE TOKEN. 32 random bytes, mailed once, stored only as a SHA-256 hash — the
 * same construction as email verification, and appropriate for the same reason:
 * the input already carries 256 bits of entropy, so there is nothing to salt
 * against. A database leak yields no usable invitation link. `hashToken` is
 * reused rather than reimplemented so there is one hashing rule to audit.
 *
 * WHAT AN INVITATION IS NOT. It is not authority. `Invitation.tenantId` decides
 * which organisation is being joined; the slug in any URL is cosmetic; and the
 * role it names is re-checked against the tenant at acceptance, so a role
 * deleted or moved between issue and acceptance cannot be spent.
 *
 * ONE LIVE INVITATION PER ADDRESS PER TENANT. Issuing a second one to the same
 * address revokes the first, which is what makes "resend" safe: there is never
 * more than one token that opens the same door, so revoking the invitation in
 * the list revokes the only live link.
 */

type PrismaClientOrTransaction = PrismaClient | Prisma.TransactionClient;

const TOKEN_BYTES = 32;

const INVITE = "team:invite";
const VIEW = "team:view";

/** For the mail copy. Derived, so it cannot drift from the policy constant. */
export const INVITATION_TTL_DAYS = Math.round(
  INVITATION_TTL_MS / (24 * 60 * 60 * 1000),
);

/**
 * Injected, so the verification script and tests substitute a capture function
 * and no real mail is ever sent — the arrangement Stage 4 uses for login codes.
 */
export interface InvitationDeps {
  mailer?: InvitationMailer;
  limiter?: RateLimiter;
  now?: Date;
  /** Client metadata for the audit trail. Never used for a decision. */
  ip?: string | null;
  userAgent?: string | null;
}

function resolveDeps(deps: InvitationDeps = {}) {
  return {
    mailer: deps.mailer ?? sendInvitationEmail,
    limiter: deps.limiter ?? createDatabaseRateLimiter(prisma),
    now: deps.now ?? new Date(),
    ip: deps.ip ?? null,
    userAgent: deps.userAgent ?? null,
  };
}

/**
 * The accept page, not an API route: following the link must never complete
 * anything on its own. NEXTAUTH_URL is the deployment's public origin and is
 * already required for Auth.js callbacks, so no new environment variable.
 */
export function buildInvitationUrl(token: string): string {
  const origin = process.env.NEXTAUTH_URL?.trim().replace(/\/$/, "");
  if (!origin) {
    throw new Error("NEXTAUTH_URL is not set — cannot build an invitation link.");
  }
  return `${origin}/invite?token=${encodeURIComponent(token)}`;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const createInvitationSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Enter the person's email address.")
    .max(MAX_EMAIL_LENGTH)
    .pipe(z.email("Enter a valid email address."))
    .transform(normaliseInviteEmail),
  roleId: z.string().trim().min(1, "Choose a role.").max(64),
  /** Omitted or empty = the whole account, mirroring UserRole.clinicId. */
  clinicId: z.string().trim().max(64).optional(),
});

export const revokeInvitationSchema = z.object({
  invitationId: z.string().trim().min(1).max(64),
});

export const acceptInvitationSchema = z.object({
  token: z.string().trim().min(1).max(200),
  name: z
    .string()
    .trim()
    .min(1, "Enter your name.")
    .max(MAX_NAME_LENGTH),
  password: z
    .string()
    .min(
      MIN_PASSWORD_LENGTH,
      `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
    )
    .max(MAX_PASSWORD_LENGTH),
});

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface InvitationSummary {
  id: string;
  email: string;
  roleName: string;
  clinicName: string | null;
  invitedByName: string | null;
  createdAt: string;
  expiresAt: string;
  /** CREATED / OPENED, and not yet past its expiry. */
  isOutstanding: boolean;
  /** What the list shows: the stored status, corrected for the clock. */
  displayStatus: "Pending" | "Opened" | "Expired" | "Revoked" | "Accepted";
}

function describeStatus(
  status: string,
  expiresAt: Date,
  now: Date,
): InvitationSummary["displayStatus"] {
  if (status === "ACCEPTED") return "Accepted";
  if (status === "REVOKED") return "Revoked";
  if (status === "EXPIRED" || expiresAt.getTime() <= now.getTime()) return "Expired";
  return status === "OPENED" ? "Opened" : "Pending";
}

/**
 * Invitations for the team screen. Accepted ones are excluded: once spent, the
 * person is a member and belongs in the members list, not in a list of pending
 * paperwork.
 */
export async function listInvitations(
  actor: ActorContext,
  now: Date = new Date(),
): Promise<InvitationSummary[]> {
  await requirePermission(actor, VIEW);

  const rows = await prisma.invitation.findMany({
    where: { tenantId: actor.tenantId, status: { not: "ACCEPTED" } },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      email: true,
      createdAt: true,
      expiresAt: true,
      status: true,
      role: { select: { name: true } },
      clinic: { select: { name: true } },
      invitedBy: { select: { name: true, email: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    // Stage 6 never issues an invitation without an address; a legacy row
    // without one renders as a blank rather than as "null".
    email: row.email ?? "",
    roleName: row.role.name,
    clinicName: row.clinic?.name ?? null,
    invitedByName: row.invitedBy?.name ?? row.invitedBy?.email ?? null,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    isOutstanding: isInvitationOutstanding(
      { status: row.status, expiresAt: row.expiresAt },
      now,
    ),
    displayStatus: describeStatus(row.status, row.expiresAt, now),
  }));
}

export interface InvitationPreview {
  businessName: string;
  email: string;
  roleName: string;
  clinicName: string | null;
  invitedByName: string | null;
  expiresAt: string;
}

export type InvitationPreviewResult =
  | { status: "ok"; preview: InvitationPreview }
  | { status: "refused"; refusal: InvitationRefusal; message: string };

/**
 * Resolves a raw token for the public accept page.
 *
 * MARKS THE INVITATION OPENED, guarded on `status: "CREATED"` so it is
 * idempotent and writes at most once. `openedAt` therefore means "the link was
 * fetched", which includes a mail scanner or a link preview fetching it on the
 * recipient's behalf — it is a display pointer, not evidence that a person saw
 * the page, and nothing branches on it.
 *
 * Never throws for a bad token: the page renders the refusal.
 */
export async function loadInvitationPreview(
  token: string,
  now: Date = new Date(),
): Promise<InvitationPreviewResult> {
  const tokenHash = hashToken(token);

  const row = await prisma.invitation.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      email: true,
      status: true,
      expiresAt: true,
      role: { select: { name: true } },
      clinic: { select: { name: true } },
      invitedBy: { select: { name: true, email: true } },
      tenant: { select: { businessName: true, status: true, isPlatform: true } },
    },
  });

  const verdict = evaluateInvitation({
    snapshot: row
      ? {
          status: row.status,
          expiresAt: row.expiresAt,
          email: row.email,
          isTenantActive: row.tenant.status === "ACTIVE" && !row.tenant.isPlatform,
        }
      : null,
    now,
  });

  if (!verdict.usable || !row?.email) {
    const refusal = verdict.refusal ?? "not-found";
    return { status: "refused", refusal, message: describeInvitationRefusal(refusal) };
  }

  await prisma.invitation.updateMany({
    where: { id: row.id, status: "CREATED" },
    data: { status: "OPENED", openedAt: now },
  });

  return {
    status: "ok",
    preview: {
      businessName: row.tenant.businessName,
      email: row.email,
      roleName: row.role.name,
      clinicName: row.clinic?.name ?? null,
      invitedByName: row.invitedBy?.name ?? row.invitedBy?.email ?? null,
      expiresAt: row.expiresAt.toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Confirms a role belongs to the actor's account and may be handed out. */
async function loadGrantableRole(
  actor: ActorContext,
  roleId: string,
  clinicId: string | null,
): Promise<{ id: string; name: string }> {
  const role = await prisma.role.findFirst({
    where: { id: roleId, tenantId: actor.tenantId },
    select: { id: true, name: true, permissions: true },
  });

  if (!role) {
    // 404, not 403 — another account's role id must not be confirmable.
    throw new ScopeError();
  }

  // The same rule that governs assigning a role directly: an invitation is a
  // deferred assignment, so it cannot hand out reach the inviter lacks.
  await assertRoleGrantableBy(
    actor,
    [...toPermissionList(role.permissions)],
    clinicId,
  );

  return { id: role.id, name: role.name };
}

export interface CreatedInvitation {
  id: string;
  email: string;
  /** True when this invitation replaced an outstanding one for the address. */
  supersededPrevious: boolean;
}

/**
 * Issues an invitation and mails the link — FR-8.2's assignment step, moved to
 * the point where the person does not have a login yet.
 */
export async function createInvitation(
  actor: ActorContext,
  input: CreateInvitationInput,
  deps: InvitationDeps = {},
): Promise<CreatedInvitation> {
  const { mailer, limiter, now, ip, userAgent } = resolveDeps(deps);

  const clinicId = input.clinicId === "" ? undefined : input.clinicId;
  if (clinicId) {
    await assertClinicInTenant(actor.tenantId, clinicId);
    await requirePermission(actor, INVITE, clinicId);
  } else {
    await requirePermission(actor, INVITE);
  }

  const role = await loadGrantableRole(actor, input.roleId, clinicId ?? null);

  // Checked AFTER authorisation, so an unauthorised caller cannot consume
  // another tenant's allowance, and BEFORE the write, so a refused request
  // leaves no row behind.
  await limiter.assertAllowed({
    policy: RATE_LIMIT_POLICIES.inviteByTenant,
    subject: actor.tenantId,
    now,
  });
  await limiter.assertAllowed({
    policy: RATE_LIMIT_POLICIES.inviteByEmail,
    subject: input.email,
    now,
  });

  // `users.email` is globally unique, and one user belongs to exactly one
  // tenant (see the limitation note in lib/accessStatus.ts). So an address that
  // exists anywhere cannot be invited anywhere, and saying so plainly is the
  // only actionable answer — the same tradeoff signup already makes.
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { tenantId: true },
  });

  if (existing) {
    throw new ConflictError(
      existing.tenantId === actor.tenantId
        ? "That person is already on your team."
        : "That email address already has a MEDCARE PRO account. Ask them to use a different address.",
    );
  }

  const token = randomBytes(TOKEN_BYTES).toString("hex");
  const expiresAt = computeInvitationExpiry(now);

  const { invitationId, supersededPrevious } = await prisma.$transaction(
    async (tx) => {
      // One live token per address per tenant. Anything still outstanding is
      // revoked first, so "resend" cannot leave two working links behind.
      const superseded = await tx.invitation.updateMany({
        where: {
          tenantId: actor.tenantId,
          email: input.email,
          status: { in: ["CREATED", "OPENED"] },
        },
        data: {
          status: "REVOKED",
          revokedAt: now,
          revokedById: actor.userId,
        },
      });

      const invitation = await tx.invitation.create({
        data: {
          // From the session, never from the request body.
          tenantId: actor.tenantId,
          clinicId: clinicId ?? null,
          email: input.email,
          roleId: role.id,
          tokenHash: hashToken(token),
          expiresAt,
          invitedById: actor.userId,
        },
        select: { id: true },
      });

      if (superseded.count > 0) {
        await writeAuditLog(tx, {
          action: AUDIT_ACTIONS.TEAM_INVITATION_SUPERSEDED,
          targetType: "Invitation",
          targetId: invitation.id,
          actorUserId: actor.userId,
          actorTenantId: actor.tenantId,
          afterValue: { replaced: superseded.count },
          ip,
          userAgent,
        });
      }

      await writeAuditLog(tx, {
        action: AUDIT_ACTIONS.TEAM_INVITATION_CREATED,
        targetType: "Invitation",
        targetId: invitation.id,
        actorUserId: actor.userId,
        actorTenantId: actor.tenantId,
        // The address is the point of the record. The token and its hash are
        // not here, and assertSafeAuditMetadata would refuse them anyway.
        afterValue: {
          email: input.email,
          roleName: role.name,
          scope: clinicId ? "clinic" : "account-wide",
          expiresAt: expiresAt.toISOString(),
        },
        ip,
        userAgent,
      });

      return {
        invitationId: invitation.id,
        supersededPrevious: superseded.count > 0,
      };
    },
  );

  const tenant = await prisma.tenant.findUnique({
    where: { id: actor.tenantId },
    select: { businessName: true },
  });
  const inviter = await prisma.user.findUnique({
    where: { id: actor.userId },
    select: { name: true },
  });
  const clinic = clinicId
    ? await prisma.clinic.findUnique({
        where: { id: clinicId },
        select: { name: true },
      })
    : null;

  // Sent only after the transaction commits — mailing a link to a token a
  // rollback erased would send the recipient to a dead page.
  try {
    await mailer({
      to: input.email,
      businessName: tenant?.businessName ?? "your clinic",
      roleName: role.name,
      clinicName: clinic?.name ?? null,
      invitedByName: inviter?.name ?? null,
      invitationUrl: buildInvitationUrl(token),
      expiresInDays: INVITATION_TTL_DAYS,
    });
  } catch (error: unknown) {
    // The row survives on purpose: it is inert without the link, it shows in
    // the list as outstanding, and re-inviting the same address supersedes it.
    // Never report success when nothing went out.
    console.error(`Invitation email failed for ${input.email}`, error);
    throw new BadRequestError(
      "The invitation could not be emailed. Check the address and send it again.",
    );
  }

  return { id: invitationId, email: input.email, supersededPrevious };
}

/** Withdraws an outstanding invitation. Terminal — a new one gets a new token. */
export async function revokeInvitation(
  actor: ActorContext,
  input: { invitationId: string },
  deps: InvitationDeps = {},
): Promise<{ revoked: true }> {
  const { now, ip, userAgent } = resolveDeps(deps);

  await requirePermission(actor, INVITE);

  const invitation = await prisma.invitation.findFirst({
    where: { id: input.invitationId, tenantId: actor.tenantId },
    select: { id: true, status: true, email: true },
  });

  if (!invitation) {
    throw new ScopeError();
  }

  if (invitation.status === "ACCEPTED") {
    throw new ConflictError(
      "That invitation has already been accepted. Remove the person from the team instead.",
    );
  }

  await prisma.$transaction(async (tx) => {
    // Guarded rather than blind, so a second revoke does not overwrite who
    // revoked it first. A no-op still returns success: the caller asked for the
    // invitation to be dead, and it is.
    await tx.invitation.updateMany({
      where: { id: invitation.id, status: { in: ["CREATED", "OPENED", "EXPIRED"] } },
      data: { status: "REVOKED", revokedAt: now, revokedById: actor.userId },
    });

    await writeAuditLog(tx, {
      action: AUDIT_ACTIONS.TEAM_INVITATION_REVOKED,
      targetType: "Invitation",
      targetId: invitation.id,
      actorUserId: actor.userId,
      actorTenantId: actor.tenantId,
      beforeValue: { status: invitation.status },
      afterValue: { status: "REVOKED", email: invitation.email },
      ip,
      userAgent,
    });
  });

  return { revoked: true };
}

const BCRYPT_ROUNDS = 12;

export interface AcceptedInvitation {
  email: string;
  businessName: string;
}

/**
 * Spends an invitation: creates the login, opens it, and grants the role.
 *
 * PUBLIC AND UNAUTHENTICATED. The token is the only credential, so every
 * refusal returns the same sentence unless the invitation was already spent —
 * see the note in lib/invitationPolicy.ts.
 *
 * WHY THE NEW USER IS EMAIL-VERIFIED WITHOUT A SECOND ROUND TRIP. The schema
 * note on `User.emailVerifiedAt` says an invited member is never treated as
 * verified without their own confirmation. This IS their own confirmation: the
 * token existed only inside a message sent to that address, and presenting it
 * proves control of the inbox at least as well as clicking a verification link
 * would. Mailing a second link to the same address to prove the same fact would
 * be ceremony, not security.
 *
 * ONE TRANSACTION. The user, the platform activation, the role grant and the
 * invitation's own state change commit together. A partial acceptance would
 * leave either a login nobody can use or an invitation spent for nothing.
 */
export async function acceptInvitation(
  input: AcceptInvitationInput,
  deps: InvitationDeps = {},
): Promise<AcceptedInvitation> {
  const { limiter, now, ip, userAgent } = resolveDeps(deps);

  // Keyed on the caller, not on the token: throttling by token would tell an
  // attacker which tokens exist by how quickly they are refused.
  await limiter.assertAllowed({
    policy: RATE_LIMIT_POLICIES.acceptInvitationByIp,
    subject: ip ?? "unknown",
    now,
  });

  const tokenHash = hashToken(input.token);

  // Hashed before the transaction opens: bcrypt at 12 rounds is a few hundred
  // milliseconds of pure CPU and touches no rows, so holding a connection for
  // it would be waste. Done even for a token that turns out to be invalid, so
  // the two paths cost the same.
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  return prisma.$transaction(async (tx) => {
    const invitation = await tx.invitation.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        tenantId: true,
        clinicId: true,
        email: true,
        roleId: true,
        status: true,
        expiresAt: true,
        invitedById: true,
        role: { select: { id: true, tenantId: true, name: true } },
        tenant: {
          select: { id: true, businessName: true, status: true, isPlatform: true },
        },
      },
    });

    const verdict = evaluateInvitation({
      snapshot: invitation
        ? {
            status: invitation.status,
            expiresAt: invitation.expiresAt,
            email: invitation.email,
            isTenantActive:
              invitation.tenant.status === "ACTIVE" && !invitation.tenant.isPlatform,
          }
        : null,
      now,
    });

    if (!verdict.usable || !invitation?.email) {
      throw new BadRequestError(
        describeInvitationRefusal(verdict.refusal ?? "not-found"),
      );
    }

    // The role is re-checked against the tenant at acceptance, not trusted from
    // issue time: a role moved or removed in between must not be spendable.
    if (invitation.role.tenantId !== invitation.tenantId) {
      throw new BadRequestError(
        describeInvitationRefusal("not-found"),
      );
    }

    // Between issue and acceptance the address may have been registered
    // elsewhere. The unique index would refuse the insert anyway; catching it
    // here turns a 500 into a sentence the person can act on.
    const taken = await tx.user.findUnique({
      where: { email: invitation.email },
      select: { id: true },
    });
    if (taken) {
      throw new ConflictError(
        "That email address already has a MEDCARE PRO account. Sign in instead.",
      );
    }

    const user = await tx.user.create({
      data: {
        tenantId: invitation.tenantId,
        name: input.name,
        email: invitation.email,
        passwordHash,
        // Presenting the token proves control of this inbox — see above.
        emailVerifiedAt: now,
        // accountStatus stays at its PENDING default here and is opened below
        // by platform code. membershipStatus is the tenant's to set, and the
        // invitation IS the tenant's decision, so it goes straight to ACTIVE.
        membershipStatus: "ACTIVE",
      },
      select: { id: true },
    });

    // The one sanctioned path from PENDING to ACTIVE on the platform axis. It
    // refuses anything but PENDING, so this can never lift a suspension.
    await activateInvitedMemberAccount(tx, {
      userId: user.id,
      tenantId: invitation.tenantId,
      invitationId: invitation.id,
      invitedById: invitation.invitedById,
      now,
    });

    await tx.userRole.create({
      data: {
        userId: user.id,
        roleId: invitation.roleId,
        // Null = account-wide, exactly as the invitation was issued.
        clinicId: invitation.clinicId,
        assignedById: invitation.invitedById,
      },
    });

    await tx.invitation.update({
      where: { id: invitation.id },
      data: { status: "ACCEPTED", acceptedAt: now, acceptedByUserId: user.id },
    });

    await writeAuditLog(tx, {
      action: AUDIT_ACTIONS.TEAM_INVITATION_ACCEPTED,
      targetType: "Invitation",
      targetId: invitation.id,
      // The accepting user is the actor: they took this action themselves.
      actorUserId: user.id,
      actorTenantId: invitation.tenantId,
      beforeValue: { status: invitation.status },
      afterValue: {
        status: "ACCEPTED",
        userId: user.id,
        roleName: invitation.role.name,
        scope: invitation.clinicId ? "clinic" : "account-wide",
      },
      ip,
      userAgent,
    });

    return {
      email: invitation.email,
      businessName: invitation.tenant.businessName,
    };
  });
}

/**
 * Exported for the verification script, which needs to know what a token hashes
 * to in order to prove that the raw token is nowhere in the database.
 */
export function hashInvitationToken(token: string): string {
  return hashToken(token);
}

/** Exported for the same reason: the script asserts on stored rows directly. */
export type { PrismaClientOrTransaction };
