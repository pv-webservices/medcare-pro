import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import {
  updateAppointmentType,
  updateAppointmentTypeSchema,
} from "@/lib/appointmentTypes";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { requireActor } from "@/lib/session";

// Appointment type detail — AP-3.
//
// PATCH carries every edit, INCLUDING activation and deactivation via
// `isActive`. There are deliberately no /activate and /deactivate sub-routes:
// this codebase already settles lifecycle changes through a PATCH on the
// resource (see /api/team and /api/clinics/[id]), and a second convention for
// the same kind of change is a second place to forget an authorisation check.
//
// The audit trail still tells the two apart — @/lib/appointmentTypes writes
// APPOINTMENT_TYPE_ACTIVATED or APPOINTMENT_TYPE_DEACTIVATED for the flag and
// APPOINTMENT_TYPE_UPDATED for the fields, so "renamed" and "retired" remain
// different questions a reader can ask of the log.
//
// There is no DELETE: booked appointments reference the type under a Restrict
// foreign key, and their history must stay readable.

interface RouteContext {
  // Next 16 hands route params to the handler as a promise.
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.appointments);

    const { id } = await context.params;
    const input = updateAppointmentTypeSchema.parse(await readJsonBody(request));

    return jsonOk(await updateAppointmentType(actor, id, input));
  } catch (error: unknown) {
    return toErrorResponse(error, "PATCH /api/appointment-types/[id]");
  }
}
