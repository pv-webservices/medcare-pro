import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import { requireActor } from "@/lib/session";
import {
  createClinic,
  createClinicSchema,
  listClinicsForActor,
} from "@/lib/clinics";

// Clinics — PRD §6.2 (FR-2.1, FR-2.2).
//
// Scoping and permission checks live in @/lib/clinics, which the dashboard's
// server components share. These handlers only translate HTTP to that layer.
//
// There is no DELETE: the PRD defines create/list/edit/detail for clinics and
// no removal, and a cascade would take the clinic's registrations — and the
// revenue history reported on them — with it.

export async function GET() {
  try {
    const actor = await requireActor();
    return jsonOk(await listClinicsForActor(actor));
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/clinics");
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    const input = createClinicSchema.parse(await readJsonBody(request));
    return jsonOk(await createClinic(actor, input), 201);
  } catch (error: unknown) {
    return toErrorResponse(error, "POST /api/clinics");
  }
}
