import bcrypt from "bcryptjs";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { revokeAllSessionsForUser } from "@/lib/appSession";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";
import {
  RATE_LIMIT_POLICIES,
  createDatabaseRateLimiter,
  type RateLimiter,
} from "@/lib/rateLimit";
import { MIN_PASSWORD_LENGTH } from "@/lib/signupInput";
import {
  clearVerificationTokens,
  consumeVerificationToken,
  hashToken,
  issueVerificationToken,
} from "@/lib/verification";
import { VERIFICATION_PURPOSES } from "@/lib/verificationPurpose";

/**
 * "Forgot password?" — the reset flow behind /forgot-password and
 * /reset-password.
 *
 * NOT IN THE PRD. §6.1 specifies FR-1.1 … FR-1.5 and stops at login; there is
 * no forgot-password requirement, no route for it, and no table. This module
 * exists because the flow was asked for directly, and it is built to sit inside
 * the machinery already here rather than beside it:
 *
 *   - The token is a `VerificationToken` row with purpose PASSWORD_RESET. That
 *     column is a plain String with a default, so a third value needs NO schema
 *     change and NO migration — and single use, hashing at rest, and expiry are
 *     already implemented once, in src/lib/verification.ts.
 *   - Eligibility reuses the same shape as the login-code flow: an account that
 *     may not log in may not reset its way in either.
 *   - Rate limiting reuses lib/rateLimit.ts with its own policies.
 *
 * WHAT A RESET LINK AUTHORISES. One password change for one address, once,
 * within 24 hours (verification.ts's TTL). It does NOT create a session: the
 * user lands on a form, chooses a password, and is then sent to /login to use
 * it. That is deliberate — a link that signed its holder in would make every
 * forwarded or link-previewed message a live credential, which is the same
 * reason lib/email.ts refuses to put a clickable link in a login-code mail.
 *
 * WHAT CHANGES WHEN A RESET SUCCEEDS. The hash is replaced AND every live
 * session for that user is revoked, in one transaction. Resetting a password is
 * what someone does when they believe the account is compromised; leaving the
 * attacker's existing session alive would make the reset theatre.
 *
 * ---------------------------------------------------------------------------
 * ENUMERATION: THIS ENDPOINT DELIBERATELY DISCLOSES.
 *
 * `requestPasswordReset` reports `unknown-account` for an address that is not
 * registered, and the page says so. That is a product decision, made alongside
 * the matching change to the password and login-code forms — see the note on
 * `discloseAccountExists` in src/lib/auth.ts, which explains the tradeoff once
 * and is the authority for all three.
 *
 * The mitigation here is the pre-lookup rate limit: `passwordResetByIp` caps a
 * sweep at 20 addresses per fifteen minutes per source, and
 * `passwordResetByEmail` caps mail sent to any one inbox at 3.
 *
 * ONLY "does an account exist" is disclosed. A registered address that is
 * unverified, pending, suspended or rejected gets the same neutral "check your
 * inbox" answer as an eligible one — the account's STATE is still nobody's
 * business but its owner's.
 * ---------------------------------------------------------------------------
 */

/** Matches the signup route. Rehashing at the same cost keeps hashes uniform. */
const BCRYPT_ROUNDS = 12;

/** Mirrors verification.ts's TOKEN_TTL_MS (24 hours), in minutes, for the copy. */
export const RESET_LINK_TTL_MINUTES = 24 * 60;

/**
 * The neutral answer, used for every registered address whatever its state.
 * Exported so the route, the page and the tests assert one string.
 */
export const RESET_REQUESTED_MESSAGE =
  "If that account can be reset, a link is on its way. Check your inbox.";

export const RESET_UNKNOWN_ACCOUNT_MESSAGE =
  "No account exists for that email address. Sign up to create one.";

export const RESET_LINK_INVALID_MESSAGE =
  "That reset link is no longer valid. Request a new one.";

export const RESET_COMPLETED_MESSAGE =
  "Your password has been changed. Sign in with it to continue.";

export const requestPasswordResetSchema = z.object({
  email: z.email().max(255),
});

