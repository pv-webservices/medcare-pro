import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import { requireActor } from "@/lib/session";
import {
  createDoctor,
  createDoctorSchema,
  listDoctorsForActor,
} from "@/lib/doctors";
import { MODULE_FEATURES, requireModule } from "@/lib/features";

// Doctors — PRD §6.4 (FR-4.1, FR-4.2).
//
// GET accepts ?clinicId= to narrow the list (FR-4.1 "filterable by clinic").
// That value is a filter, not an authorisation: @/lib/doctors intersects it
// with the caller's own clinic scope, so naming a clinic they cannot reach
// returns nothing rather than widening the result.
//
// No DELETE — `registrations` references `doctors` with onDelete: Restrict so a
// doctor cannot be removed out from under the revenue history FR-6.4 reports
// on, and the PRD describes no doctor removal.

export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.doctors);
    const clinicId = new URL(request.url).searchParams.get("clinicId");
    return jsonOk(await listDoctorsForActor(actor, { clinicId }));
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/doctors");
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.doctors);
    const input = createDoctorSchema.parse(await readJsonBody(request));
    return jsonOk(await createDoctor(actor, input), 201);
  } catch (error: unknown) {
    return toErrorResponse(error, "POST /api/doctors");
  }
}
