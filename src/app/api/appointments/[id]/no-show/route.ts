import {
  jsonOk,
  readOptionalJsonBody,
  toErrorResponse,
} from "@/lib/apiHandler";
import { cancelAppointmentSchema } from "@/lib/appointmentInput";
import { markAppointmentNoShow } from "@/lib/appointmentLifecycle";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { requireActor } from "@/lib/session";

// Mark one appointment as a no-show — AP-4. Needs `appointment:cancel`.
//
// The SAME permission as cancelling, because it is the same authority: deciding
// that a booked slot will not be used. The catalogue entry has said so since
// AP-1. What differs is the record left behind, and that is why this is its own
// endpoint rather than a flag on /cancel — "who cancelled my 09:30?" and "how
// many people did not turn up?" must stay separately answerable.
//
// A no-show RELEASES the slot: the patient did not come, so the time is free,
// and a past slot becoming bookable again is occasionally useful for
// backfilling a walk-in. That is AP-1's rule, applied by
// activeSlotStartForStatus and never restated.
//
// The body is optional and carries the same single field as /cancel.

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

    return jsonOk(await markAppointmentNoShow(actor, id, input));
  } catch (error: unknown) {
    return toErrorResponse(error, "POST /api/appointments/[id]/no-show");
  }
}
