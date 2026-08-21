/**
 * Server-side session registry — Stage 2, decision 2.
 *
 * This is NOT a native Auth.js database session. Auth.js cannot issue one for a
 * Credentials provider, so the JWT remains the transport and this table is the
 * authority: the token carries a `sid`, and every authorization decision is
 * made from the row it names plus live status columns.
 *
 * What that buys, which a bare JWT cannot: revocation. Signing a user out
 * everywhere, an Owner suspending an account, or a Tenant Admin removing a
 * member all take effect on the next request instead of whenever the token
 * happens to expire.
 *
 * `lastSeenAt` is stamped at creation and is NOT refreshed on every request:
 * requireActor() runs on every page render, and a write per render is not worth
 * the freshness. Call `touchSessionLastSeen` from paths that already write.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  IP_COLUMN_MAX,
  USER_AGENT_MAX,
  computeSessionExpiry,
  truncateForColumn,
  type SessionRecordSnapshot,
} from "@/lib/sessionPolicy";

type PrismaClientOrTransaction = PrismaClient | Prisma.TransactionClient;

export interface CreateSessionInput {
  userId: string;
  tenantId: string;
  rememberMe?: boolean;
  ip?: string | null;
  userAgent?: string | null;
  /** Injected so a caller can pin one clock across a multi-step login. */
  now?: Date;
}

/**
 * Everything an authorization decision needs, in one round trip. Fetching the
 * user and tenant separately would open a window where the session row says one
 * thing and the status columns another.
 */
export interface SessionContext {
  record: SessionRecordSnapshot;
  user: {
    id: string;
    tenantId: string;
    accountStatus: "PENDING" | "ACTIVE" | "SUSPENDED" | "ARCHIVED";
    membershipStatus: "PENDING" | "ACTIVE" | "SUSPENDED" | "REJECTED" | "REMOVED";
    platformRole: "SUPER_ADMIN" | "SUPPORT_ADMIN" | null;
  };
  tenant: {
    id: string;
    status: "PENDING" | "ACTIVE" | "SUSPENDED" | "REJECTED" | "ARCHIVED";
    isPlatform: boolean;
  };
}

/** Creates the row and returns its id, which becomes the JWT's `sid` claim. */
export async function createAppSession(
  client: PrismaClientOrTransaction,
  input: CreateSessionInput,
): Promise<string> {
  const now = input.now ?? new Date();
  const rememberMe = input.rememberMe ?? false;

  const session = await client.appSession.create({
    data: {
      userId: input.userId,
      tenantId: input.tenantId,
      rememberMe,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: computeSessionExpiry(now, rememberMe),
      ip: truncateForColumn(input.ip, IP_COLUMN_MAX),
      userAgent: truncateForColumn(input.userAgent, USER_AGENT_MAX),
    },
    select: { id: true },
  });

  return session.id;
}

/**
 * Loads a session with its user and tenant. Returns null for an unknown sid,
 * and also for the one inconsistency worth failing closed on: a session whose
 * denormalised `tenantId` no longer matches the user's. That should be
 * impossible, and if it ever happens the safe reading is "not a valid session".
 */
export async function loadSessionContext(sid: string): Promise<SessionContext | null> {
  const row = await prisma.appSession.findUnique({
    where: { id: sid },
    select: {
      id: true,
      userId: true,
      tenantId: true,
      revokedAt: true,
      expiresAt: true,
      user: {
        select: {
          id: true,
          tenantId: true,
          accountStatus: true,
          membershipStatus: true,
          platformRole: true,
          tenant: { select: { id: true, status: true, isPlatform: true } },
        },
      },
    },
  });

  if (!row || row.tenantId !== row.user.tenantId) {
    return null;
  }

  return {
    record: {
      id: row.id,
      userId: row.userId,
      revokedAt: row.revokedAt,
      expiresAt: row.expiresAt,
    },
    user: {
      id: row.user.id,
      tenantId: row.user.tenantId,
      accountStatus: row.user.accountStatus,
      membershipStatus: row.user.membershipStatus,
      platformRole: row.user.platformRole,
    },
    tenant: row.user.tenant,
  };
}

export interface RevokeSessionInput {
  sessionId: string;
  /** Null when the system revoked it rather than a person. */
  revokedById?: string | null;
  reason?: string | null;
  now?: Date;
}

/**
 * Marks one session revoked. Idempotent by construction: the `revokedAt IS
 * NULL` filter means a second call updates nothing, so the original revoker and
 * reason are never overwritten by a later one.
 */
export async function revokeSession(
  client: PrismaClientOrTransaction,
  input: RevokeSessionInput,
): Promise<boolean> {
  const result = await client.appSession.updateMany({
    where: { id: input.sessionId, revokedAt: null },
    data: {
      revokedAt: input.now ?? new Date(),
      revokedById: input.revokedById ?? null,
      revokeReason: input.reason ?? null,
    },
  });

  return result.count > 0;
}

/**
 * Revokes every live session for one user — the "sign out everywhere" behind
 * suspension, removal and password change. Returns how many were still live.
 */
export async function revokeAllSessionsForUser(
  client: PrismaClientOrTransaction,
  input: { userId: string; revokedById?: string | null; reason?: string | null; now?: Date },
): Promise<number> {
  const result = await client.appSession.updateMany({
    where: { userId: input.userId, revokedAt: null },
    data: {
      revokedAt: input.now ?? new Date(),
      revokedById: input.revokedById ?? null,
      revokeReason: input.reason ?? null,
    },
  });

  return result.count;
}

/**
 * Refreshes `lastSeenAt`, at most once per throttle window. Never touches
 * `expiresAt`: the lifetime is absolute, so activity must not extend it.
 */
export const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;

export async function touchSessionLastSeen(
  client: PrismaClientOrTransaction,
  sessionId: string,
  now = new Date(),
): Promise<void> {
  await client.appSession.updateMany({
    where: {
      id: sessionId,
      revokedAt: null,
      lastSeenAt: { lt: new Date(now.getTime() - LAST_SEEN_THROTTLE_MS) },
    },
    data: { lastSeenAt: now },
  });
}
