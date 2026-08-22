import { createHash, randomBytes } from "node:crypto";
import type { PrismaClientOrTransaction } from "@/lib/defaultRoles";
import {
  purposeMatches,
  VERIFICATION_PURPOSES,
  type VerificationPurpose,
} from "@/lib/verificationPurpose";

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
 * `VerificationToken.identifier` holds the email being verified.
 *
 * STAGE 3 — PURPOSE. At signup the organisation's address and the applicant's
 * address are the same string, so `identifier` alone no longer identifies what a
 * token is for. Every token now carries a purpose, and consumption REQUIRES the
 * caller to state which one it expects: a token minted to verify the
 * organisation cannot be redeemed to verify an individual, or the reverse. A
 * mismatch is reported as `invalid` rather than as its own status — the holder
 * of a wrong-purpose token learns nothing beyond "this link does not work here".
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
  purpose: VerificationPurpose;
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
  purpose: VerificationPurpose = VERIFICATION_PURPOSES.TENANT_EMAIL,
  now: Date = new Date(),
): Promise<IssuedToken> {
  const token = randomBytes(TOKEN_BYTES).toString("hex");
  const tokenHash = hashToken(token);
  const expires = new Date(now.getTime() + TOKEN_TTL_MS);

  await client.verificationToken.create({
    data: { identifier: email, token: tokenHash, expires, purpose },
  });

  return { token, tokenHash, expires, purpose };
}

/**
 * Drops outstanding tokens for an address, so a resend invalidates the old link.
 *
 * Scoped to one purpose when given one. Clearing every purpose would mean a
 * resent organisation link silently killed the applicant's own pending
 * verification, which is a different flow with a different token.
 */
export async function clearVerificationTokens(
  client: PrismaClientOrTransaction,
  email: string,
  purpose?: VerificationPurpose,
): Promise<void> {
  await client.verificationToken.deleteMany({
    where: { identifier: email, ...(purpose ? { purpose } : {}) },
  });
}

export type ConsumeResult =
  | { status: "valid"; email: string; purpose: VerificationPurpose }
  | { status: "invalid" }
  | { status: "expired" };

/**
 * Validates and consumes a raw token against an expected purpose.
 *
 * An expired token is deleted as it is rejected, so a stale link cannot be
 * retried. A token whose purpose does not match is deliberately NOT deleted:
 * it is a valid token for some other flow, and destroying it here would let one
 * flow break another. The caller marks the row verified — this function
 * deliberately does not, so that both happen in one transaction at the call site.
 */
export async function consumeVerificationToken(
  client: PrismaClientOrTransaction,
  token: string,
  expectedPurpose: VerificationPurpose,
  now: Date = new Date(),
): Promise<ConsumeResult> {
  const tokenHash = hashToken(token);

  const record = await client.verificationToken.findUnique({
    where: { token: tokenHash },
  });

  if (!record) {
    return { status: "invalid" };
  }

  if (!purposeMatches(record.purpose, expectedPurpose)) {
    return { status: "invalid" };
  }

  if (record.expires.getTime() <= now.getTime()) {
    await client.verificationToken.delete({ where: { token: tokenHash } });
    return { status: "expired" };
  }

  await client.verificationToken.delete({ where: { token: tokenHash } });
  return { status: "valid", email: record.identifier, purpose: expectedPurpose };
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
