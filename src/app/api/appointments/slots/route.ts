import { jsonOk, toErrorResponse } from "@/lib/apiHandler";
import {
  appointmentSlotQuerySchema,
  getAppointmentSlots,
} from "@/lib/appointments";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { requireActor } from "@/lib/session";

// Appointment slots — AP-2. READ ONLY.
//
// GET /api/appointments/slots?clinicId=&doctorId=&appointmentTypeId=&date=
//
// There is deliberately no POST, PUT, PATCH or DELETE here. Booking is AP-3;
// reschedule, cancel, check-in and no-show are AP-4; conversion is AP-5. A
// mutation added to this file before its lock protocol exists would be a
// double-booking waiting to happen.
//
// Every one of the four query parameters is a REQUEST, not an authorisation.
// @/lib/appointments re-derives each of them from the session: the clinic
// against the caller's own scope, the doctor against that clinic, the
// appointment type against the caller's tenant. Naming a doctor in a clinic
// they cannot reach is a 404, never another clinic's diary.
//
// The response carries slot times and status only — no patient name, phone,
// address, age, gender or amount. See AppointmentSlotView.

export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    // Also enforced inside getAppointmentSlots, where every later stage will
    // inherit it. Kept here as well so this route reads like every other gated
    // route in the app.
    await requireModule(actor, MODULE_FEATURES.appointments);

    const params = new URL(request.url).searchParams;

    const query = appointmentSlotQuerySchema.parse({
      clinicId: params.get("clinicId") ?? "",
      doctorId: params.get("doctorId") ?? "",
      appointmentTypeId: params.get("appointmentTypeId") ?? "",
      date: params.get("date") ?? "",
    });

    return jsonOk(await getAppointmentSlots(actor, query));
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/appointments/slots");
  }
}
