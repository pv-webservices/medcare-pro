import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/webhooks/plivo/input/route";
import {
  STAGE_2_INVALID_SELECTION_MESSAGE,
  STAGE_2_NO_INPUT_MESSAGE,
} from "@/lib/telephony/ivr";
import { FeatureError } from "@/lib/featureResolution";
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
const resolveClinic = vi.hoisted(() => vi.fn());
const requireTenantFeatureEntitlement = vi.hoisted(() => vi.fn());
const buildDoctorMenuForClinic = vi.hoisted(() => vi.fn());
const beginTelephoneBooking = vi.hoisted(() => vi.fn());
const buildClinicInformationForClinic = vi.hoisted(() => vi.fn());

vi.mock("@/lib/telephony/clinicConfig", () => ({
  resolveInboundClinicByPlivoNumber: resolveClinic,
}));

vi.mock("@/lib/features", () => ({
  MODULE_FEATURES: { appointments: "appointments" },
  requireTenantFeatureEntitlement,
}));

vi.mock("@/lib/telephony/availability", () => ({
  buildDoctorMenuForClinic,
}));

vi.mock("@/lib/telephony/booking", () => ({
  beginTelephoneBooking,
}));

vi.mock("@/lib/telephony/clinicInformation", () => ({
  buildClinicInformationForClinic,
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
    resolveClinic.mockReset();
    resolveClinic.mockResolvedValue(TEST_CLINIC);
    requireTenantFeatureEntitlement.mockReset();
    requireTenantFeatureEntitlement.mockResolvedValue(undefined);
    buildDoctorMenuForClinic.mockReset();
    buildDoctorMenuForClinic.mockResolvedValue(
      "<Response><GetInput><Speak>Select a doctor.</Speak></GetInput></Response>",
    );
    beginTelephoneBooking.mockReset();
    beginTelephoneBooking.mockResolvedValue(
      "<Response><GetInput><Speak>We found one patient record for this caller number.</Speak></GetInput></Response>",
    );
    buildClinicInformationForClinic.mockReset();
    buildClinicInformationForClinic.mockResolvedValue(
      "<Response><GetInput><Speak>Sunrise Clinic is located at Main Road.</Speak></GetInput></Response>",
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalAuthToken === undefined) {
      delete process.env.PLIVO_AUTH_TOKEN;
    } else {
      process.env.PLIVO_AUTH_TOKEN = originalAuthToken;
    }
  });

  it("opens real clinic information for signed digit 4", async () => {
    const { response, xml } = await postDigit("4");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/xml; charset=utf-8",
    );
    expect(xml).toContain("Sunrise Clinic is located at Main Road.");
    expect(xml).toContain("<GetInput");
    expect(xml).not.toContain("<Dial");
    expect(xml).not.toContain("<Record");
    expect(buildClinicInformationForClinic).toHaveBeenCalledWith({
      requestUrl: INPUT_WEBHOOK_URL,
      clinic: TEST_CLINIC,
    });
    expect(requireTenantFeatureEntitlement).not.toHaveBeenCalled();
  });

  it("opens emergency guidance and explicit confirmation for signed digit 3 without Dial", async () => {
    const { response, xml } = await postDigit("3");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/xml; charset=utf-8",
    );
    expect(xml).toContain("life-threatening emergency");
    expect(xml).toContain("call 112 now");
    expect(xml).toContain("<GetInput");
    expect(xml).toContain(
      'action="https://medcare-tunnel.example/api/webhooks/plivo/urgent/confirm"',
    );
    expect(xml).toContain("press 1 to connect");
    expect(xml).toContain("Press 9 to return to the main menu");
    expect(xml).not.toContain("<Dial");
    expect(xml).not.toContain("<Record");
    expect(requireTenantFeatureEntitlement).not.toHaveBeenCalled();
    expect(buildDoctorMenuForClinic).not.toHaveBeenCalled();
    expect(beginTelephoneBooking).not.toHaveBeenCalled();
  });

  it("opens the doctor menu for signed digit 1 after tenant entitlement", async () => {
    const { response, xml } = await postDigit("1");

    expect(response.status).toBe(200);
    expect(requireTenantFeatureEntitlement).toHaveBeenCalledWith(
      "tenant-a",
      "appointments",
    );
    expect(buildDoctorMenuForClinic).toHaveBeenCalledWith(
      INPUT_WEBHOOK_URL,
      TEST_CLINIC,
    );
    expect(xml).toContain("Select a doctor.");
    expect(xml).not.toContain("You selected tomorrow appointment availability.");
  });

  it("keeps Press 1 unavailable when tenant entitlement is denied", async () => {
    requireTenantFeatureEntitlement.mockRejectedValueOnce(
      new FeatureError("appointments", "entitlement"),
    );

    const { response, xml } = await postDigit("1");

    expect(response.status).toBe(200);
    expect(xml).toContain(
      "Telephone appointment availability is not available for this clinic.",
    );
    expect(xml).toContain("Welcome to Sunrise Clinic.");
    expect(buildDoctorMenuForClinic).not.toHaveBeenCalled();
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
    expect(xml).toContain("Welcome to Sunrise Clinic.");
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

  it("starts real telephone booking for signed digit 2", async () => {
    const { response, xml } = await postDigit("2");

    expect(response.status).toBe(200);
    expect(requireTenantFeatureEntitlement).toHaveBeenCalledWith(
      "tenant-a",
      "appointments",
    );
    expect(beginTelephoneBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        requestUrl: INPUT_WEBHOOK_URL,
        clinic: TEST_CLINIC,
        digits: "2",
      }),
    );
    expect(xml).toContain("one patient record");
  });

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
    expect(await response.text()).toContain("one patient record");
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

  it("uses the independently resolved clinic for invalid-input replay", async () => {
    resolveClinic.mockResolvedValueOnce({
      ...TEST_CLINIC,
      clinicId: "clinic-b",
      clinicName: "Lakeside Clinic",
    });

    const request = buildSignedPlivoWebhookRequest({
      url: INPUT_WEBHOOK_URL,
      paramOverrides: { To: "+14155550102", Digits: "0" },
    });
    const response = await POST(request);
    const xml = await response.text();

    expect(resolveClinic).toHaveBeenCalledWith("+14155550102");
    expect(xml).toContain("Welcome to Lakeside Clinic.");
  });

  it("does not route digits when the destination is unresolved", async () => {
    resolveClinic.mockResolvedValueOnce(null);

    const { response, xml } = await postDigit("1");

    expect(response.status).toBe(200);
    expect(xml).toContain("Telephone assistance is not configured for this number.");
    expect(xml).not.toContain("tomorrow appointment");
    expect(xml).not.toContain("<GetInput");
  });

  it("ignores signed scope fields and From when selecting the clinic", async () => {
    const request = buildSignedPlivoWebhookRequest({
      url: INPUT_WEBHOOK_URL,
      paramOverrides: {
        To: "+14155550101",
        From: "+14155550103",
        clinicId: "clinic-c",
        tenantId: "tenant-b",
        Digits: "9",
      },
    });

    await POST(request);

    expect(resolveClinic).toHaveBeenCalledTimes(1);
    expect(resolveClinic).toHaveBeenCalledWith("+14155550101");
  });
});
