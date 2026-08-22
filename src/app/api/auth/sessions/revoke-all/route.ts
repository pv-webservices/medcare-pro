import { jsonOk, toErrorResponse } from "@/lib/apiHandler";
import { requireActor } from "@/lib/session";
import { revokeAllSessionsForUser } from "@/lib/appSession";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { readClientIp, readUserAgent } from "@/lib/requestMeta";

/**
 * Sign out of EVERY device — Stage 4.
 *
 * The recovery action behind "remember this device". A 30-day session on a
 * phone that has since been lost is exactly the situation this exists for, and
 * it is the only way for a user to end a session they are not currently holding.
 *
 * Scoped to the caller's own userId, which comes from the session registry and
 * never from the request. There is no parameter to widen it: revoking another
 * user's sessions is a Tenant Admin or Owner action with its own authorisation,
 * not something this endpoint may be talked into doing.
 *
 * The current session is included. Signing out everywhere but here would leave
 * the one device an attacker is most likely to be sitting at still signed in.
 *
 * IDEMPOTENT, and audited whatever the count — including zero. Unlike the
 * single-session route, "I signed out everywhere and nothing was live" is still
 * a security-relevant act by the user and worth a row.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireActor();

    // The audit row is written in the same transaction as the revocations. A
    // revocation that commits without its record, or a record without its
    // revocations, would both misrepresent what happened to whoever reads the
    // trail after an account compromise — which is precisely when it is read.
    const revokedCount = await prisma.$transaction(async (tx) => {
      const count = await revokeAllSessionsForUser(tx, {
        userId: actor.userId,
        revokedById: actor.userId,
        reason: "Signed out of all devices",
      });

      await writeAuditLog(tx, {
        action: AUDIT_ACTIONS.SESSIONS_REVOKED_ALL,
        targetType: "User",
        targetId: actor.userId,
        actorUserId: actor.userId,
        actorTenantId: actor.tenantId,
        afterValue: { scope: "all-sessions", outcome: "revoked", revokedCount: count },
        ip: readClientIp(request),
        userAgent: readUserAgent(request),
      });

      return count;
    });

    return jsonOk({ revokedCount });
  } catch (error: unknown) {
    return toErrorResponse(error, "POST /api/auth/sessions/revoke-all");
  }
}
