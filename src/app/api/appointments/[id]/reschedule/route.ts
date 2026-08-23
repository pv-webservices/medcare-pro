import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import { rescheduleAppointmentSchema } from "@/lib/appointmentInput";
import { rescheduleAppointment } from "@/lib/appointmentReschedule";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { requireActor } from "@/lib/session";

// Reschedule one appointment — AP-4. Needs `appointment:reschedule`.
//
// POST, not PATCH, because this CREATES a resource: the original is marked
// rescheduled and a new appointment takes its place, per rule 2 in the schema
// header — slot_start and slot_end are never updated after insert. 201 says so.
//
// Its own route rather than an `action` field on a PATCH of the appointment,
// because each of AP-4's four operations answers to a DIFFERENT permission.
// One endpoint dispatching on a body field would put four authorisation
// decisions behind one handler, which is one place to forget one. The same
// reason /api/owner/applications/[id]/decision is its own route.
//
// There is no DELETE anywhere under /api/appointments: no appointment row is
// ever deleted, only transitioned.

interface RouteContext {
  // Next 16 hands route params to the handler as a promise.
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.appointments);

    const { id } = await context.params;
    const input = rescheduleAppointmentSchema.parse(await readJsonBody(request));

    return jsonOk(await rescheduleAppointment(actor, id, input), 201);
  } catch (error: unknown) {
    return toErrorResponse(error, "POST /api/appointments/[id]/reschedule");
  }
}
