import { validateV3Signature } from "plivo";

const SIGNATURE_HEADER = "x-plivo-signature-v3";
const NONCE_HEADER = "x-plivo-signature-v3-nonce";

export type PlivoVerificationFailure =
  | "missing-configuration"
  | "missing-signature"
  | "missing-nonce"
  | "invalid-form-data"
  | "invalid-signature";

export type PlivoVerificationResult =
  | { ok: true }
  | { ok: false; reason: PlivoVerificationFailure };

type PlivoPostParams = Record<string, string | string[]>;

function toPlivoPostParams(formData: FormData): PlivoPostParams | null {
  const params: PlivoPostParams = {};

  for (const [key, value] of formData.entries()) {
    if (typeof value !== "string") {
      return null;
    }

    const existing = params[key];
    if (existing === undefined) {
      params[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      params[key] = [existing, value];
    }
  }

  return params;
}

/**
 * Validates a form-encoded Plivo Voice webhook before any fields are trusted.
 * `request.url` is intentionally passed through unchanged: V3 signatures bind
 * to the exact public URL Plivo requested, including its scheme and host.
 */
export async function verifyPlivoV3Webhook(
  request: Request,
  authToken = process.env.PLIVO_AUTH_TOKEN,
): Promise<PlivoVerificationResult> {
  const token = authToken?.trim() ?? "";
  if (token === "") {
    return { ok: false, reason: "missing-configuration" };
  }

  const signature = request.headers.get(SIGNATURE_HEADER)?.trim() ?? "";
  if (signature === "") {
    return { ok: false, reason: "missing-signature" };
  }

  const nonce = request.headers.get(NONCE_HEADER)?.trim() ?? "";
  if (nonce === "") {
    return { ok: false, reason: "missing-nonce" };
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return { ok: false, reason: "invalid-form-data" };
  }

  const params = toPlivoPostParams(formData);
  if (params === null) {
    return { ok: false, reason: "invalid-form-data" };
  }

  try {
    const valid = validateV3Signature(
      request.method,
      request.url,
      nonce,
      token,
      signature,
      params,
    );
    return valid === true
      ? { ok: true }
      : { ok: false, reason: "invalid-signature" };
  } catch {
    return { ok: false, reason: "invalid-signature" };
  }
}
