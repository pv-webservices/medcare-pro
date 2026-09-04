import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { requireActor } from "@/lib/session";
import { deviceActionSchema, disconnectWhatsappDevice, refreshWhatsappDeviceStatus, regenerateWhatsappWebhook, removeWhatsappDevice, setWhatsappDeviceEnabled } from "@/lib/whatsappDeviceManagement";

export async function POST(request: Request, { params }: { params: Promise<{ deviceId: string }> }) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.whatsapp);
    const { deviceId } = await params;
    const input = deviceActionSchema.parse(await readJsonBody(request));
    if (input.action === "refresh") return jsonOk(await refreshWhatsappDeviceStatus(actor, deviceId));
    if (input.action === "disconnect") await disconnectWhatsappDevice(actor, deviceId);
    else if (input.action === "remove") await removeWhatsappDevice(actor, deviceId);
    else if (input.action === "setEnabled") await setWhatsappDeviceEnabled(actor, deviceId, input.enabled);
    else return jsonOk(await regenerateWhatsappWebhook(actor, deviceId));
    return jsonOk({ deviceId });
  } catch (error: unknown) {
    return toErrorResponse(error, "POST /api/settings/whatsapp/devices/[deviceId]");
  }
}
