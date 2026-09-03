import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { requireActor } from "@/lib/session";
import {
  getClinicTelephonyConfigForActor,
  updateClinicTelephonyConfigForActor,
  updateClinicTelephonyConfigSchema,
} from "@/lib/telephony/clinicConfig";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.ivr);
    const { id } = await context.params;
    return jsonOk(await getClinicTelephonyConfigForActor(actor, id));
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/clinics/[id]/telephony");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.ivr);
    const { id } = await context.params;
    const input = updateClinicTelephonyConfigSchema.parse(
      await readJsonBody(request),
    );
    return jsonOk(
      await updateClinicTelephonyConfigForActor(actor, id, input),
    );
  } catch (error: unknown) {
    return toErrorResponse(error, "PATCH /api/clinics/[id]/telephony");
  }
}
