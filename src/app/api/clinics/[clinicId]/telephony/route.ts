import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { requireActor } from "@/lib/session";
import {
  getClinicTelephonyConfigForActor,
  updateClinicTelephonyConfigForActor,
  updateClinicTelephonyConfigSchema,
} from "@/lib/telephony/clinicConfig";

interface RouteContext {
  params: Promise<{ clinicId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.clinics);
    const { clinicId } = await context.params;
    return jsonOk(await getClinicTelephonyConfigForActor(actor, clinicId));
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/clinics/[clinicId]/telephony");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.clinics);
    const { clinicId } = await context.params;
    const input = updateClinicTelephonyConfigSchema.parse(
      await readJsonBody(request),
    );
    return jsonOk(
      await updateClinicTelephonyConfigForActor(actor, clinicId, input),
    );
  } catch (error: unknown) {
    return toErrorResponse(error, "PATCH /api/clinics/[clinicId]/telephony");
  }
}
