import { jsonError } from "@/lib/apiHandler";

// WhatsApp delivery-status callback — PRD §6.9 (FR-9.2).
//
// ============================================================================
// NOT AVAILABLE FROM THIS PROVIDER.
//
// RkvRobo exposes no delivery-status callback and no status lookup. Verified
// against the live API: /api/webhook, /api/callback, /api/message-status and
// /api/get-status all return 404, and none of the 20 documented endpoints is a
// callback. A send is therefore known only as accepted or rejected at the
// gateway, which is what `whatsapp_messages.status` records.
//
// The route is kept, and kept CLOSED, rather than deleted:
//
//   - Per the secure-webhooks skill, an unimplemented signature check must
//     fail closed. `verifyWebhookSignature` in @/lib/whatsapp throws for
//     exactly that reason and must never be stubbed to return true.
//   - Anything POSTing here today is not the provider, so refusing outright is
//     the correct answer — there is no signature scheme to check it against.
//
// If RkvRobo ever adds callbacks, the order is fixed by the skill and is not
// negotiable: read the RAW body, verify the signature and 403 on failure
// BEFORE parsing, validate every field, dedupe by provider message id, and
// return 200 on a valid payload even if the database write fails — a 5xx just
// makes the provider retry.
// ============================================================================

export async function POST() {
  // 501, not 403: nothing is being rejected for a bad signature — the feature
  // does not exist on the provider's side at all.
  return jsonError(
    "WhatsApp delivery-status callbacks are not supported by this provider.",
    501,
  );
}
