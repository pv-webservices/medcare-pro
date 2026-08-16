/**
 * WhatsApp gateway client — FR-9.1 / FR-9.2.
 *
 * Provider: **RkvRobo** (`https://bot.rkvrobo.in/api`).
 *
 * This is NOT the Meta Cloud API and NOT an official BSP. RkvRobo drives real
 * WhatsApp devices through its own portal, which has three consequences the
 * rest of the app is built around:
 *
 *   1. **No provider-side template approval.** The gateway accepts arbitrary
 *      text. The "approved set" is therefore ours — see lib/whatsappTemplates
 *      — and nothing here takes a caller-supplied body without a template
 *      behind it.
 *   2. **No delivery-status callback.** The provider exposes no webhook and no
 *      status lookup (verified against the live API: `webhook`, `callback`,
 *      `message-status` and `get-status` are all 404). A send is therefore
 *      known only as accepted or rejected AT THE GATEWAY. Nothing in this app
 *      may present that as a WhatsApp delivered/read receipt.
 *   3. **Auth is a query/body parameter**, not a header or a session. The API
 *      is reachable server-to-server with no cookie handling.
 *
 * Response contract, confirmed against the live API:
 *   success  {"status": true,  "msg": "Message sent successfully!"}
 *   failure  {"status": false, "msg": "Invalid API key. ..."}   HTTP 400
 * Auth is checked before parameter validation, so a bad key masks every other
 * error — worth knowing when a send fails for no obvious reason.
 *
 * With `full=1` the success payload also carries `data.key.id`, the WhatsApp
 * message id. Always requested, so `whatsapp_messages.provider_message_id` is
 * populated and a future delivery callback could be made idempotent.
 */

/** Endpoint slugs, verified live. Every one below answers 400 to a bad key. */
const SEND_TEXT_PATH = "/send-message";
const SEND_MEDIA_PATH = "/send-media";

const DEFAULT_BASE_URL = "https://bot.rkvrobo.in/api";

/**
 * The account has more than one connected device, so the default is `rotate`:
 * the gateway picks the next connected Rotate-ON device for each send. That
 * spreads traffic across the numbers instead of concentrating it on one, which
 * is the practical protection against a single number being flagged. Set
 * WHATSAPP_BSP_SENDER to a specific number to pin sends to one device.
 */
const DEFAULT_SENDER = "rotate";

/** A send that hangs must not hold a request open indefinitely. */
const REQUEST_TIMEOUT_MS = 20000;

