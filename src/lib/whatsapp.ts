/**
 * WhatsApp gateway client — FR-9.1 / FR-9.2.
 *
 * Provider: **RkvRobo** (`https://bot.rkvrobo.in/api`).
 *
 * NOT the Meta Cloud API and NOT an official BSP: RkvRobo drives real WhatsApp
 * devices through its own portal. Two consequences the rest of the app is built
 * around:
 *
 *   1. **No provider-side template approval.** The gateway accepts arbitrary
 *      text, so the "approved set" is ours — see lib/whatsappTemplates.
 *   2. **Auth is a body/query parameter**, not a header or a session. The API
 *      answers server-to-server with no cookie handling.
 *
 * Response contract, confirmed against the live API:
 *   success  {"status": true,  "msg": "Message sent successfully!"}
 *   failure  {"status": false, "msg": "Invalid API key. ..."}   HTTP 400
 * Auth is checked before parameter validation, so a bad key masks every other
 * error — worth knowing when a call fails for no obvious reason. Note `msg` is
 * NOT always a string: check-number returns an object there, so nothing here
 * assumes its type.
 *
 * With `full=1` a send also returns `data.key.id`, the WhatsApp message id.
 * Always requested, so `whatsapp_messages.provider_message_id` is populated and
 * delivery callbacks can be deduplicated.
 *
 * Endpoint slugs are verified live — several differ from their doc-page titles:
 *   "Communicating SMS" IS /send-message (the same endpoint, documented twice)
 *   "Device Info"  → /info-devices      "User Info"      → /info-user
 *   "Generate QR"  → /generate-qr       "Text To Channel"→ /send-text-channel
 */

const SEND_TEXT_PATH = "/send-message";
const SEND_MEDIA_PATH = "/send-media";
const CHECK_NUMBER_PATH = "/check-number";
const DEVICE_INFO_PATH = "/info-devices";
const GENERATE_QR_PATH = "/generate-qr";
const LOGOUT_DEVICE_PATH = "/logout-device";
const DELETE_DEVICE_PATH = "/delete-device";

const DEFAULT_BASE_URL = "https://bot.rkvrobo.in/api";

/** A call that hangs must not hold a request open indefinitely. */
const REQUEST_TIMEOUT_MS = 20000;

export const MEDIA_TYPES = ["image", "video", "audio", "document"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

/**
 * The gateway's own word for "send from whichever Rotate-ON device is next".
 *
 * Opt-in, never a default: rotation only works when at least one device has
 * Rotate switched ON in the RkvRobo panel. Defaulting to it would make every
 * send fail on an account whose devices are all Rotate OFF, which is how they
 * arrive.
 */
export const ROTATE_SENDER = "rotate";

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
  constructor(message: string) {
    super(message);
    this.name = "WhatsappNotConfiguredError";
  }
}

/** @deprecated Runtime tenant sends resolve database-backed configuration. */
export function isWhatsappConfigured(): boolean {
  return (
    (process.env.WHATSAPP_BSP_API_KEY ?? "").trim() !== "" &&
    (process.env.WHATSAPP_BSP_SENDER ?? "").trim() !== ""
  );
}

/** @deprecated Kept only for the standalone legacy diagnostics scripts. */
export function readWhatsappConfig(): WhatsappConfig {
  const apiKey = (process.env.WHATSAPP_BSP_API_KEY ?? "").trim();
  const sender = (process.env.WHATSAPP_BSP_SENDER ?? "").trim();

  if (apiKey === "") {
    throw new WhatsappNotConfiguredError(
      "WhatsApp is not configured. Set WHATSAPP_BSP_API_KEY in the environment.",
    );
  }

  // Required, with no fallback. Every send names a device, and silently picking
  // one would send from a number the clinic did not choose.
  if (sender === "") {
    throw new WhatsappNotConfiguredError(
      "WhatsApp sending device is not set. Put the connected device's number in " +
        "WHATSAPP_BSP_SENDER, or \"rotate\" if a device has Rotate ON.",
    );
  }

  return {
    apiKey,
    // Trailing slash trimmed so path joining cannot produce a double slash.
    baseUrl: ((process.env.WHATSAPP_BSP_API_BASE_URL ?? "").trim() || DEFAULT_BASE_URL)
      .replace(/\/+$/, ""),
    sender,
  };
}

