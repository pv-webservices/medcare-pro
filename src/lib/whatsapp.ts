/**
 * WhatsApp messaging via a third-party BSP — FR-9.1 / FR-9.2.
 *
 * ============================================================================
 * STUB — BSP NOT YET SELECTED (PRD §10 Assumptions).
 *
 * NOT Meta Cloud API. v2 routes WhatsApp through a Business Solution Provider
 * whose auth scheme, payload shape, and webhook signature format are all
 * provider-specific and not yet known. Do not implement against Meta's
 * `X-Hub-Signature-256` scheme — that assumption is gone (see the
 * secure-webhooks skill).
 *
 * The signatures below are final; `api/whatsapp/send` and
 * `api/whatsapp/webhook` are written against them.
 *
 * `verifyWebhookSignature` throwing is deliberate and load-bearing: per the
 * secure-webhooks skill, an unimplemented signature check must fail closed. It
 * must never be stubbed to return `true` "for now" — a skipped check has a way
 * of surviving into production.
 * ============================================================================
 */

const NOT_IMPLEMENTED = "Not implemented — pending provider selection";

export interface SendTemplateMessageParams {
  /** E.164 destination, from `patients.mobile_number`. */
  to: string;
  /**
   * FR-9.1 — a BSP-approved template name. Free-text outbound messaging is not
   * permitted, so there is no `body` parameter here by design.
   */
  templateName: string;
  /** Ordered substitutions for the template's placeholders. */
  variables?: readonly string[];
}

export interface SendTemplateMessageResult {
  /**
   * The BSP's message id. Persisted to
   * `whatsapp_messages.provider_message_id` so delivery-status webhooks can be
   * made idempotent — providers retry, and the same event can arrive twice.
   */
  providerMessageId: string;
  /** Provider-reported initial status, stored verbatim. */
  status: string;
}

/** Sends one approved template message. Called by `api/whatsapp/send`. */
export async function sendTemplateMessage(
  _params: SendTemplateMessageParams,
): Promise<SendTemplateMessageResult> {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Verifies an inbound webhook's signature BEFORE its body is parsed or acted
 * on — `api/whatsapp/webhook` rejects with 403 when this returns false.
 *
 * Fails closed while unimplemented. See the file header.
 *
 * @param rawBody The exact unparsed request body; signatures are computed over
 *                the raw bytes, so re-serialising parsed JSON will not match.
 * @param headers The inbound request headers — the signature header's name is
 *                provider-specific, so it is resolved inside this function
 *                rather than being passed in.
 */
export function verifyWebhookSignature(
  _rawBody: string,
  _headers: Headers,
): boolean {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Normalises a BSP delivery-status callback into the fields written to
 * `whatsapp_messages`. Every field must be validated here, not assumed clean.
 */
export interface DeliveryStatusEvent {
  providerMessageId: string;
  status: string;
}

export function parseDeliveryStatusEvent(
  _payload: unknown,
): readonly DeliveryStatusEvent[] {
  throw new Error(NOT_IMPLEMENTED);
}