export const MEDIA_TYPES = ["image", "video", "audio", "document"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export interface WhatsappConfig {
  apiKey: string;
  baseUrl: string;
  sender: string;
}

/**
 * Thrown when the gateway is not configured. Distinct from a send failure: the
 * fix is an environment variable, not a retry.
 */
export class WhatsappNotConfiguredError extends Error {
  constructor() {
    super(
      "WhatsApp is not configured. Set WHATSAPP_BSP_API_KEY in the environment.",
    );
    this.name = "WhatsappNotConfiguredError";
  }
}

/** True when a send could even be attempted — used to explain the UI's state. */
export function isWhatsappConfigured(): boolean {
  return (process.env.WHATSAPP_BSP_API_KEY ?? "").trim() !== "";
}

export function readWhatsappConfig(): WhatsappConfig {
  const apiKey = (process.env.WHATSAPP_BSP_API_KEY ?? "").trim();

  if (apiKey === "") {
    throw new WhatsappNotConfiguredError();
  }

  return {
    apiKey,
    // Trailing slash trimmed so path joining cannot produce a double slash.
    baseUrl: ((process.env.WHATSAPP_BSP_API_BASE_URL ?? "").trim() || DEFAULT_BASE_URL)
      .replace(/\/+$/, ""),
    sender: (process.env.WHATSAPP_BSP_SENDER ?? "").trim() || DEFAULT_SENDER,
  };
}

export interface SendTextParams {
  /** Destination in the gateway's format, e.g. 919812345678. */
  to: string;
  message: string;
  footer?: string;
}

export interface SendMediaParams extends SendTextParams {
  mediaType: MediaType;
  /** Direct link. The gateway rejects Drive/Dropbox-style share pages. */
  mediaUrl: string;
}

export interface SendResult {
  ok: boolean;
  /** `data.key.id` from the full response — the WhatsApp message id. */
  providerMessageId: string | null;
  /** The gateway's own `msg`, shown to the user verbatim when a send fails. */
  message: string;
}

/**
 * Narrows the gateway's response without trusting its shape.
 *
 * Everything is optional in practice: a proxy error page, an HTML 404 or a
 * truncated body all have to degrade to "failed with a readable reason" rather
 * than throwing somewhere further up.
 */
function readResponseBody(payload: unknown): {
  status: boolean;
  msg: string;
  providerMessageId: string | null;
} {
  if (typeof payload !== "object" || payload === null) {
    return { status: false, msg: "The WhatsApp gateway returned an unreadable response.", providerMessageId: null };
  }

  const body = payload as Record<string, unknown>;
  const status = body.status === true;
  const msg =
    typeof body.msg === "string" && body.msg.trim() !== ""
      ? body.msg.trim()
      : status
        ? "Message sent successfully!"
        : "The WhatsApp gateway rejected the message.";

  // data.key.id, defensively — any level may be missing or the wrong type.
  const data = body.data;
  let providerMessageId: string | null = null;
  if (typeof data === "object" && data !== null) {
    const key = (data as Record<string, unknown>).key;
    if (typeof key === "object" && key !== null) {
      const id = (key as Record<string, unknown>).id;
      if (typeof id === "string" && id.trim() !== "") {
        providerMessageId = id.trim();
      }
    }
  }

  return { status, msg, providerMessageId };
}

/**
 * One POST to the gateway.
 *
 * POST rather than GET even though both are supported: a message body in a
 * query string ends up in access logs and proxy history, and these carry
 * patient phone numbers.
 *
 * Never throws for a rejected send — a failed send is data to record against
 * the message, not an exception. Only a missing configuration throws.
 */
async function post(
  path: string,
  fields: Record<string, string>,
): Promise<SendResult> {
  const config = readWhatsappConfig();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: config.apiKey,
        sender: config.sender,
        // Asks for the full payload so `data.key.id` comes back.
        full: 1,
        ...fields,
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    const payload: unknown = await response.json().catch(() => null);
    const { status, msg, providerMessageId } = readResponseBody(payload);

    // The gateway answers 400 with a JSON reason, so the body decides the
    // outcome rather than the HTTP code — but a non-JSON 5xx still lands here
    // as a failure with a readable message.
    return { ok: status && response.ok, providerMessageId, message: msg };
  } catch (error: unknown) {
    if (error instanceof WhatsappNotConfiguredError) {
      throw error;
    }

    const aborted = error instanceof Error && error.name === "AbortError";
    // Deliberately not logging the payload: it carries a patient's number and
    // message body (see the secure-webhooks skill on data handling).
    console.error(`WhatsApp send failed (${path})`, aborted ? "timeout" : error);

    return {
      ok: false,
      providerMessageId: null,
      message: aborted
        ? "The WhatsApp gateway did not respond in time."
        : "Could not reach the WhatsApp gateway.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendText(params: SendTextParams): Promise<SendResult> {
  return post(SEND_TEXT_PATH, {
    number: params.to,
    message: params.message,
    ...(params.footer ? { footer: params.footer } : {}),
  });
}

export async function sendMedia(params: SendMediaParams): Promise<SendResult> {
  return post(SEND_MEDIA_PATH, {
    number: params.to,
    media_type: params.mediaType,
    url: params.mediaUrl,
    caption: params.message,
    ...(params.footer ? { footer: params.footer } : {}),
  });
}

// ---------------------------------------------------------------------------
// Delivery-status callback — not offered by this provider
// ---------------------------------------------------------------------------

/**
 * Verifies an inbound webhook's signature before its body is parsed.
 *
 * RkvRobo exposes no delivery-status callback, so there is no scheme to
 * implement and this stays fail-closed. Per the secure-webhooks skill it must
 * NEVER be stubbed to return `true` "for now" — a skipped check has a way of
 * surviving into production. If the provider adds callbacks, implement their
 * documented scheme here and nowhere else.
 */
export function verifyWebhookSignature(
  _rawBody: string,
  _headers: Headers,
): boolean {
  throw new Error(
    "Not implemented — RkvRobo exposes no delivery-status webhook.",
  );
}

export interface DeliveryStatusEvent {
  providerMessageId: string;
  status: string;
}

export function parseDeliveryStatusEvent(
  _payload: unknown,
): readonly DeliveryStatusEvent[] {
  throw new Error(
    "Not implemented — RkvRobo exposes no delivery-status webhook.",
  );
}
