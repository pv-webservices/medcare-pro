import { jsonOk, toErrorResponse } from "@/lib/apiHandler";
import { confirmAppointment } from "@/lib/appointmentLifecycle";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { requireActor } from "@/lib/session";

// Record that the patient has confirmed — AP-9. Needs `appointment:update`.
//
// The slot was already held and stays held: CONFIRMED occupies the doctor's
// time exactly as SCHEDULED did, so nothing about the day changes. What changes
// is that the desk now knows this one is not a guess.
//
// NO BODY AT ALL, not even an optional one. There is nothing to say beyond
// "they confirmed" — a reason would be a free-text note on a fact that has no
// variants — and an endpoint that reads no body cannot be talked into reading
// a status out of one.
//
// Separate from /check-in even though both answer to a desk action on a live
// booking, for the reason AP-4 kept /cancel and /no-show apart: the endpoint is
// what decides which outcome happened, and a single `{ status }` body would put
// one authorisation check in front of several.

interface RouteContext {
  // Next 16 hands route params to the handler as a promise.
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.appointments);

    const { id } = await context.params;

    return jsonOk(await confirmAppointment(actor, id));
  } catch (error: unknown) {
    return toErrorResponse(error, "POST /api/appointments/[id]/confirm");
  }
}
