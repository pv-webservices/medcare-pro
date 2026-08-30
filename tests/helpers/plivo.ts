import { createHmac, randomBytes } from "node:crypto";

export type PlivoFormParams = Record<string, string | readonly string[]>;

export const TEST_PLIVO_AUTH_TOKEN = "unit-test-plivo-auth-token";

export const REALISTIC_ANSWER_PARAMS = {
  CallUUID: "4f7b0f40-4c0a-11ef-b5d8-0242ac120002",
  From: "14155550100",
  To: "14155550199",
  CallStatus: "ringing",
  Direction: "inbound",
} as const;

export function createPlivoTestNonce(): string {
  return randomBytes(16).toString("hex");
}

function sortedQueryString(url: URL): string {
  const valuesByKey = new Map<string, string[]>();

  for (const [key, value] of url.searchParams) {
    const values = valuesByKey.get(key) ?? [];
    values.push(value);
    valuesByKey.set(key, values);
  }

  return [...valuesByKey.keys()]
    .sort()
    .flatMap((key) =>
      (valuesByKey.get(key) ?? [])
        .slice()
        .sort()
        .map((value) => `${key}=${value}`),
    )
    .join("&");
}

function sortedPostParams(params: PlivoFormParams): string {
  return Object.keys(params)
    .sort()
    .flatMap((key) => {
      const value = params[key];
      const values = Array.isArray(value) ? [...value].sort() : [value];
      return values.map((entry) => `${key}${entry}`);
    })
    .join("");
}

/** Generates a V3 POST signature using Plivo's documented canonicalization. */
export function createPlivoV3PostSignature({
  url,
  nonce,
  authToken,
  params,
}: {
  url: string;
  nonce: string;
  authToken: string;
  params: PlivoFormParams;
}): string {
  const parsedUrl = new URL(url);
  const query = sortedQueryString(parsedUrl);
  const postParams = sortedPostParams(params);
  let baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}${parsedUrl.pathname}`;

  if (query !== "" || postParams !== "") {
    baseUrl += `?${query}`;
  }
  if (query !== "" && postParams !== "") {
    baseUrl += ".";
  }
  baseUrl += postParams;

  return createHmac("sha256", authToken)
    .update(`${baseUrl}.${nonce}`)
    .digest("base64");
}

function formBody(params: PlivoFormParams): URLSearchParams {
  const body = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    const values = Array.isArray(value) ? value : [value];
    for (const entry of values) {
      body.append(key, entry);
    }
  }

  return body;
}

export function buildPlivoWebhookRequest({
  url,
  params = REALISTIC_ANSWER_PARAMS,
  paramOverrides = {},
  headers = {},
}: {
  url: string;
  params?: PlivoFormParams;
  paramOverrides?: PlivoFormParams;
  headers?: Record<string, string>;
}): Request {
  const resolvedParams = { ...params, ...paramOverrides };

  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body: formBody(resolvedParams),
  });
}

export function buildSignedPlivoWebhookRequest({
  url,
  params = REALISTIC_ANSWER_PARAMS,
  paramOverrides = {},
  authToken = TEST_PLIVO_AUTH_TOKEN,
  nonce = createPlivoTestNonce(),
  signatureUrl = url,
  headers = {},
}: {
  url: string;
  params?: PlivoFormParams;
  paramOverrides?: PlivoFormParams;
  authToken?: string;
  nonce?: string;
  signatureUrl?: string;
  headers?: Record<string, string>;
}): Request {
  const resolvedParams = { ...params, ...paramOverrides };
  const signature = createPlivoV3PostSignature({
    url: signatureUrl,
    nonce,
    authToken,
    params: resolvedParams,
  });

  return buildPlivoWebhookRequest({
    url,
    params: resolvedParams,
    headers: {
      "X-Plivo-Signature-V3": signature,
      "X-Plivo-Signature-V3-Nonce": nonce,
      ...headers,
    },
  });
}
