import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import { acceptInvitation, acceptInvitationSchema } from "@/lib/invitations";
import { readClientIp, readUserAgent } from "@/lib/requestMeta";

/**
 * Accepting an invitation — Stage 6. PUBLIC and UNAUTHENTICATED, necessarily:
 * the whole point is that the caller has no login yet.
 *
 * There is no `requireActor()` here and there must not be. Authorisation comes
 * from the token in the body and nothing else — not the tenant slug, not a
 * referrer, not a cookie. @/lib/invitations resolves it by hash, checks the
 * invitation's state and the organisation's, and refuses with one generic
 * sentence for every reason but "already used".
 *
 * NO SESSION IS ISSUED. A successful acceptance creates the login and returns;
 * the person then signs in through the ordinary login screen with the password
 * they just chose. Minting a session here would mean a second, less-tested path
 * into the app that skips lib/auth.ts entirely.
 *
 * The token is never logged, never echoed back, and never written to the audit
 * trail — `assertSafeAuditMetadata` refuses any metadata key naming one.
 */
export async function POST(request: Request) {
  try {
    const input = acceptInvitationSchema.parse(await readJsonBody(request));

    const accepted = await acceptInvitation(input, {
      ip: readClientIp(request),
      userAgent: readUserAgent(request),
    });

    // The address is echoed so the page can prefill the login form. Nothing
    // else about the organisation or its people goes back.
    return jsonOk({ email: accepted.email, businessName: accepted.businessName }, 201);
  } catch (error: unknown) {
    return toErrorResponse(error, "POST /api/invitations/accept");
  }
}