export const confirmPasswordResetSchema = z.object({
  token: z.string().trim().min(1).max(255),
  password: z
    .string()
    .min(
      MIN_PASSWORD_LENGTH,
      `Passwords must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    )
    .max(200),
});

export interface PasswordResetMailer {
  (params: {
    to: string;
    resetUrl: string;
    expiresInMinutes: number;
  }): Promise<void>;
}

export interface PasswordResetDeps {
  prisma: PrismaClient;
  sendEmail: PasswordResetMailer;
  now?: Date;
  rateLimiter?: RateLimiter;
}

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export type RequestPasswordResetOutcome =
  | { outcome: "sent"; message: string }
  | { outcome: "unknown-account"; message: string };

export type ConfirmPasswordResetOutcome =
  | { outcome: "changed"; message: string }
  | { outcome: "invalid-link"; message: string };

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Builds the absolute link mailed to the user.
 *
 * Points at a PAGE, not at an API route — unlike buildVerificationUrl, whose
 * link is consumed by a GET handler. A reset token must not be spent by merely
 * opening a URL: mail scanners and link previewers fetch links, and a token
 * consumed by a scanner is a reset the user can never complete. The page reads
 * the token, shows a form, and the token is spent only by the POST that carries
 * a new password.
 */
export function buildPasswordResetUrl(token: string): string {
  const origin = process.env.NEXTAUTH_URL?.trim().replace(/\/$/, "");
  if (!origin) {
    throw new Error("NEXTAUTH_URL is not set — cannot build a password reset link.");
  }
  return `${origin}/reset-password?token=${encodeURIComponent(token)}`;
}

/**
 * May this account have a reset link at all?
 *
 * Mirrors evaluateLoginCodeEligibility's intent without importing it: the
 * platform tenant is excluded, because the Owner's password is not resettable
 * from an anonymous form.
 *
 * The `passwordHash` check is defensive only — `users.password_hash` is NOT NULL
 * in the schema today, so there is no such row to refuse. It mirrors the
 * identical guard in src/lib/auth.ts's authorize() and exists so that making the
 * column nullable later fails closed here rather than silently letting a
 * credential-less account be handed one.
 *
 * An account that is merely PENDING or SUSPENDED IS allowed to reset. Their
 * password is theirs; whether they may then log in is decided at login, where
 * it already is. Refusing here would only mean a suspended user cannot fix a
 * password before their suspension is lifted.
 */
function isResettable(user: {
  passwordHash: string | null;
  tenant: { isPlatform: boolean };
}): boolean {
  return Boolean(user.passwordHash) && !user.tenant.isPlatform;
}

/**
 * Issues a reset link, or reports that no such account exists.
 *
 * Never throws for a delivery failure the caller could interpret: a failed send
 * is logged and answered with the same neutral message as a successful one, on
 * the same reasoning as lib/loginCode.ts. RateLimitError DOES propagate — it is
 * a deliberate 429 and says nothing about the account.
 */
export async function requestPasswordReset(
  deps: PasswordResetDeps,
  input: { email: string } & RequestMeta,
): Promise<RequestPasswordResetOutcome> {
  const now = deps.now ?? new Date();
  const limiter = deps.rateLimiter ?? createDatabaseRateLimiter(deps.prisma);
  const email = normaliseEmail(input.email);

  // Throttle BEFORE the lookup, so the disclosure below cannot be harvested
  // faster than the per-IP policy allows. IP first, for the same reason as in
  // lib/loginCode.ts: it is the dimension that catches one attacker walking a
  // list of addresses, none of which trips the per-email limit on its own.
  try {
    await limiter.assertAllowed({
      policy: RATE_LIMIT_POLICIES.passwordResetByIp,
      subject: input.ip ?? "unknown",
      now,
    });
    await limiter.assertAllowed({
      policy: RATE_LIMIT_POLICIES.passwordResetByEmail,
      subject: email,
      now,
    });
  } catch (error: unknown) {
    await writeAuditLog(deps.prisma, {
      action: AUDIT_ACTIONS.PASSWORD_RESET_RATE_LIMITED,
      targetType: "User",
      // No targetId and no address — the row records that throttling happened,
      // not who was throttled.
      targetId: null,
      afterValue: { method: "password-reset", outcome: "rate-limited", phase: "request" },
      ip: input.ip,
      userAgent: input.userAgent,
    });
    throw error;
  }

  const user = await deps.prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      tenantId: true,
      passwordHash: true,
      tenant: { select: { isPlatform: true } },
    },
  });

  if (!user) {
    // The one disclosed branch. Not audited: a row per guessed address would
    // turn the append-only trail into the enumeration list the rate limit
    // exists to cap, and would let a stranger grow a table nobody may delete
    // from.
    return {
      outcome: "unknown-account",
      message: RESET_UNKNOWN_ACCOUNT_MESSAGE,
    };
  }

  if (!isResettable(user)) {
    // Registered, but this flow cannot help them. Answered exactly as a
    // successful send is — the account's state is not disclosed.
    return { outcome: "sent", message: RESET_REQUESTED_MESSAGE };
  }

  // A new link invalidates any outstanding one. Scoped to this purpose, so a
  // pending email-verification token for the same address survives.
  await clearVerificationTokens(
    deps.prisma,
    user.email,
    VERIFICATION_PURPOSES.PASSWORD_RESET,
  );

  const issued = await issueVerificationToken(
    deps.prisma,
    user.email,
    VERIFICATION_PURPOSES.PASSWORD_RESET,
    now,
  );

  await writeAuditLog(deps.prisma, {
    action: AUDIT_ACTIONS.PASSWORD_RESET_REQUESTED,
    targetType: "User",
    targetId: user.id,
    actorUserId: user.id,
    actorTenantId: user.tenantId,
    afterValue: { method: "password-reset", outcome: "issued" },
    ip: input.ip,
    userAgent: input.userAgent,
  });

  try {
    await deps.sendEmail({
      to: user.email,
      resetUrl: buildPasswordResetUrl(issued.token),
      expiresInMinutes: RESET_LINK_TTL_MINUTES,
    });
  } catch (error: unknown) {
    // Logged, not surfaced. The token stays valid, so a resend after the mail
    // problem is fixed still works, and the user can request another.
    console.error("Password reset email delivery failed", error);
  }

  return { outcome: "sent", message: RESET_REQUESTED_MESSAGE };
}

/**
 * Redeems a link and replaces the password.
 *
 * ONE TRANSACTION covers consuming the token, writing the new hash and revoking
 * every live session. A partial apply here is the dangerous shape: a consumed
 * token with an unchanged password strands the user, and a changed password
 * with live old sessions is a reset that did not reset anything.
 */
export async function confirmPasswordReset(
  deps: PasswordResetDeps,
  input: { token: string; password: string } & RequestMeta,
): Promise<ConfirmPasswordResetOutcome> {
  const now = deps.now ?? new Date();

  // Hashed OUTSIDE the transaction: bcrypt at cost 12 takes ~300ms, and holding
  // a MySQL transaction open for it would pin a connection for the duration on
  // a box that has few.
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  const result = await deps.prisma.$transaction(async (tx) => {
    const consumed = await consumeVerificationToken(
      tx,
      input.token,
      VERIFICATION_PURPOSES.PASSWORD_RESET,
      now,
    );

    if (consumed.status !== "valid") {
      // "invalid" and "expired" are answered identically. The holder of a dead
      // link learns only that it does not work, which is all they can act on.
      return { outcome: "invalid-link" as const, userId: null, tenantId: null };
    }

    const user = await tx.user.findUnique({
      where: { email: consumed.email },
      select: {
        id: true,
        tenantId: true,
        passwordHash: true,
        tenant: { select: { isPlatform: true } },
      },
    });

    // Re-checked against freshly-read rows rather than trusting that the
    // account was resettable when the link was minted: 24 hours is long enough
    // for an account to be archived or moved to the platform tenant.
    if (!user || !isResettable(user)) {
      return { outcome: "invalid-link" as const, userId: null, tenantId: null };
    }

    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    // Sign out everywhere. See the note at the top of this file on why this is
    // not optional.
    await revokeAllSessionsForUser(tx, {
      userId: user.id,
      reason: "password-reset",
      now,
    });

    await writeAuditLog(tx, {
      action: AUDIT_ACTIONS.PASSWORD_RESET_COMPLETED,
      targetType: "User",
      targetId: user.id,
      actorUserId: user.id,
      actorTenantId: user.tenantId,
      afterValue: { method: "password-reset", outcome: "changed" },
      ip: input.ip,
      userAgent: input.userAgent,
    });

    return { outcome: "changed" as const, userId: user.id, tenantId: user.tenantId };
  });

  if (result.outcome === "invalid-link") {
    await writeAuditLog(deps.prisma, {
      action: AUDIT_ACTIONS.PASSWORD_RESET_FAILED,
      targetType: "User",
      // No subject: a refused redemption has not proven whose link it was.
      targetId: null,
      afterValue: { method: "password-reset", outcome: "refused" },
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return { outcome: "invalid-link", message: RESET_LINK_INVALID_MESSAGE };
  }

  return { outcome: "changed", message: RESET_COMPLETED_MESSAGE };
}

/**
 * Is this raw token redeemable right now? Read-only — consumes NOTHING.
 *
 * Used by the /reset-password page so a dead link says so before the user fills
 * in a password twice. It is a server-side call from a Server Component, NOT an
 * endpoint: exposing "is this token live?" over HTTP would be a probe, and this
 * way there is nothing to probe.
 */
export async function isPasswordResetTokenLive(
  prisma: PrismaClient,
  rawToken: string,
  now: Date = new Date(),
): Promise<boolean> {
  const record = await prisma.verificationToken.findUnique({
    where: { token: hashToken(rawToken) },
    select: { expires: true, purpose: true },
  });

  if (!record || record.purpose !== VERIFICATION_PURPOSES.PASSWORD_RESET) {
    return false;
  }
  return record.expires.getTime() > now.getTime();
}
