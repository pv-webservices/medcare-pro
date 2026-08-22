import { jsonOk, toErrorResponse } from "@/lib/apiHandler";
import { requireActor } from "@/lib/session";
import { revokeSession } from "@/lib/appSession";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { readClientIp, readUserAgent } from "@/lib/requestMeta";

/**
 * Sign out of THIS device — Stage 4.
 *
 * WHY THIS ROUTE HAD TO EXIST. Until now signing out called next-auth's
 * `signOut()`, which clears the cookie and nothing else: the `app_sessions` row
 * stayed live until `expiresAt`, so anyone holding a copy of the JWT could keep
 * using it after the user believed they had logged out. That was already wrong;
 * with Stage 4's remember-me stretching sessions from 12 hours to 30 days it
 * becomes a month-long window, which is why the fix belongs to this stage.
 *
 * The client calls this FIRST and then `signOut()` — revoke the authority, then
 * discard the token. In the other order a user who closed the tab between the
 * two steps would be left with a live session row and no way to reach this
 * endpoint.
 *
 * IDEMPOTENT. `revokeSession` filters on `revokedAt IS NULL`, so a second call
 * updates nothing and preserves the original revoker and reason. Calling it
 * twice is a 200 both times — a sign-out that errored because it had already
 * succeeded would be a worse experience for no gain.
 */
export async function POST(request: Request) {
  try {
    // requireActor() is what makes this safe without a body: the session being
    // revoked is the one the caller is authenticated as, read from the registry.
    // Accepting a session id as input would let anyone sign anyone else out.
    const actor = await requireActor();

    const revoked = await revokeSession(prisma, {
      sessionId: actor.sessionId,
      revokedById: actor.userId,
      reason: "Signed out",
    });

    // Only audited when a live session actually ended, so a double submit does
    // not append a second row describing something that did not happen.
    if (revoked) {
      await writeAuditLog(prisma, {
        action: AUDIT_ACTIONS.SESSION_REVOKED,
        targetType: "AppSession",
        targetId: actor.sessionId,
        actorUserId: actor.userId,
        actorTenantId: actor.tenantId,
        afterValue: { scope: "current-session", outcome: "revoked" },
        ip: readClientIp(request),
        userAgent: readUserAgent(request),
      });
    }

    return jsonOk({ revoked });
  } catch (error: unknown) {
    return toErrorResponse(error, "POST /api/auth/sessions/revoke");
  }
}
