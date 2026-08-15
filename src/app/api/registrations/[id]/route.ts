import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import {
  getRegistrationForActor,
  updateRegistration,
  updateRegistrationSchema,
} from "@/lib/registrations";
import { requireActor } from "@/lib/session";

// Registration detail — PRD §6.3 (FR-3.5, FR-3.6).
//
// PATCH writes a registration_edit_log row in the same transaction as the
// update: who, the role they held at the time, and what changed. There is no
// code path that edits without logging, and no DELETE — the log is append-only
// (PRD §9) and a deleted registration would take its trail with it.
//
// A registration in a clinic the caller cannot see answers 404, never 403 (see
// @/lib/registrations). One they can see but lack `registration:edit` for
// answers 403.

interface RouteContext {
  // Next 16 hands route params to the handler as a promise.
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    const { id } = await context.params;
    return jsonOk(await getRegistrationForActor(actor, id));
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/registrations/[id]");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    const { id } = await context.params;
    const input = updateRegistrationSchema.parse(await readJsonBody(request));
    return jsonOk(await updateRegistration(actor, id, input));
  } catch (error: unknown) {
    return toErrorResponse(error, "PATCH /api/registrations/[id]");
  }
}
