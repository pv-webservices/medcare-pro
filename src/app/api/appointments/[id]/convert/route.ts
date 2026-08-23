import { jsonOk, toErrorResponse } from "@/lib/apiHandler";
import { convertAppointmentToRegistration } from "@/lib/appointmentConversion";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { requireActor } from "@/lib/session";

// Turn an arrived appointment into a registration — AP-5. Needs
// `appointment:convert`, and only a CHECKED_IN appointment qualifies.
//
// NO BODY AT ALL, so none is read — and this is a stronger statement here than
// it was for check-in. Conversion creates a Registration, and a Registration
// carries money, a department and a patient identity. Every one of those is
// derived server-side from the appointment and the doctor: the amount is the
// price the patient was quoted at booking, the department is the doctor's, the
// visit time is the slot, and the patient is either the one already linked or a
// new record minted from the appointment's own snapshot. Accepting any of them
// from the client would let the front desk re-price a visit, re-file it under
// another department, or attach it to somebody else's patient record, none of
// which is a thing this endpoint is for.
//
// POST, not PATCH: this is not an edit of the appointment. It creates a new
// record in another table and retires the appointment into a terminal state.
//
// THE SLOT STAYS OCCUPIED afterwards. CONVERTED is an occupying status — a
// visit that demonstrably happened consumed the doctor's time.

interface RouteContext {
  // Next 16 hands route params to the handler as a promise.
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.appointments);

    const { id } = await context.params;

    return jsonOk(await convertAppointmentToRegistration(actor, id));
  } catch (error: unknown) {
    return toErrorResponse(error, "POST /api/appointments/[id]/convert");
  }
}
