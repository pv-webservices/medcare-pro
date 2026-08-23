import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import {
  appointmentFilterSchema,
  createAppointment,
  createAppointmentSchema,
  listAppointments,
} from "@/lib/appointments";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { requireActor } from "@/lib/session";

// Appointments — AP-3. The board, and booking onto it.
//
// GET  needs `appointment:read`   — the board, defaulting to what is still
//                                   going to happen and hiding outcomes unless
//                                   ?includeHistory=true asks for them.
// POST needs `appointment:create` — one booking, under the DoctorScheduleLock
//                                   protocol in @/lib/appointments.
//
// Every filter on GET is a filter and not an authorisation: @/lib/appointments
// intersects `clinicId` and `doctorId` with the caller's own clinic scope, so
// naming a clinic or doctor they cannot reach returns nothing rather than
// widening the result.
//
// There is no PATCH, PUT or DELETE here. AP-4 added the lifecycle as four
// sibling routes under [id] — /reschedule, /cancel, /no-show and /check-in —
// one per operation because each answers to a different permission. Conversion
// to a registration is AP-5, and correcting a booking's patient details still
// has no endpoint at all.
//
// Nothing deletes an appointment anywhere: its status changes and the row
// remains, which is what any later utilisation figure depends on.

export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.appointments);

    const params = new URL(request.url).searchParams;
    const filters = appointmentFilterSchema.parse(Object.fromEntries(params));

    return jsonOk(await listAppointments(actor, filters));
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/appointments");
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.appointments);

    const input = createAppointmentSchema.parse(await readJsonBody(request));

    return jsonOk(await createAppointment(actor, input), 201);
  } catch (error: unknown) {
    return toErrorResponse(error, "POST /api/appointments");
  }
}
