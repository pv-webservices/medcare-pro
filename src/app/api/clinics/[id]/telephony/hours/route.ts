import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { requireActor } from "@/lib/session";
import {
  getClinicBusinessHoursForActor,
  updateClinicBusinessHoursForActor,
  updateClinicBusinessHoursSchema,
} from "@/lib/telephony/businessHours";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.ivr);
    const { id } = await context.params;
    return jsonOk(await getClinicBusinessHoursForActor(actor, id));
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/clinics/[id]/telephony/hours");
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.ivr);
    const { id } = await context.params;
    const input = updateClinicBusinessHoursSchema.parse(
      await readJsonBody(request),
    );
    return jsonOk(await updateClinicBusinessHoursForActor(actor, id, input));
  } catch (error: unknown) {
    return toErrorResponse(error, "PUT /api/clinics/[id]/telephony/hours");
  }
}