interface GatewayResponse {
  ok: boolean;
  /** The parsed body, for callers that need more than status + message. */
  payload: Record<string, unknown> | null;
  /** Always a string for display, even when the gateway put an object in `msg`. */
  message: string;
}

/** Reads `msg` without assuming it is a string — check-number returns an object. */
function readMessage(body: Record<string, unknown>, ok: boolean): string {
  if (typeof body.msg === "string" && body.msg.trim() !== "") {
    return body.msg.trim();
  }
  // `message` rather than `msg` on the device endpoints.
  if (typeof body.message === "string" && body.message.trim() !== "") {
    return body.message.trim();
  }
  return ok ? "Done." : "The WhatsApp gateway rejected the request.";
}

/**
 * One POST to the gateway.
 *
 * POST rather than GET even though both are supported: a message body in a
 * query string ends up in access logs and proxy history, and these carry
 * patient phone numbers.
 *
 * Never throws for a rejected call — a refusal is data to record, not an
 * exception. Only a missing configuration throws.
 */
async function post(
  path: string,
  fields: Record<string, string | number>,
  suppliedConfig?: WhatsappConfig,
): Promise<GatewayResponse> {
  const config = suppliedConfig ?? readWhatsappConfig();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: config.apiKey,
        sender: config.sender,
        ...fields,
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    const parsed: unknown = await response.json().catch(() => null);

    if (typeof parsed !== "object" || parsed === null) {
      return {
        ok: false,
        payload: null,
        message: "The WhatsApp gateway returned an unreadable response.",
      };
    }

    const body = parsed as Record<string, unknown>;
    // The gateway answers 400 with a JSON reason, so the body decides the
    // outcome — but a non-JSON 5xx still lands above as a failure.
    const ok = body.status === true && response.ok;

    return { ok, payload: body, message: readMessage(body, ok) };
  } catch (error: unknown) {
    if (error instanceof WhatsappNotConfiguredError) {
      throw error;
    }

    const aborted = error instanceof Error && error.name === "AbortError";
    // Deliberately not logging the payload: it carries a patient's number and
    // message body (see the secure-webhooks skill on data handling).
    console.error(`WhatsApp call failed (${path})`, aborted ? "timeout" : error);

    return {
      ok: false,
      payload: null,
      message: aborted
        ? "The WhatsApp gateway did not respond in time."
        : "Could not reach the WhatsApp gateway.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

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

/** Digs out data.key.id defensively — any level may be missing or mistyped. */
function readMessageId(payload: Record<string, unknown> | null): string | null {
  if (payload === null) {
    return null;
  }

  const data = payload.data;
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const key = (data as Record<string, unknown>).key;
  if (typeof key !== "object" || key === null) {
    return null;
  }

  const id = (key as Record<string, unknown>).id;
  return typeof id === "string" && id.trim() !== "" ? id.trim() : null;
}

async function send(
  path: string,
  fields: Record<string, string | number>,
  config?: WhatsappConfig,
): Promise<SendResult> {
  // full=1 asks for the whole WhatsApp payload so `data.key.id` comes back.
  const response = await post(path, { full: 1, ...fields }, config);

  return {
    ok: response.ok,
    providerMessageId: readMessageId(response.payload),
    message: response.message,
  };
}

export async function sendText(
  params: SendTextParams,
  config?: WhatsappConfig,
): Promise<SendResult> {
  return send(SEND_TEXT_PATH, {
    number: params.to,
    message: params.message,
    ...(params.footer ? { footer: params.footer } : {}),
  }, config);
}

export async function sendMedia(
  params: SendMediaParams,
  config?: WhatsappConfig,
): Promise<SendResult> {
  return send(SEND_MEDIA_PATH, {
    number: params.to,
    media_type: params.mediaType,
    url: params.mediaUrl,
    caption: params.message,
    ...(params.footer ? { footer: params.footer } : {}),
  }, config);
}

// ---------------------------------------------------------------------------
// Pre-flight checks
// ---------------------------------------------------------------------------

export interface NumberCheck {
  /** True only when the gateway positively confirms a WhatsApp account. */
  exists: boolean;
  /** False when the check itself could not be completed. */
  checked: boolean;
  message: string;
}

/**
 * Is this number actually on WhatsApp?
 *
 * `{"status":true,"msg":{"exists":true,"jid":"...@s.whatsapp.net"}}`.
 *
 * Run before each send. Messaging numbers that are not on WhatsApp is one of
 * the patterns that gets a sending number flagged, and the front desk gets a
 * far more useful failure than the gateway's generic one.
 *
 * A check that cannot be completed reports `checked: false` rather than
 * `exists: false` — a gateway hiccup must not be read as "this patient has no
 * WhatsApp", which would silently stop messaging a real person.
 */
export async function checkNumber(
  to: string,
  config?: WhatsappConfig,
): Promise<NumberCheck> {
  const response = await post(CHECK_NUMBER_PATH, { number: to }, config);

  if (!response.ok) {
    return { exists: false, checked: false, message: response.message };
  }

  const msg = response.payload?.msg;

  // The LIVE api answers `{"status":true,"msg":true}` — a plain boolean. Its
  // docs show `{"msg":{"exists":true,"jid":"…"}}` instead, so both are handled:
  // the boolean because that is what actually comes back, the object so a
  // future correction to match their docs does not silently break the check.
  const exists =
    typeof msg === "boolean"
      ? msg
      : typeof msg === "object" && msg !== null
        ? (msg as Record<string, unknown>).exists === true
        : null;

  if (exists === null) {
    // status:true but an unrecognised body — unverified, NOT absent.
    return { exists: false, checked: false, message: response.message };
  }

  return {
    exists,
    checked: true,
    message: exists ? "On WhatsApp." : "This number is not on WhatsApp.",
  };
}

export interface DeviceStatus {
  /** The gateway's own word, e.g. "Connected" / "Disconnect". */
  status: string;
  connected: boolean;
  /** The webhook URL currently registered for this device, if any. */
  webhookUrl: string | null;
  messagesSent: number | null;
}

/**
 * Is the sending device connected?
 *
 * `{"status":true,"info":[{ ..., "status":"Disconnect", "webhook":null }]}`.
 *
 * Shown on the Messages page so "nothing is sending" is answerable before a
 * batch of failures rather than after.
 */
export type DeviceProbe =
  | { ok: true; device: DeviceStatus }
  | { ok: false; message: string };

export async function getDeviceStatus(config?: WhatsappConfig): Promise<DeviceProbe> {
  const resolvedConfig = config ?? readWhatsappConfig();

  // Rotation has no single device to report on — the gateway picks per send.
  if (resolvedConfig.sender === ROTATE_SENDER) {
    return {
      ok: false,
      message: "Sending device is set to rotate, so there is no single device to report on.",
    };
  }

  const response = await post(
    DEVICE_INFO_PATH,
    { number: resolvedConfig.sender },
    resolvedConfig,
  );

  if (!response.ok) {
    // The gateway's own wording is far more useful than a generic failure —
    // "The number you are trying to reach does not exist, or you do not have
    // permission." is what a sender in the wrong FORMAT looks like.
    return { ok: false, message: response.message };
  }

  if (!Array.isArray(response.payload?.info) || response.payload.info.length === 0) {
    return { ok: false, message: "The gateway reported no device for that number." };
  }

  const entry = response.payload.info[0];
  if (typeof entry !== "object" || entry === null) {
    return { ok: false, message: "The gateway returned an unreadable device record." };
  }

  const row = entry as Record<string, unknown>;
  const status = typeof row.status === "string" ? row.status : "Unknown";

  return {
    ok: true,
    device: {
      status,
      // The gateway writes "Connected"; anything else is treated as not ready.
      connected: status.toLowerCase().startsWith("connect"),
      webhookUrl:
        typeof row.webhook === "string" && row.webhook !== "" ? row.webhook : null,
      messagesSent: typeof row.message_sent === "number" ? row.message_sent : null,
    },
  };
}

export type DeviceQrResult =
  | { ok: true; qr: string; message: string }
  | { ok: false; message: string };

/** Starts QR onboarding. Only the QR material is returned; credentials stay server-side. */
export async function generateDeviceQr(
  config: WhatsappConfig,
  phoneNumber: string,
): Promise<DeviceQrResult> {
  const response = await post(
    GENERATE_QR_PATH,
    { device: phoneNumber, force: "true" },
    { ...config, sender: phoneNumber },
  );
  if (!response.ok || !response.payload) {
    return { ok: false, message: response.message };
  }
  const data = response.payload.data;
  const qrCandidates = [
    response.payload.qr,
    response.payload.qrcode,
    response.payload.qr_code,
    typeof data === "object" && data !== null ? (data as Record<string, unknown>).qr : null,
  ];
  const qr = qrCandidates.find(
    (candidate): candidate is string => typeof candidate === "string" && candidate.trim() !== "",
  );
  return qr
    ? { ok: true, qr: qr.trim(), message: response.message }
    : { ok: false, message: "The gateway did not return a QR code." };
}

export async function logoutDevice(config: WhatsappConfig): Promise<GatewayResponse> {
  return post(LOGOUT_DEVICE_PATH, { device: config.sender }, config);
}

export async function deleteDevice(config: WhatsappConfig): Promise<GatewayResponse> {
  return post(DELETE_DEVICE_PATH, { device: config.sender }, config);
}

// ---------------------------------------------------------------------------
// Delivery-status callback
// ---------------------------------------------------------------------------

/**
 * RkvRobo DOES support webhooks — the Devices page carries a per-device
 * "Webhook URL" field, and `/info-devices` reports `webhook`, `webhook_read`,
 * `webhook_reject_call` and `webhook_typing` flags.
 *
 * What it does NOT provide is a signature. The URL is simply pasted into their
 * panel, so the only thing we can verify is something we put in the URL
 * ourselves: a secret token, compared in constant time.
 *
 * That is a real check, not a stub — the secure-webhooks skill forbids skipping
 * verification, and this satisfies it with the strongest scheme the provider
 * makes possible. Register the URL as:
 *
 *     https://<your-app>/api/whatsapp/webhook?token=<WHATSAPP_WEBHOOK_TOKEN>
 *
 * With no token configured it fails CLOSED, so an unconfigured deployment
 * rejects everything rather than accepting anonymous posts.
 */
export function verifyWebhookToken(requestUrl: string, headers: Headers): boolean {
  const expected = (process.env.WHATSAPP_WEBHOOK_TOKEN ?? "").trim();

  if (expected === "") {
    return false;
  }

  // The token travels in the URL because a pasted URL is all the provider's
  // panel accepts. A header is honoured too, in case it ever becomes settable.
  let presented = headers.get("x-webhook-token")?.trim() ?? "";

  if (presented === "") {
    try {
      presented = new URL(requestUrl).searchParams.get("token")?.trim() ?? "";
    } catch {
      presented = "";
    }
  }

  return timingSafeEqual(presented, expected);
}

/** Constant-time comparison, so a wrong token cannot be guessed byte by byte. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

export interface DeliveryStatusEvent {
  providerMessageId: string;
  status: string;
}

/**
 * Normalises a delivery callback into what gets written to `whatsapp_messages`.
 *
 * The provider does not document its webhook payload, so only shapes evidenced
 * by its OWN send responses are recognised — Baileys-style `data.key.id`, and
 * the `{tag:"ack", attrs:{id}}` form its channel-send response returns. Every
 * field is validated; anything unrecognised yields an empty list rather than a
 * guess, and the route logs the payload's key names (never its contents) so the
 * real shape can be mapped once seen.
 */
export function parseDeliveryStatusEvent(
  payload: unknown,
): readonly DeliveryStatusEvent[] {
  if (typeof payload !== "object" || payload === null) {
    return [];
  }

  const events: DeliveryStatusEvent[] = [];
  const body = payload as Record<string, unknown>;

  const push = (id: unknown, status: unknown) => {
    if (typeof id !== "string" || id.trim() === "") {
      return;
    }
    const text =
      typeof status === "string" && status.trim() !== ""
        ? status.trim()
        : typeof status === "number"
          ? String(status)
          : "delivered";
    events.push({ providerMessageId: id.trim(), status: text });
  };

  // Shape A — the send response's own form: { data: { key: { id }, status } }
  const data = body.data;
  if (typeof data === "object" && data !== null) {
    const inner = data as Record<string, unknown>;
    const key = inner.key;
    if (typeof key === "object" && key !== null) {
      push((key as Record<string, unknown>).id, inner.status ?? body.status);
    }

    // Shape B — the ack form: { data: { tag: "ack", attrs: { id } } }
    if (inner.tag === "ack") {
      const attrs = inner.attrs;
      if (typeof attrs === "object" && attrs !== null) {
        push((attrs as Record<string, unknown>).id, "ack");
      }
    }
  }

  // Shape C — flat RkvRobo shape: { event, message_id, status }
  const event = body.event;
  const messageId = body.message_id;
  if (typeof event === "string" && typeof messageId === "string" && messageId.trim() !== "") {
    if (event !== "message") {
      push(messageId, body.status ?? event);
    }
  }

  return events;
}
