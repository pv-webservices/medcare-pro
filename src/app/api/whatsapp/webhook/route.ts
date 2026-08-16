import { jsonError, jsonOk } from "@/lib/apiHandler";
import { prisma } from "@/lib/prisma";
import { parseDeliveryStatusEvent, verifyWebhookToken } from "@/lib/whatsapp";

// WhatsApp delivery callback — PRD §6.9 (FR-9.2).
//
// Publicly reachable and unauthenticated by session. RkvRobo supports webhooks
// (the Devices page has a per-device "Webhook URL" field, and /info-devices
// reports `webhook`, `webhook_read`, `webhook_reject_call`, `webhook_typing`)
// but it does NOT sign them — the URL is simply pasted into their panel.
//
// So the verifiable secret is one we put in the URL ourselves. Register:
//
//     https://<your-app>/api/whatsapp/webhook?token=<WHATSAPP_WEBHOOK_TOKEN>
//
// Order is fixed by the secure-webhooks skill and is not negotiable:
//   1. Read the RAW body.
//   2. Verify BEFORE parsing or acting; 403 on failure. Fails closed when no
//      token is configured, so an unconfigured deployment accepts nothing.
//   3. Validate every field pulled from the payload.
//   4. Deduplicate by provider message id — callbacks get retried.
//   5. On a database failure, log and still return 200 for a valid payload; a
//      5xx just makes the provider retry and compounds the problem.

/** Never store a status string of unbounded length from an outside caller. */
const MAX_STATUS_LENGTH = 64;

export async function POST(request: Request) {
  // 1. Raw body first — read once, and never re-serialised.
  const rawBody = await request.text().catch(() => "");

  // 2. Verify before anything is parsed or acted on.
  if (!verifyWebhookToken(request.url, request.headers)) {
    return jsonError("Forbidden.", 403);
  }

  let payload: unknown = null;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // Malformed JSON is the caller's bug, not ours; 400 does not trigger the
    // retry storm a 5xx would.
    return jsonError("Malformed webhook body.", 400);
  }

  // 3. Only strictly-validated shapes produce events.
  const events = parseDeliveryStatusEvent(payload);

  if (events.length === 0) {
    // The provider does not document its payload. Log the top-level KEY NAMES
    // only — never the values, which carry phone numbers and message text —
    // so the real shape can be mapped from a live sample and added to
    // parseDeliveryStatusEvent. 200, because the payload itself was fine.
    const shape =
      typeof payload === "object" && payload !== null
        ? Object.keys(payload as Record<string, unknown>).join(",")
        : typeof payload;
    console.info(`WhatsApp webhook: unrecognised payload shape [${shape}]`);

    return jsonOk({ received: true, applied: 0 });
  }

  let applied = 0;
  for (const event of events) {
    try {
      // 4. Idempotent by construction: updateMany on the unique provider id
      // touches one row or none, so a replayed callback is a no-op rather than
      // a duplicate. An id we never sent matches nothing.
      const { count } = await prisma.whatsappMessage.updateMany({
        where: { providerMessageId: event.providerMessageId },
        data: { status: event.status.slice(0, MAX_STATUS_LENGTH) },
      });
      applied += count;
    } catch (error: unknown) {
      // 5. Logged, but still a 200 below.
      console.error("Could not apply WhatsApp delivery status", error);
    }
  }

  return jsonOk({ received: true, applied });
}
