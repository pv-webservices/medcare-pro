import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import { requireActor } from "@/lib/session";
import {
  getClinicForActor,
  updateClinic,
  updateClinicSchema,
} from "@/lib/clinics";
import { MODULE_FEATURES, requireModule } from "@/lib/features";

// Clinic detail — PRD §6.2 (FR-2.1).
//
// An id belonging to another tenant, an unknown id, and an id outside the
// caller's clinic scope all answer 404 alike (see toErrorResponse): a 403 would
// confirm the record exists.
//
// No DELETE — see the note in ../route.ts.

interface RouteContext {
  // Next 16 hands route params to the handler as a promise.
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.clinics);
    const { id } = await context.params;
    return jsonOk(await getClinicForActor(actor, id));
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/clinics/[id]");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.clinics);
    const { id } = await context.params;
    const input = updateClinicSchema.parse(await readJsonBody(request));
    return jsonOk(await updateClinic(actor, id, input));
  } catch (error: unknown) {
    return toErrorResponse(error, "PATCH /api/clinics/[id]");
  }
}
