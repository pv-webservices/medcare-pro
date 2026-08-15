import { jsonOk, toErrorResponse } from "@/lib/apiHandler";
import { listEditHistoryForActor } from "@/lib/registrations";
import { requireActor } from "@/lib/session";

// Audit trail — PRD §6.3 (FR-3.6). Append-only and read-only: no write method
// exists here by design (PRD §9 Audit integrity).
//
// Requires `registration:history:read`. Staff hold `registration:edit` but not
// this one, so their edits are logged and they simply cannot read the log back
// — and that 403 comes from here, not from a hidden UI tab.

interface RouteContext {
  // Next 16 hands route params to the handler as a promise.
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    const { id } = await context.params;
    return jsonOk(await listEditHistoryForActor(actor, id));
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/registrations/[id]/history");
  }
}
