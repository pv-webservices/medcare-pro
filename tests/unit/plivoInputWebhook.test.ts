import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/webhooks/plivo/input/route";
import {
  STAGE_2_INVALID_SELECTION_MESSAGE,
  STAGE_2_NO_INPUT_MESSAGE,
} from "@/lib/telephony/ivr";
import {
  buildPlivoWebhookRequest,
  buildSignedPlivoWebhookRequest,
  createPlivoTestNonce,
  createPlivoV3PostSignature,
  REALISTIC_ANSWER_PARAMS,
  TEST_PLIVO_AUTH_TOKEN,
  type PlivoFormParams,
} from "../helpers/plivo";

const INPUT_WEBHOOK_URL =
  "https://medcare-tunnel.example/api/webhooks/plivo/input";
const originalAuthToken = process.env.PLIVO_AUTH_TOKEN;

async function postDigit(digits?: string): Promise<{
  response: Response;
  xml: string;
}> {
  const request = buildSignedPlivoWebhookRequest({
    url: INPUT_WEBHOOK_URL,
    paramOverrides: digits === undefined ? {} : { Digits: digits },
  });
  const response = await POST(request);
  return { response, xml: await response.text() };
}

describe("POST /api/webhooks/plivo/input", () => {
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

  it.each([
    ["1", "You selected tomorrow appointment availability."],
    ["2", "You selected appointment booking."],
    ["3", "You selected urgent assistance."],
    ["4", "You selected clinic information."],
  ] as const)("acknowledges signed digit %s", async (digits, message) => {
    const { response, xml } = await postDigit(digits);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/xml; charset=utf-8",
    );
    expect(xml).toContain(`<Speak>${message}</Speak>`);
    expect(xml).not.toContain("<GetInput");
    expect(xml).not.toContain("<Dial");
    expect(xml).not.toContain("<Record");
  });

  it("replays the complete menu for signed digit 9", async () => {
    const { response, xml } = await postDigit("9");

    expect(response.status).toBe(200);
    expect(xml).toContain("<GetInput");
    expect(xml).toContain('inputType="dtmf"');
    for (const digit of ["1", "2", "3", "4", "9"]) {
      expect(xml).toContain(`Press ${digit}`);
    }
    expect(xml).not.toContain(STAGE_2_INVALID_SELECTION_MESSAGE);
  });

  it.each(["0", "5", "", "12"])(
    "returns the invalid message and menu for Digits=%j",
    async (digits) => {
      const { response, xml } = await postDigit(digits);

      expect(response.status).toBe(200);
      expect(xml).toContain(
        `<Speak>${STAGE_2_INVALID_SELECTION_MESSAGE}</Speak>`,
      );
      expect(xml).toContain("<GetInput");
      expect(xml).toContain(STAGE_2_NO_INPUT_MESSAGE);
    },
  );

  it("returns the invalid message and menu when Digits is missing", async () => {
    const { response, xml } = await postDigit();

    expect(response.status).toBe(200);
    expect(xml).toContain(`<Speak>${STAGE_2_INVALID_SELECTION_MESSAGE}</Speak>`);
    expect(xml).toContain("<GetInput");
  });

  it("rejects an invalid signature before routing Digits", async () => {
    const request = buildSignedPlivoWebhookRequest({
      url: INPUT_WEBHOOK_URL,
      paramOverrides: { Digits: "1" },
      headers: { "X-Plivo-Signature-V3": "invalid" },
    });
    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("tomorrow appointment");
  });

  it("rejects a missing signature", async () => {
    const request = buildSignedPlivoWebhookRequest({
      url: INPUT_WEBHOOK_URL,
      paramOverrides: { Digits: "1" },
    });
    request.headers.delete("X-Plivo-Signature-V3");

    expect((await POST(request)).status).toBe(403);
  });

  it("rejects a missing nonce", async () => {
    const request = buildSignedPlivoWebhookRequest({
      url: INPUT_WEBHOOK_URL,
      paramOverrides: { Digits: "1" },
    });
    request.headers.delete("X-Plivo-Signature-V3-Nonce");

    expect((await POST(request)).status).toBe(403);
  });

  it("fails closed when PLIVO_AUTH_TOKEN is missing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    delete process.env.PLIVO_AUTH_TOKEN;

    const response = await POST(
      buildSignedPlivoWebhookRequest({
        url: INPUT_WEBHOOK_URL,
        paramOverrides: { Digits: "1" },
      }),
    );

    expect(response.status).toBe(503);
  });

  it("accepts a valid signature in a comma-separated signature list", async () => {
    const request = buildSignedPlivoWebhookRequest({
      url: INPUT_WEBHOOK_URL,
      paramOverrides: { Digits: "2" },
    });
    const validSignature = request.headers.get("X-Plivo-Signature-V3");
    request.headers.set(
      "X-Plivo-Signature-V3",
      `invalid,${validSignature},also-invalid`,
    );

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("appointment booking");
  });

  it("accepts unexpected fields only when they are part of the signature", async () => {
    const request = buildSignedPlivoWebhookRequest({
      url: INPUT_WEBHOOK_URL,
      paramOverrides: {
        Digits: "3",
        FuturePlivoField: "supported-safely",
      },
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("urgent assistance");
  });

  it("rejects a body whose Digits differ from the validated signature", async () => {
    const nonce = createPlivoTestNonce();
    const signedParams: PlivoFormParams = {
      ...REALISTIC_ANSWER_PARAMS,
      Digits: "1",
    };
    const tamperedParams: PlivoFormParams = {
      ...REALISTIC_ANSWER_PARAMS,
      Digits: "2",
    };
    const signature = createPlivoV3PostSignature({
      url: INPUT_WEBHOOK_URL,
      nonce,
      authToken: TEST_PLIVO_AUTH_TOKEN,
      params: signedParams,
    });
    const request = buildPlivoWebhookRequest({
      url: INPUT_WEBHOOK_URL,
      params: tamperedParams,
      headers: {
        "X-Plivo-Signature-V3": signature,
        "X-Plivo-Signature-V3-Nonce": nonce,
      },
    });

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("appointment booking");
  });

  it("uses only the signed request origin and fixed input path for menu replay", async () => {
    const url =
      "https://voice.medcare.example:9443/api/webhooks/plivo/input?next=https://attacker.example";
    const request = buildSignedPlivoWebhookRequest({
      url,
      paramOverrides: {
        Digits: "9",
        action: "https://attacker.example/action",
        Referer: "https://attacker.example/referer",
      },
    });

    const response = await POST(request);
    const xml = await response.text();

    expect(response.status).toBe(200);
    expect(xml).toContain(
      'action="https://voice.medcare.example:9443/api/webhooks/plivo/input"',
    );
    expect(xml).not.toContain("next=");
    expect(xml).not.toContain("attacker.example");
  });
});
