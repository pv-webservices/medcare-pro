import { notImplemented } from "@/lib/utils";

// WhatsApp BSP delivery-status callback — PRD §6.9 (FR-9.2).
//
// Publicly reachable and unauthenticated by session. Per the secure-webhooks
// skill, in this order and no other:
//   1. Read the RAW body (signatures are computed over raw bytes — re-serialising
//      parsed JSON will not match).
//   2. verifyWebhookSignature() from @/lib/whatsapp; reject with 403 on failure,
//      before parsing or acting on anything.
//   3. Validate every field pulled from the payload.
//   4. Deduplicate by provider message id — BSPs retry, so the same event can
//      arrive twice.
//   5. On a database write failure, log and still return 200 if the payload was
//      valid; a 5xx triggers provider-side retries and compounds the problem.
//
// The signature scheme is provider-specific and the BSP is not yet chosen. Do
// not assume Meta's X-Hub-Signature-256 — that assumption is gone under v2.

export async function POST() {
  return notImplemented("POST /api/whatsapp/webhook");
}
