import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/webhooks/plivo/answer/route";
import { STAGE_1_GREETING } from "@/lib/telephony/plivo";
import {
  buildPlivoWebhookRequest,
  buildSignedPlivoWebhookRequest,
  createPlivoTestNonce,
  createPlivoV3PostSignature,
  REALISTIC_ANSWER_PARAMS,
  TEST_PLIVO_AUTH_TOKEN,
} from "../helpers/plivo";

const WEBHOOK_URL = "https://medcare-tunnel.example/api/webhooks/plivo/answer";
const originalAuthToken = process.env.PLIVO_AUTH_TOKEN;

describe("POST /api/webhooks/plivo/answer", () => {
  beforeEach(() => {
    process.env.PLIVO_AUTH_TOKEN = TEST_PLIVO_AUTH_TOKEN;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalAuthToken === undefined) {
      delete process.env.PLIVO_AUTH_TOKEN;
    } else {
      process.env.PLIVO_AUTH_TOKEN = originalAuthToken;
    }
  });

  it("accepts a legitimately generated V3 signature with realistic parameters", async () => {
    const response = await POST(
      buildSignedPlivoWebhookRequest({
        url: WEBHOOK_URL,
        params: REALISTIC_ANSWER_PARAMS,
      }),
    );

    expect(response.status).toBe(200);
  });

  it("rejects an invalid Plivo signature", async () => {
    const response = await POST(
      buildSignedPlivoWebhookRequest({
        url: WEBHOOK_URL,
        headers: { "X-Plivo-Signature-V3": "not-a-valid-signature" },
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain(STAGE_1_GREETING);
  });

  it("rejects a request with no Plivo signature", async () => {
    const response = await POST(
      buildPlivoWebhookRequest({
        url: WEBHOOK_URL,
        headers: { "X-Plivo-Signature-V3-Nonce": createPlivoTestNonce() },
      }),
    );

    expect(response.status).toBe(403);
  });

  it("rejects a request with no Plivo nonce", async () => {
    const nonce = createPlivoTestNonce();
    const signature = createPlivoV3PostSignature({
      url: WEBHOOK_URL,
      nonce,
      authToken: TEST_PLIVO_AUTH_TOKEN,
      params: REALISTIC_ANSWER_PARAMS,
    });
    const response = await POST(
      buildPlivoWebhookRequest({
        url: WEBHOOK_URL,
        headers: { "X-Plivo-Signature-V3": signature },
      }),
    );

    expect(response.status).toBe(403);
  });

  it("fails closed when PLIVO_AUTH_TOKEN is absent", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    delete process.env.PLIVO_AUTH_TOKEN;

    const response = await POST(
      buildSignedPlivoWebhookRequest({ url: WEBHOOK_URL }),
    );

    expect(response.status).toBe(503);
  });

  it("rejects malformed form data", async () => {
    const response = await POST(
      new Request(WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Plivo-Signature-V3": "signature-is-not-trusted-before-parsing",
          "X-Plivo-Signature-V3-Nonce": createPlivoTestNonce(),
        },
        body: JSON.stringify({ CallUUID: REALISTIC_ANSWER_PARAMS.CallUUID }),
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain(STAGE_1_GREETING);
  });

  it("accepts signed unexpected and repeated form parameters", async () => {
    const response = await POST(
      buildSignedPlivoWebhookRequest({
        url: WEBHOOK_URL,
        params: {
          ...REALISTIC_ANSWER_PARAMS,
          ExtraProviderField: "future-compatible",
          RepeatedField: ["second", "first"],
        },
      }),
    );

    expect(response.status).toBe(200);
  });

  it("includes query-string parameters in signature validation", async () => {
    const url = `${WEBHOOK_URL}?attempt=1&source=local-harness`;
    const response = await POST(buildSignedPlivoWebhookRequest({ url }));

    expect(response.status).toBe(200);
  });

  it("rejects a signature generated for a different exact URL", async () => {
    const response = await POST(
      buildSignedPlivoWebhookRequest({
        url: `${WEBHOOK_URL}?source=actual`,
        signatureUrl: `${WEBHOOK_URL}?source=signed`,
      }),
    );

    expect(response.status).toBe(403);
  });

  it("returns valid Stage 1 Plivo XML and the XML content type", async () => {
    const response = await POST(
      buildSignedPlivoWebhookRequest({ url: WEBHOOK_URL }),
    );
    const xml = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/xml; charset=utf-8",
    );
    expect(xml).toMatch(/^<Response>/);
    expect(xml).toContain(`<Speak>${STAGE_1_GREETING}</Speak>`);
    expect(xml).toMatch(/<\/Response>$/);
  });

  it("contains only the fixed Stage 1 greeting flow", async () => {
    const response = await POST(
      buildSignedPlivoWebhookRequest({ url: WEBHOOK_URL }),
    );
    const xml = await response.text();

    expect(xml).toContain(STAGE_1_GREETING);
    expect(xml).not.toContain("GetInput");
    expect(xml).not.toContain("Dial");
  });

  it("never returns the Plivo Auth Token", async () => {
    const validResponse = await POST(
      buildSignedPlivoWebhookRequest({ url: WEBHOOK_URL }),
    );
    const invalidResponse = await POST(
      buildSignedPlivoWebhookRequest({
        url: WEBHOOK_URL,
        headers: { "X-Plivo-Signature-V3": "invalid" },
      }),
    );

    expect(await validResponse.text()).not.toContain(TEST_PLIVO_AUTH_TOKEN);
    expect(await invalidResponse.text()).not.toContain(TEST_PLIVO_AUTH_TOKEN);
  });
});
