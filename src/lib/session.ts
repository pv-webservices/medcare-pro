import { auth } from "@/lib/auth";
import type { ActorContext } from "@/lib/rbac";

/**
 * Resolves the acting user from the signed session — PRD §9 (Data scoping).
 *
 * This is the ONLY sanctioned source of `tenantId`. Every query in the app
 * scopes by it, so taking it from a request body or query string would let a
 * caller read another tenant's data by editing one field. Routes call this
 * first and pass the result down; they never accept a tenant id as input.
 */

/** Thrown when there is no valid session. Routes map this to a 401. */
export class UnauthenticatedError extends Error {
  constructor() {
    super("Not signed in");
    this.name = "UnauthenticatedError";
  }
}

export async function requireActor(): Promise<ActorContext> {
  const session = await auth();

  const userId = session?.user?.id;
  const tenantId = session?.user?.tenantId;

  // Both must be present. A session carrying a user but no tenant would other-
  // wise fall through to queries filtered by `undefined`, which Prisma treats
  // as "no filter" — exactly the cross-tenant leak this guard exists to stop.
  if (!userId || !tenantId) {
    throw new UnauthenticatedError();
  }

  return { userId, tenantId };
}
