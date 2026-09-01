import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { requireActor } from "@/lib/session";
import {
  getClinicIvrProfileForActor,
  replaceClinicIvrProfileForActor,
  replaceClinicIvrProfileSchema,
  resetClinicIvrProfileForActor,
} from "@/lib/telephony/ivrProfile";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.clinics);
    const { id } = await context.params;
    return jsonOk(await getClinicIvrProfileForActor(actor, id));
  } catch (error: unknown) {
    return toErrorResponse(
      error,
      "GET /api/clinics/[id]/telephony/ivr-profile",
    );
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.clinics);
    const { id } = await context.params;
    const input = replaceClinicIvrProfileSchema.parse(
      await readJsonBody(request),
    );
    return jsonOk(await replaceClinicIvrProfileForActor(actor, id, input));
  } catch (error: unknown) {
    return toErrorResponse(
      error,
      "PUT /api/clinics/[id]/telephony/ivr-profile",
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.clinics);
    const { id } = await context.params;
    return jsonOk(await resetClinicIvrProfileForActor(actor, id));
  } catch (error: unknown) {
    return toErrorResponse(
      error,
      "DELETE /api/clinics/[id]/telephony/ivr-profile",
    );
  }
}
