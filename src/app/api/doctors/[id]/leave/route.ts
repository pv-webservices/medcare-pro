import {
  BadRequestError,
  jsonOk,
  readJsonBody,
  toErrorResponse,
} from "@/lib/apiHandler";
import { requireActor } from "@/lib/session";
import {
  addLeave,
  getDoctorForActor,
  leaveSchema,
  removeLeave,
} from "@/lib/doctors";
import { MODULE_FEATURES, requireModule } from "@/lib/features";

// Doctor leave — PRD §6.4 (FR-4.4): a date range plus an optional reason,
// marking the doctor unavailable for that period.
//
// Reads need `doctor:read` on the owning clinic, writes need `doctor:edit`.

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.doctors);
    const { id } = await context.params;
    const doctor = await getDoctorForActor(actor, id);
    return jsonOk(doctor.leave);
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/doctors/[id]/leave");
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.doctors);
    const { id } = await context.params;
    const input = leaveSchema.parse(await readJsonBody(request));
    return jsonOk(await addLeave(actor, id, input), 201);
  } catch (error: unknown) {
    return toErrorResponse(error, "POST /api/doctors/[id]/leave");
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.doctors);
    const { id } = await context.params;

    const entryId = new URL(request.url).searchParams.get("entryId");
    if (!entryId) {
      throw new BadRequestError("Specify which leave period to remove.");
    }

    await removeLeave(actor, id, entryId);
    return jsonOk(null);
  } catch (error: unknown) {
    return toErrorResponse(error, "DELETE /api/doctors/[id]/leave");
  }
}
