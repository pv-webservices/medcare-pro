import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import { requireActor } from "@/lib/session";
import {
  getDoctorForActor,
  updateDoctor,
  updateDoctorSchema,
} from "@/lib/doctors";

// Doctor detail — PRD §6.4 / §6.5.
//
// NOTE: docs/PROJECT_STRUCTURE.md lists only the availability and leave routes
// under doctors/[id]. This file is added because PRD §6.5 describes the Doctors
// module as "list, add/edit form, and detail view" — the edit half needs a
// mutation endpoint, and the detail view needs a read one.
//
// A doctor in a clinic the caller cannot see answers 404, never 403 (see
// @/lib/doctors). One they can see but lack `doctor:edit` for answers 403.
//
// The owning clinic is deliberately not editable: moving a doctor between
// clinics would re-home their registrations and availability, which the PRD
// does not describe.

interface RouteContext {
  // Next 16 hands route params to the handler as a promise.
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    const { id } = await context.params;
    return jsonOk(await getDoctorForActor(actor, id));
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/doctors/[id]");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    const { id } = await context.params;
    const input = updateDoctorSchema.parse(await readJsonBody(request));
    return jsonOk(await updateDoctor(actor, id, input));
  } catch (error: unknown) {
    return toErrorResponse(error, "PATCH /api/doctors/[id]");
  }
}
