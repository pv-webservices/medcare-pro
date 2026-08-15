import {
  BadRequestError,
  jsonOk,
  readJsonBody,
  toErrorResponse,
} from "@/lib/apiHandler";
import { requireActor } from "@/lib/session";
import {
  addAvailability,
  availabilitySchema,
  getDoctorForActor,
  removeAvailability,
} from "@/lib/doctors";

// Doctor availability — PRD §6.4 (FR-4.3): specific dates with time ranges.
//
// Reads need `doctor:read` on the owning clinic, writes need `doctor:edit`.
// Overlapping windows on the same date are rejected with 409.

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    const { id } = await context.params;
    const doctor = await getDoctorForActor(actor, id);
    return jsonOk(doctor.availability);
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/doctors/[id]/availability");
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    const { id } = await context.params;
    const input = availabilitySchema.parse(await readJsonBody(request));
    return jsonOk(await addAvailability(actor, id, input), 201);
  } catch (error: unknown) {
    return toErrorResponse(error, "POST /api/doctors/[id]/availability");
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    const { id } = await context.params;

    // Which window to drop. Scoped to this doctor inside removeAvailability, so
    // another doctor's entry id cannot be deleted through this route.
    const entryId = new URL(request.url).searchParams.get("entryId");
    if (!entryId) {
      throw new BadRequestError("Specify which availability window to remove.");
    }

    await removeAvailability(actor, id, entryId);
    return jsonOk(null);
  } catch (error: unknown) {
    return toErrorResponse(error, "DELETE /api/doctors/[id]/availability");
  }
}
