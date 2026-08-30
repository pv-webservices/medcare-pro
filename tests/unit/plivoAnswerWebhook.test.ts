import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/webhooks/plivo/answer/route";
import { buildMainMenuPrompt } from "@/lib/telephony/ivr";
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
const resolveClinic = vi.hoisted(() => vi.fn());

vi.mock("@/lib/telephony/clinicConfig", () => ({
  resolveInboundClinicByPlivoNumber: resolveClinic,
}));

const TEST_CLINIC = Object.freeze({
  clinicId: "clinic-a",
  tenantId: "tenant-a",
  clinicName: "Sunrise Clinic",
  timezone: "Asia/Kolkata",
  publicPhoneNumber: null,
  receptionPhoneNumber: null,
  urgentPhoneNumber: null,
});

describe("POST /api/webhooks/plivo/answer", () => {
  beforeEach(() => {
    process.env.PLIVO_AUTH_TOKEN = TEST_PLIVO_AUTH_TOKEN;
    resolveClinic.mockReset();
    resolveClinic.mockResolvedValue(TEST_CLINIC);
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

  it("accepts a valid signature among comma-separated V3 signatures", async () => {
    const request = buildSignedPlivoWebhookRequest({ url: WEBHOOK_URL });
    const validSignature = request.headers.get("X-Plivo-Signature-V3");

    expect(validSignature).not.toBeNull();
    request.headers.set(
      "X-Plivo-Signature-V3",
      `invalid-token-signature,${validSignature},another-invalid-signature`,
    );

    const response = await POST(request);

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
    expect(await response.text()).not.toContain("MedCare Pro");
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
    expect(await response.text()).not.toContain("MedCare Pro");
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

  it("returns valid Stage 2 Plivo XML and the XML content type", async () => {
    const response = await POST(
      buildSignedPlivoWebhookRequest({ url: WEBHOOK_URL }),
    );
    const xml = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/xml; charset=utf-8",
    );
    expect(xml).toMatch(/^<Response>/);
    expect(xml).toContain(`<Speak>${buildMainMenuPrompt("Sunrise Clinic")}</Speak>`);
    expect(xml).toMatch(/<\/Response>$/);
  });

  it("returns the documented one-digit DTMF GetInput menu", async () => {
    const response = await POST(
      buildSignedPlivoWebhookRequest({ url: WEBHOOK_URL }),
    );
    const xml = await response.text();

    expect(xml).toContain("<GetInput");
    expect(xml).toContain('inputType="dtmf"');
    expect(xml).toContain('numDigits="1"');
    expect(xml).toContain('method="POST"');
    expect(xml).toContain('digitEndTimeout="5"');
    expect(xml).toContain('executionTimeout="10"');
    expect(xml).toContain(
      'action="https://medcare-tunnel.example/api/webhooks/plivo/input"',
    );
    for (const digit of ["1", "2", "3", "4", "9"]) {
      expect(xml).toContain(`Press ${digit}`);
    }
    expect(xml).not.toContain("<Dial");
    expect(xml).not.toContain("<Record");
  });

  it("builds the input action from the signed public origin only", async () => {
    const publicUrl =
      "https://voice.medcare.example:8443/api/webhooks/plivo/answer?source=provider";
    const response = await POST(
      buildSignedPlivoWebhookRequest({
        url: publicUrl,
        paramOverrides: {
          action: "https://attacker.example/collect",
          callbackUrl: "https://attacker.example/callback",
        },
      }),
    );
    const xml = await response.text();

    expect(response.status).toBe(200);
    expect(xml).toContain(
      'action="https://voice.medcare.example:8443/api/webhooks/plivo/input"',
    );
    expect(xml).not.toContain("source=provider");
    expect(xml).not.toContain("attacker.example");
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

  it("uses the resolved clinic name rather than a platform-wide greeting", async () => {
    resolveClinic.mockResolvedValueOnce({
      ...TEST_CLINIC,
      clinicId: "clinic-b",
      clinicName: "Lakeside Clinic",
    });

    const response = await POST(
      buildSignedPlivoWebhookRequest({
        url: WEBHOOK_URL,
        paramOverrides: { To: "+14155550102" },
      }),
    );
    const xml = await response.text();

    expect(resolveClinic).toHaveBeenCalledWith("+14155550102");
    expect(xml).toContain("Welcome to Lakeside Clinic.");
    expect(xml).not.toContain("Welcome to Sunrise Clinic.");
  });

  it("returns generic XML and no menu for an unresolved destination", async () => {
    resolveClinic.mockResolvedValueOnce(null);

    const response = await POST(
      buildSignedPlivoWebhookRequest({
        url: WEBHOOK_URL,
        paramOverrides: { To: "+14155550999" },
      }),
    );
    const xml = await response.text();

    expect(response.status).toBe(200);
    expect(xml).toContain("Telephone assistance is not configured for this number.");
    expect(xml).not.toContain("<GetInput");
    expect(xml).not.toContain("Clinic");
  });

  it("ignores signed tenant and clinic identifiers when resolving", async () => {
    await POST(
      buildSignedPlivoWebhookRequest({
        url: WEBHOOK_URL,
        paramOverrides: {
          To: "+14155550101",
          clinicId: "clinic-c",
          tenantId: "tenant-b",
        },
      }),
    );

    expect(resolveClinic).toHaveBeenCalledTimes(1);
    expect(resolveClinic).toHaveBeenCalledWith("+14155550101");
  });

  it("does not use From to select the clinic", async () => {
    await POST(
      buildSignedPlivoWebhookRequest({
        url: WEBHOOK_URL,
        paramOverrides: { To: "+14155550101", From: "+14155550103" },
      }),
    );

    expect(resolveClinic).toHaveBeenCalledWith("+14155550101");
  });
});
