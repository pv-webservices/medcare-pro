import { auth } from "@/lib/auth";
import { loadSessionContext } from "@/lib/appSession";
import { evaluateAccessStatus } from "@/lib/accessStatus";
import { evaluateSession, type SessionDenialReason } from "@/lib/sessionPolicy";
import type { AccessDenialReason } from "@/lib/accessStatus";
import type { ActorContext } from "@/lib/rbac";

/**
 * Resolves the acting user from the session registry — PRD §9 (Data scoping).
 *
 * This is the ONLY sanctioned source of `tenantId`. Every query in the app
 * scopes by it, so taking it from a request body or query string would let a
 * caller read another tenant's data by editing one field. Routes call this
 * first and pass the result down; they never accept a tenant id as input.
 *
 * Since Stage 2 the JWT is treated as a pointer, not as evidence. It carries a
 * `sid`; the decision is made from the `app_sessions` row and the live status
 * columns behind it (Stage 0 decision 2: "Do not trust authorization claims
 * from the JWT"). The cost is one indexed query per call, paid so that
 * revocation and suspension take effect on the next request rather than
 * whenever the token happens to expire.
 *
 * A token minted before the registry existed has no `sid` and is therefore
 * unauthenticated — everyone signed in across the Stage 2 upgrade signs in
 * again, once.
 */

/** Thrown when there is no valid session. Routes map this to a 401. */
export class UnauthenticatedError extends Error {
  /** Why, for server logs. Never serialised: the client is told only "401". */
  readonly reason: SessionDenialReason | AccessDenialReason | "platform-tenant";

  constructor(
    reason: SessionDenialReason | AccessDenialReason | "platform-tenant" = null,
  ) {
    super("Not signed in");
    this.name = "UnauthenticatedError";
    this.reason = reason;
  }
}

/**
 * A tenant-scoped actor. `ActorContext` (lib/rbac.ts) is unchanged, so every
 * existing call site keeps working; `sessionId` is added for the paths that
 * need to revoke or audit the session they are running under.
 *
 * Compare `PlatformActorContext` (lib/platform/context.ts), which has no
 * `tenantId` and so cannot be passed anywhere this type is expected.
 */
export interface TenantActorContext extends ActorContext {
  sessionId: string;
}

/**
 * Resolves a presented session from the registry.
 *
 * SESSION VALIDITY ONLY — it answers "is this a live session", never "may this
 * request do the thing". requireActor() below and requirePlatformOwner() build
 * on it and then apply their own, different, authorization rules.
 *
 * Takes the claims as arguments rather than reading them itself, so the whole
 * database-backed path can be exercised from a verification script, where there
 * is no request for `auth()` to read.
 */
export async function loadLiveSession(
  sid: string | null | undefined,
  claimedUserId: string | null | undefined,
  now = new Date(),
) {
  const context = sid ? await loadSessionContext(sid) : null;

  const verdict = evaluateSession({
    sid,
    claimedUserId,
    record: context?.record ?? null,
    now,
  });

  if (!verdict.valid || !context) {
    return { context: null, reason: verdict.reason };
  }

  return { context, reason: null };
}

/** The same, for the claims carried by the current request's token. */
export async function resolveLiveSession() {
  const session = await auth();
  return loadLiveSession(session?.user?.sid ?? null, session?.user?.id ?? null);
}

/**
 * Turns a resolved session into a tenant-scoped actor, or throws. Split from
 * requireActor() so the rules below can be verified against a real database.
 */
export function toTenantActor(
  resolved: Awaited<ReturnType<typeof loadLiveSession>>,
): TenantActorContext {
  const { context, reason } = resolved;

  if (!context) {
    throw new UnauthenticatedError(reason);
  }

  // The reserved platform tenant is not a customer organisation. An Owner who
  // reached this function would otherwise be handed a context scoped to it, and
  // every clinical query downstream would run against a tenant that has no
  // clinics, no patients and no business being in those queries at all. Owners
  // use requirePlatformOwner() (lib/platform/auth.ts) instead.
  if (context.tenant.isPlatform) {
    throw new UnauthenticatedError("platform-tenant");
  }

  // The core authorization rule, in one place: tenant active AND account active
  // AND membership active. Checked here rather than at login, so that a
  // suspension takes effect on the next request instead of the next sign-in.
  const access = evaluateAccessStatus({
    tenantStatus: context.tenant.status,
    accountStatus: context.user.accountStatus,
    membershipStatus: context.user.membershipStatus,
  });

  if (!access.allowed) {
    throw new UnauthenticatedError(access.reason);
  }

  return {
    userId: context.user.id,
    tenantId: context.user.tenantId,
    sessionId: context.record.id,
  };
}

export async function requireActor(): Promise<TenantActorContext> {
  return toTenantActor(await resolveLiveSession());
}
