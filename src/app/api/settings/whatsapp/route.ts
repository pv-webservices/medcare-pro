import {
  jsonOk,
  readJsonBody,
  toErrorResponse,
} from "@/lib/apiHandler";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { requireActor } from "@/lib/session";
import {
  getWhatsappConfigurationForActor,
  saveWhatsappRoutingForActor,
  whatsappConfigMutationSchema,
} from "@/lib/whatsappProviderConfig";

export async function GET() {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.whatsapp);
    return jsonOk(await getWhatsappConfigurationForActor(actor));
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/settings/whatsapp");
  }
}

export async function PUT(request: Request) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.whatsapp);
    const input = whatsappConfigMutationSchema.parse(await readJsonBody(request));

    await saveWhatsappRoutingForActor(actor, input.value);

    return jsonOk(await getWhatsappConfigurationForActor(actor));
  } catch (error: unknown) {
    return toErrorResponse(error, "PUT /api/settings/whatsapp");
  }
}
