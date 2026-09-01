import { jsonOk, toErrorResponse } from "@/lib/apiHandler";
import {
  appointmentIndicatorsQuerySchema,
  getAppointmentDateIndicators,
} from "@/lib/appointments";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { requireActor } from "@/lib/session";

/**
 * Appointment Date Indicators — GET /api/appointments/indicators
 *
 * Returns appointment counts grouped by calendar date for the date picker.
 * Allows client-side calendar navigation to show indicator dots on dates
 * containing appointments.
 */
export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.appointments);

    const params = new URL(request.url).searchParams;
    const query = appointmentIndicatorsQuerySchema.parse(
      Object.fromEntries(params),
    );

    return jsonOk(await getAppointmentDateIndicators(actor, query));
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/appointments/indicators");
  }
}
