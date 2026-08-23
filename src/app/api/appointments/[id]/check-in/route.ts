import { jsonOk, toErrorResponse } from "@/lib/apiHandler";
import { checkInAppointment } from "@/lib/appointmentLifecycle";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { requireActor } from "@/lib/session";

// Record that the patient has arrived — AP-4. Needs `appointment:checkin`.
//
// NO BODY AT ALL, so none is read. There is nothing a client could usefully say
// here: who arrived is the appointment, when they arrived is now, and who
// recorded it is the session. Accepting a timestamp would let a front desk
// backdate an arrival, which is exactly the sort of thing an audit trail exists
// to make impossible.
//
// THE SLOT STAYS OCCUPIED. CHECKED_IN is an occupying status, so the time
// remains unbookable — a patient in the waiting room has not released anything.
// This is the one AP-4 transition that changes no occupancy, and it still runs
// the full lock protocol: the schema requires check-in to, and the row lock is
// what stops a check-in and a cancellation of the same appointment from both
// succeeding.

interface RouteContext {
  // Next 16 hands route params to the handler as a promise.
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.appointments);

    const { id } = await context.params;

    return jsonOk(await checkInAppointment(actor, id));
  } catch (error: unknown) {
    return toErrorResponse(error, "POST /api/appointments/[id]/check-in");
  }
}
