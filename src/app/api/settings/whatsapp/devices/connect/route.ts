import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { requireActor } from "@/lib/session";
import { connectWhatsappDevice, connectWhatsappDeviceSchema } from "@/lib/whatsappDeviceManagement";

export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.whatsapp);
    const input = connectWhatsappDeviceSchema.parse(await readJsonBody(request));
    return jsonOk(await connectWhatsappDevice(actor, input), 201);
  } catch (error: unknown) {
    return toErrorResponse(error, "POST /api/settings/whatsapp/devices/connect");
  }
}
