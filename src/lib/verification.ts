import { createHash, randomBytes } from "node:crypto";
import type { PrismaClientOrTransaction } from "@/lib/defaultRoles";

/**
 * Email-verification token handling — FR-1.2 / FR-1.5.
 *
 * Shared by `api/auth/signup` (issue) and `api/auth/verify-email` (consume and
 * re-issue), so the hashing and expiry rules exist in exactly one place.
 *
 * The token is issued as a random 32-byte hex string and mailed to the user,
 * but only its SHA-256 hash is stored. A leaked database therefore yields no
 * usable verification links. SHA-256 without a salt is appropriate here (unlike
 * for passwords): the input is already 256 bits of entropy, so there is nothing
 * to brute-force or rainbow-table.
 *
 * `VerificationToken.identifier` holds the Tenant's email. It is unique on
 * Tenant, so a consumed token resolves to exactly one tenant.
 */

const TOKEN_BYTES = 32;

/**
 * 24 hours. Not specified in the PRD — chosen as a conventional default. Long
 * enough to survive an overnight signup, short enough that an old link in an
 * inbox stops working.
 */
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export interface IssuedToken {
  /** The raw token — mailed to the user, never stored. */
  token: string;
  /** SHA-256 of the raw token — what actually goes in the database. */
  tokenHash: string;
  expires: Date;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Generates a token and writes its hash. Accepts a transaction client so signup
 * can issue the token in the same transaction that creates the tenant.
 */
export async function issueVerificationToken(
  client: PrismaClientOrTransaction,
  email: string,
  now: Date = new Date(),
): Promise<IssuedToken> {
  const token = randomBytes(TOKEN_BYTES).toString("hex");
  const tokenHash = hashToken(token);
  const expires = new Date(now.getTime() + TOKEN_TTL_MS);

  await client.verificationToken.create({
    data: { identifier: email, token: tokenHash, expires },
  });

  return { token, tokenHash, expires };
}

/** Drops every outstanding token for an address, so a resend invalidates the old link. */
export async function clearVerificationTokens(
  client: PrismaClientOrTransaction,
  email: string,
): Promise<void> {
  await client.verificationToken.deleteMany({ where: { identifier: email } });
}

export type ConsumeResult =
  | { status: "valid"; email: string }
  | { status: "invalid" }
  | { status: "expired" };

/**
 * Validates and consumes a raw token.
 *
 * An expired token is deleted as it is rejected, so a stale link cannot be
 * retried. The caller marks the tenant verified — this function deliberately
 * does not, so that both happen in one transaction at the call site.
 */
export async function consumeVerificationToken(
  client: PrismaClientOrTransaction,
  token: string,
  now: Date = new Date(),
): Promise<ConsumeResult> {
  const tokenHash = hashToken(token);

  const record = await client.verificationToken.findUnique({
    where: { token: tokenHash },
  });

  if (!record) {
    return { status: "invalid" };
  }

  if (record.expires.getTime() <= now.getTime()) {
    await client.verificationToken.delete({ where: { token: tokenHash } });
    return { status: "expired" };
  }

  await client.verificationToken.delete({ where: { token: tokenHash } });
  return { status: "valid", email: record.identifier };
}

/**
 * Builds the absolute link mailed to the user. NEXTAUTH_URL is the deployment's
 * public origin and is already required for Auth.js callbacks, so no additional
 * environment variable is introduced for this.
 */
export function buildVerificationUrl(token: string): string {
  const origin = process.env.NEXTAUTH_URL?.trim().replace(/\/$/, "");
  if (!origin) {
    throw new Error("NEXTAUTH_URL is not set — cannot build a verification link.");
  }
  return `${origin}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
}
