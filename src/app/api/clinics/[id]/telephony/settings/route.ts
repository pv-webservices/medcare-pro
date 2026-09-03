import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { requireActor } from "@/lib/session";
import {
  getClinicPhoneSettingsForActor,
  updateClinicPhoneSettingsForActor,
} from "@/lib/telephony/clinicPhoneSettings";
import { updateClinicPhoneSettingsSchema } from "@/lib/telephony/clinicPhoneSettingsContract";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.ivr);
    const { id } = await context.params;
    return jsonOk(await getClinicPhoneSettingsForActor(actor, id));
  } catch (error: unknown) {
    return toErrorResponse(
      error,
      "GET /api/clinics/[id]/telephony/settings",
    );
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.ivr);
    const { id } = await context.params;
    const input = updateClinicPhoneSettingsSchema.parse(
      await readJsonBody(request),
    );
    return jsonOk(await updateClinicPhoneSettingsForActor(actor, id, input));
  } catch (error: unknown) {
    return toErrorResponse(
      error,
      "PATCH /api/clinics/[id]/telephony/settings",
    );
  }
}

