import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseDeliveryStatusEvent, timingSafeEqual } from "@/lib/whatsapp";
import { hashWhatsappWebhookSecret } from "@/lib/whatsappDeviceManagement";

export async function POST(request: Request, { params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  const device = await prisma.whatsappDevice.findUnique({
    where: { webhookPublicId: publicId },
    select: { id: true, phoneNumber: true, webhookSecretHash: true },
  });
  if (!device?.webhookSecretHash) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const token = new URL(request.url).searchParams.get("token")?.trim() ?? request.headers.get("x-webhook-token")?.trim() ?? "";
  const presentedHash = hashWhatsappWebhookSecret(token);
  if (!timingSafeEqual(presentedHash, device.webhookSecretHash)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payload: unknown = await request.json().catch(() => null);
  if (typeof payload !== "object" || payload === null) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  const body = payload as Record<string, unknown>;
  const claimedDevice = body.device ?? body.sender_number;
  if (typeof claimedDevice === "string" && claimedDevice.replace(/\D/g, "") !== device.phoneNumber) {
    return NextResponse.json({ error: "Device mismatch" }, { status: 403 });
  }

  for (const event of parseDeliveryStatusEvent(payload)) {
    await prisma.whatsappMessage.updateMany({
      where: { providerMessageId: event.providerMessageId, whatsappDeviceId: device.id },
      data: { status: event.status },
    });
  }
  return NextResponse.json({ received: true });
}
