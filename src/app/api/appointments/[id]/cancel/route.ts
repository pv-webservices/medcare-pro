import {
  jsonOk,
  readOptionalJsonBody,
  toErrorResponse,
} from "@/lib/apiHandler";
import { cancelAppointmentSchema } from "@/lib/appointmentInput";
import { cancelAppointment } from "@/lib/appointmentLifecycle";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { requireActor } from "@/lib/session";

// Cancel one appointment — AP-4. Needs `appointment:cancel`.
//
// The slot is released and the row is KEPT, with its original times intact.
// Nothing in this system deletes an appointment.
//
// The body is optional: a reason is worth capturing when there is one, and
// insisting on `{}` to cancel without one would be a papercut for no gain.
// A body that is present but malformed is still a 400.
//
// Separate from /no-show even though both answer to the same permission,
// because they are different outcomes and the endpoint is what decides which
// one happened. A single `{ status }` body would let one authorisation check
// stand in front of two, and would let a client pick the outcome.

interface RouteContext {
  // Next 16 hands route params to the handler as a promise.
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.appointments);

    const { id } = await context.params;
    const input = cancelAppointmentSchema.parse(
      await readOptionalJsonBody(request),
    );

    return jsonOk(await cancelAppointment(actor, id, input));
  } catch (error: unknown) {
    return toErrorResponse(error, "POST /api/appointments/[id]/cancel");
  }
}
