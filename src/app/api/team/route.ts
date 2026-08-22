import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import { readClientIp, readUserAgent } from "@/lib/requestMeta";
import { requireActor } from "@/lib/session";
import {
  getTeamOverview,
  teamMutationSchema,
  updateTeamMembership,
} from "@/lib/team";

// Team — Stage 6. Who is in this organisation, and whether they may still use it.
//
// Scoping: tenantId comes from the session. A client-supplied userId is checked
// against it in @/lib/team before anything is written, and a user from another
// tenant answers 404 rather than 403.
//
// Permissions are resolved per action inside @/lib/team, not here: `team:view`
// for the read, `team:approve` for approve/reject, `team:manage` for
// suspend/reactivate/remove. Every check is account-wide — membership reaches
// every clinic a person works in, so a clinic-scoped grant must not confer it.
//
// PATCH rather than DELETE for removal: `REMOVED` is a status on a row that
// stays, because the audit trail and the registrations they created still
// point at it.

export async function GET() {
  try {
    const actor = await requireActor();
    return jsonOk(await getTeamOverview(actor));
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/team");
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requireActor();
    const input = teamMutationSchema.parse(await readJsonBody(request));

    return jsonOk(
      await updateTeamMembership(actor, input, {
        ip: readClientIp(request),
        userAgent: readUserAgent(request),
      }),
    );
  } catch (error: unknown) {
    return toErrorResponse(error, "PATCH /api/team");
  }
}
