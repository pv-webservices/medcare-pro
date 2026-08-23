import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import { updateAppointment } from "@/lib/appointmentEdit";
import { updateAppointmentSchema } from "@/lib/appointmentInput";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { requireActor } from "@/lib/session";

// Correct one booking's details — AP-9. Needs `appointment:update`.
//
// PATCH, not PUT, and every field is optional: absent means unchanged. A body
// that changes nothing is a 400, because a save that alters no value should not
// leave an audit row claiming an edit happened.
//
// THE BODY IS REQUIRED, unlike /cancel and /no-show. Those two do something
// meaningful with no body at all — the reason is the optional part — where a
// correction with no body is a request that cannot be carried out.
//
// This endpoint cannot move an appointment. `updateAppointmentSchema` has no
// vocabulary for a slot, a doctor, a service, a clinic, a patient link or a
// status, and zod strips unknown keys, so a client that sends one is not
// refused — it is ignored and the stored value stands. Moving a booking is
// /reschedule, which creates a second row and keeps the first.
//
// There is no GET here on purpose: reading one appointment is the detail page's
// own scoped server-side load, and adding a second read path would be a second
// place for the scoping to be got wrong.

interface RouteContext {
  // Next 16 hands route params to the handler as a promise.
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.appointments);

    const { id } = await context.params;
    const input = updateAppointmentSchema.parse(await readJsonBody(request));

    return jsonOk(await updateAppointment(actor, id, input));
  } catch (error: unknown) {
    return toErrorResponse(error, "PATCH /api/appointments/[id]");
  }
}
