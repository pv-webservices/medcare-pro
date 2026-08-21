/**
 * Platform Owner authorization — Stage 2.
 *
 * The one door onto the /owner surface. Every Owner route and every module
 * under `src/lib/platform/*` starts here; nothing else in the codebase may
 * decide that a request is an Owner.
 *
 * Three facts must hold, in this order (PRD §9, Stage 2):
 *   1. a live session in the registry — same check every customer request gets;
 *   2. platformRole === SUPER_ADMIN, read from the database, never from the JWT;
 *   3. accountStatus === ACTIVE.
 *
 * Note what is NOT here: no tenant status check, and no membership check. See
 * the reasoning in ./context.ts — an Owner must not be governed by tenant-level
 * staff approval.
 */
import { loadLiveSession, resolveLiveSession } from "@/lib/session";
import {
  OWNER_PLATFORM_ROLE,
  PlatformAuthorizationError,
  evaluatePlatformAccess,
  type PlatformActorContext,
} from "@/lib/platform/context";

/**
 * Returns the acting Owner, or throws.
 *
 * The returned context carries no `tenantId`. That is not an oversight — it is
 * what stops an Owner's request being scoped to the reserved platform tenant by
 * some tenant-scoped helper downstream.
 */
export async function requirePlatformOwner(): Promise<PlatformActorContext> {
  return toPlatformOwner(await resolveLiveSession());
}

/**
 * The same decision, over an already-resolved session. Split out so the
 * database-backed path can be verified from a script, where there is no request
 * for `auth()` to read.
 */
export function toPlatformOwner(
  resolved: Awaited<ReturnType<typeof loadLiveSession>>,
): PlatformActorContext {
  const { context } = resolved;

  const verdict = evaluatePlatformAccess({
    sessionValid: context !== null,
    platformRole: context?.user.platformRole ?? null,
    accountStatus: context?.user.accountStatus ?? "PENDING",
    required: OWNER_PLATFORM_ROLE,
  });

  if (!verdict.allowed || !context) {
    throw new PlatformAuthorizationError(verdict.reason);
  }

  return {
    userId: context.user.id,
    platformRole: OWNER_PLATFORM_ROLE,
    sessionId: context.record.id,
  };
}

/**
 * Non-throwing variant, for the few places that must render differently rather
 * than refuse — the /owner/login page deciding whether to bounce an Owner who
 * is already signed in, for instance. Never use it to gate data access.
 */
export async function getPlatformOwner(): Promise<PlatformActorContext | null> {
  try {
    return await requirePlatformOwner();
  } catch (error: unknown) {
    if (error instanceof PlatformAuthorizationError) {
      return null;
    }
    throw error;
  }
}
