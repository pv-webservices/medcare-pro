import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import {
  appointmentTypeFilterSchema,
  createAppointmentType,
  createAppointmentTypeSchema,
  listAppointmentTypes,
} from "@/lib/appointmentTypes";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { requireActor } from "@/lib/session";

// Appointment types — AP-3. The bookable services, their durations and prices.
//
// Two different permissions meet on this path, deliberately:
//
//   GET  needs `appointment:read`         — the booking form reads the price
//                                           list it books against.
//   POST needs `appointment:type:manage`  — Admin's. Taking bookings is not the
//                                           same as deciding what a consultation
//                                           costs, which is why Receptionist
//                                           holds the first and not the second.
//
// There is no DELETE. Appointments point at a type under a Restrict foreign key,
// and deleting one would either fail or orphan booked history; retire it with
// `isActive` through PATCH on [id] instead.

export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.appointments);

    const params = new URL(request.url).searchParams;
    const filters = appointmentTypeFilterSchema.parse(
      Object.fromEntries(params),
    );

    return jsonOk(await listAppointmentTypes(actor, filters));
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/appointment-types");
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.appointments);

    const input = createAppointmentTypeSchema.parse(await readJsonBody(request));

    return jsonOk(await createAppointmentType(actor, input), 201);
  } catch (error: unknown) {
    return toErrorResponse(error, "POST /api/appointment-types");
  }
}
