/**
 * Append-only audit trail — Stage 2 onwards, PRD §9.
 *
 * `audit_logs` rows are written and never updated or deleted, the same contract
 * `registration_edit_log` already keeps. Both actor foreign keys are RESTRICT,
 * so a user or tenant that appears in the trail cannot be hard-deleted out from
 * under it; they are ARCHIVED instead.
 *
 * WHAT MUST NEVER REACH THIS TABLE (Stage 1 decision 15):
 *   - plaintext six-digit login codes, or their hashes;
 *   - invitation tokens, or their hashes;
 *   - passwords or password hashes;
 *   - patient records or any clinical detail.
 *
 * The trail is read by Owners and exported during support work, so a secret
 * copied into it outlives every expiry and single-use guard protecting the
 * original. `assertSafeAuditMetadata` enforces that mechanically rather than by
 * convention — see the note on why it throws.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { IP_COLUMN_MAX, USER_AGENT_MAX, truncateForColumn } from "@/lib/sessionPolicy";

type PrismaClientOrTransaction = PrismaClient | Prisma.TransactionClient;

/**
 * Action names. VARCHAR(64), SCREAMING_SNAKE, past tense — they record what
 * happened, not what was requested.
 */
export const AUDIT_ACTIONS = {
  OWNER_CREATED: "OWNER_CREATED",
  OWNER_ALREADY_PRESENT: "OWNER_ALREADY_PRESENT",
  SESSION_CREATED: "SESSION_CREATED",
  SESSION_REVOKED: "SESSION_REVOKED",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

/**
 * Key names that must never appear in `beforeValue` / `afterValue`.
 *
 * Matched case-insensitively against the whole key, and also as a substring, so
 * `codeHash`, `code_hash` and `plainCode` are all caught by "code". The cost of
 * that breadth is the occasional false positive on an innocent key; the cost of
 * being narrower is a secret in a table that is never deleted.
 */
const FORBIDDEN_METADATA_KEYS = [
  "password",
  "passwordhash",
  "code",
  "codehash",
  "token",
  "tokenhash",
  "otp",
  "secret",
  "pepper",
  "apikey",
  "authorization",
] as const;

function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Throws if any key anywhere in the value is a forbidden one.
 *
 * IT THROWS RATHER THAN REDACTING. Silently stripping would let the mistake
 * ship: the call site keeps believing it logged the field, and nobody finds out
 * until an incident. Throwing surfaces it in the test that first exercises the
 * path. This is a programming error, not a runtime condition — no correct
 * caller can trigger it.
 */
export function assertSafeAuditMetadata(value: unknown, path = "metadata"): void {
  if (value === null || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeAuditMetadata(item, `${path}[${index}]`));
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const normalised = normaliseKey(key);
    const hit = FORBIDDEN_METADATA_KEYS.find((forbidden) =>
      normalised.includes(forbidden),
    );
    if (hit) {
      throw new Error(
        `Refusing to write audit metadata: ${path}.${key} looks like a secret ("${hit}"). The audit trail is append-only and is read by support staff.`,
      );
    }
    assertSafeAuditMetadata(child, `${path}.${key}`);
  }
}

export interface AuditEntry {
  action: AuditAction | string;
  targetType: string;
  targetId?: string | null;

  /** Null for an action taken by the system rather than a person. */
  actorUserId?: string | null;
  /** Captured at the time of the action; see the schema note on why. */
  actorPlatformRole?: "SUPER_ADMIN" | "SUPPORT_ADMIN" | null;
  /** Null for a platform-wide action with no single tenant behind it. */
  actorTenantId?: string | null;

  beforeValue?: Prisma.InputJsonValue | null;
  afterValue?: Prisma.InputJsonValue | null;
  reason?: string | null;

  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

/**
 * Appends one row. Pass a transaction client to make the record atomic with the
 * change it describes — an approval that commits without its audit row, or an
 * audit row without its approval, is worse than either alone.
 */
export async function writeAuditLog(
  client: PrismaClientOrTransaction,
  entry: AuditEntry,
): Promise<void> {
  assertSafeAuditMetadata(entry.beforeValue, "beforeValue");
  assertSafeAuditMetadata(entry.afterValue, "afterValue");

  await client.auditLog.create({
    data: {
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      actorUserId: entry.actorUserId ?? null,
      actorPlatformRole: entry.actorPlatformRole ?? null,
      actorTenantId: entry.actorTenantId ?? null,
      beforeValue: entry.beforeValue ?? undefined,
      afterValue: entry.afterValue ?? undefined,
      reason: entry.reason ?? null,
      ip: truncateForColumn(entry.ip, IP_COLUMN_MAX),
      userAgent: truncateForColumn(entry.userAgent, USER_AGENT_MAX),
      requestId: truncateForColumn(entry.requestId, 64),
    },
  });
}
