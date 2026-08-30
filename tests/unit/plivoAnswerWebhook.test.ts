import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/webhooks/plivo/answer/route";
import { STAGE_1_GREETING } from "@/lib/telephony/plivo";

const WEBHOOK_URL = "https://medcare-tunnel.example/api/webhooks/plivo/answer";
const AUTH_TOKEN = "unit-test-plivo-auth-token";
const NONCE = "1700000000000";
const PARAMS = {
  CallUUID: "call-uuid-123",
  From: "12025550123",
  To: "12025550999",
};

const originalAuthToken = process.env.PLIVO_AUTH_TOKEN;

function createV3Signature(): string {
  const sortedParams = Object.keys(PARAMS)
    .sort()
    .map((key) => `${key}${PARAMS[key as keyof typeof PARAMS]}`)
    .join("");

  // Plivo's V3 POST base string for a URL with no query parameters.
  return createHmac("sha256", AUTH_TOKEN)
    .update(`${WEBHOOK_URL}?${sortedParams}.${NONCE}`)
    .digest("base64");
}

function request(headers: Record<string, string> = {}): Request {
  return new Request(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body: new URLSearchParams(PARAMS),
  });
}

function signedRequest(): Request {
  return request({
    "X-Plivo-Signature-V3": createV3Signature(),
    "X-Plivo-Signature-V3-Nonce": NONCE,
  });
}

describe("POST /api/webhooks/plivo/answer", () => {
  beforeEach(() => {
    process.env.PLIVO_AUTH_TOKEN = AUTH_TOKEN;
  });

  afterEach(() => {
    if (originalAuthToken === undefined) {
      delete process.env.PLIVO_AUTH_TOKEN;
    } else {
      process.env.PLIVO_AUTH_TOKEN = originalAuthToken;
    }
  });

  it("rejects a request with no Plivo signature", async () => {
    const response = await POST(
      request({ "X-Plivo-Signature-V3-Nonce": NONCE }),
    );

    expect(response.status).toBe(403);
  });

  it("rejects a request with no Plivo nonce", async () => {
    const response = await POST(
      request({ "X-Plivo-Signature-V3": createV3Signature() }),
    );

    expect(response.status).toBe(403);
  });

  it("rejects an invalid Plivo signature", async () => {
    const response = await POST(
      request({
        "X-Plivo-Signature-V3": "not-a-valid-signature",
        "X-Plivo-Signature-V3-Nonce": NONCE,
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain(STAGE_1_GREETING);
  });

  it("fails closed when PLIVO_AUTH_TOKEN is absent", async () => {
    delete process.env.PLIVO_AUTH_TOKEN;

    const response = await POST(signedRequest());

    expect(response.status).toBe(503);
  });

  it("returns Plivo XML for a legitimately signed webhook", async () => {
    const response = await POST(signedRequest());
    const xml = await response.text();

    expect(response.status).toBe(200);
    expect(xml).toContain("<Response>");
    expect(xml).toContain("<Speak>");
  });

  it("returns the XML content type", async () => {
    const response = await POST(signedRequest());

    expect(response.headers.get("content-type")).toBe(
      "application/xml; charset=utf-8",
    );
  });

  it("contains only the fixed Stage 1 greeting flow", async () => {
    const response = await POST(signedRequest());
    const xml = await response.text();

    expect(xml).toContain(STAGE_1_GREETING);
    expect(xml).not.toContain("GetInput");
    expect(xml).not.toContain("Dial");
  });

  it("never returns the Plivo Auth Token", async () => {
    const validResponse = await POST(signedRequest());
    const invalidResponse = await POST(
      request({
        "X-Plivo-Signature-V3": "invalid",
        "X-Plivo-Signature-V3-Nonce": NONCE,
      }),
    );

    expect(await validResponse.text()).not.toContain(AUTH_TOKEN);
    expect(await invalidResponse.text()).not.toContain(AUTH_TOKEN);
  });
});
