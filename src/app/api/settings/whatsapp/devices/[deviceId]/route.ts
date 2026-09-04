import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { requireActor } from "@/lib/session";
import { deviceActionSchema, disconnectWhatsappDevice, getWhatsappDeviceRoutingReferences, reconnectWhatsappDevice, refreshWhatsappDeviceStatus, regenerateWhatsappWebhook, removeWhatsappDevice, setWhatsappDeviceEnabled, setupWhatsappWebhook } from "@/lib/whatsappDeviceManagement";

export async function POST(request: Request, { params }: { params: Promise<{ deviceId: string }> }) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.whatsapp);
    const { deviceId } = await params;
    const input = deviceActionSchema.parse(await readJsonBody(request));
    if (input.action === "refresh") return jsonOk(await refreshWhatsappDeviceStatus(actor, deviceId));
    if (input.action === "reconnect") return jsonOk(await reconnectWhatsappDevice(actor, deviceId));
    if (input.action === "removeReferences") return jsonOk(await getWhatsappDeviceRoutingReferences(actor, deviceId));
    if (input.action === "disconnect") await disconnectWhatsappDevice(actor, deviceId);
    else if (input.action === "remove") return jsonOk(await removeWhatsappDevice(actor, deviceId, input));
    else if (input.action === "setEnabled") await setWhatsappDeviceEnabled(actor, deviceId, input.enabled);
    else if (input.action === "setupWebhook") return jsonOk(await setupWhatsappWebhook(actor, deviceId));
    else return jsonOk(await regenerateWhatsappWebhook(actor, deviceId));
    return jsonOk({ deviceId });
  } catch (error: unknown) {
    return toErrorResponse(error, "POST /api/settings/whatsapp/devices/[deviceId]");
  }
}
