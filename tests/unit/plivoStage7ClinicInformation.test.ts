import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveClinic: vi.fn(),
  getHours: vi.fn(),
  resolveBusinessState: vi.fn(),
}));

vi.mock("@/lib/telephony/clinicConfig", () => {
  return { resolveInboundClinicByPlivoNumber: mocks.resolveClinic };
});

vi.mock("@/lib/telephony/businessHours", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/telephony/businessHours")>();
  return {
    ...actual,
    getClinicBusinessHoursForTrustedClinic: mocks.getHours,
    resolveClinicBusinessState: mocks.resolveBusinessState,
  };
});

import { POST as informationPOST } from "@/app/api/webhooks/plivo/information/route";
import {
  buildClinicInformationForClinic,
  buildClinicInformationPrompt,
} from "@/lib/telephony/clinicInformation";
import type { ClinicBusinessState } from "@/lib/telephony/businessHours";
import type { InboundClinicContext } from "@/lib/telephony/clinicConfig";
import {
  buildSignedPlivoWebhookRequest,
  TEST_PLIVO_AUTH_TOKEN,
} from "../helpers/plivo";

const URL = "https://voice.medcare.example/api/webhooks/plivo/information";
const PROVIDER_NUMBER = "+919000000001";
const originalAuthToken = process.env.PLIVO_AUTH_TOKEN;
const BASE_CLINIC: InboundClinicContext = Object.freeze({
  clinicId: "clinic-a",
  tenantId: "tenant-a",
  clinicName: "Sunrise Clinic",
  clinicAddress: "1 Main Road",
  clinicCity: "Pune",
  timezone: "Asia/Kolkata",
  routingMode: "AFTER_HOURS",
  publicPhoneNumber: "+919000000003",
  receptionPhoneNumber: "+919000000002",
  urgentPhoneNumber: "+919000000005",
});

function state(overrides: Partial<ClinicBusinessState> = {}): ClinicBusinessState {
  return {
    isOpen: false,
    hasRegularHours: true,
    localWeekday: "MONDAY",
    localTime: "18:00",
    todayHours: {
      dayOfWeek: "MONDAY",
      isClosed: false,
      openTime: "09:00",
      closeTime: "17:00",
    },
    nextOpening: {
      dayOfWeek: "TUESDAY",
      dayOffset: 1,
      openTime: "09:00",
    },
    ...overrides,
  };
}

function signedInformation(digits?: string) {
  return buildSignedPlivoWebhookRequest({
    url: URL,
    paramOverrides: {
      To: PROVIDER_NUMBER,
      ...(digits === undefined ? {} : { Digits: digits }),
    },
  });
}

describe("Stage 7 clinic-information speech", () => {
  it.each([
    [
      "address and city",
      { clinicAddress: "1 Main Road", clinicCity: "Pune" },
      "Sunrise Clinic is located at 1 Main Road, Pune.",
    ],
    [
      "address only",
      { clinicAddress: "1 Main Road", clinicCity: null },
      "Sunrise Clinic is located at 1 Main Road.",
    ],
    [
      "city only",
      { clinicAddress: null, clinicCity: "Pune" },
      "Sunrise Clinic is located in Pune.",
    ],
    [
      "neither",
      { clinicAddress: null, clinicCity: null },
      "Address information is not currently available by telephone.",
    ],
  ])("handles %s without speaking null values", (_case, clinic, expected) => {
    const prompt = buildClinicInformationPrompt({
      clinic: { ...BASE_CLINIC, ...clinic },
      state: state(),
    });
    expect(prompt).toContain(expected);
    expect(prompt).not.toMatch(/\b(?:undefined|null)\b/);
  });

  it("reports the current closing time while open", () => {
    const prompt = buildClinicInformationPrompt({
      clinic: BASE_CLINIC,
      state: state({ isOpen: true, localTime: "12:00" }),
    });
    expect(prompt).toContain("We are open today until 5 PM.");
  });

  it("reports today's opening before opening", () => {
    const prompt = buildClinicInformationPrompt({
      clinic: BASE_CLINIC,
      state: state({
        localTime: "08:00",
        nextOpening: {
          dayOfWeek: "MONDAY",
          dayOffset: 0,
          openTime: "09:00",
        },
      }),
    });
    expect(prompt).toContain("We open today at 9 AM.");
    expect(prompt).not.toContain("We are currently closed");
  });

  it("reports current closure and tomorrow's next opening after closing", () => {
    const prompt = buildClinicInformationPrompt({
      clinic: BASE_CLINIC,
      state: state(),
    });
    expect(prompt).toContain("We are currently closed.");
    expect(prompt).toContain("next regular opening is tomorrow at 9 AM");
  });

  it("reports a closed day and a later weekday opening", () => {
    const prompt = buildClinicInformationPrompt({
      clinic: BASE_CLINIC,
      state: state({
        localWeekday: "SATURDAY",
        todayHours: {
          dayOfWeek: "SATURDAY",
          isClosed: true,
          openTime: null,
          closeTime: null,
        },
        nextOpening: {
          dayOfWeek: "MONDAY",
          dayOffset: 2,
          openTime: "09:00",
        },
      }),
    });
    expect(prompt).toContain("We are closed today.");
    expect(prompt).toContain("next regular opening is Monday at 9 AM");
  });

  it("does not invent 24/7 availability when all days are closed", () => {
    const prompt = buildClinicInformationPrompt({
      clinic: BASE_CLINIC,
      state: state({
        hasRegularHours: false,
        todayHours: {
          dayOfWeek: "MONDAY",
          isClosed: true,
          openTime: null,
          closeTime: null,
        },
        nextOpening: null,
      }),
    });
    expect(prompt).toContain(
      "Regular clinic opening hours are not currently available by telephone.",
    );
    expect(prompt).not.toMatch(/24\s*\/\s*7|always open/i);
  });

  it("never includes private telephony numbers or tenant identifiers", () => {
    const prompt = buildClinicInformationPrompt({
      clinic: BASE_CLINIC,
      state: state(),
    });
    for (const privateValue of [
      BASE_CLINIC.receptionPhoneNumber,
      BASE_CLINIC.urgentPhoneNumber,
      BASE_CLINIC.publicPhoneNumber,
      BASE_CLINIC.tenantId,
    ]) {
      expect(prompt).not.toContain(privateValue!);
    }
  });

  it("uses the Plivo builder to escape special characters into valid XML text", async () => {
    mocks.getHours.mockResolvedValueOnce([]);
    mocks.resolveBusinessState.mockReturnValueOnce(state());
    const xml = await buildClinicInformationForClinic({
      requestUrl: URL,
      clinic: {
        ...BASE_CLINIC,
        clinicName: "A & B <Care> O'Brien",
        clinicAddress: "1 > 0 & Main <Road>",
      },
    });
    expect(xml).toMatch(/^<Response>/);
    expect(xml).toContain("A &amp; B &lt;Care&gt; O'Brien");
    expect(xml).toContain("1 &gt; 0 &amp; Main &lt;Road&gt;");
    expect(xml).not.toContain("<Care>");
    expect(xml).not.toContain("<Road>");
  });
});

describe("Stage 7 clinic-information webhook controls and V3 security", () => {
  beforeEach(() => {
    process.env.PLIVO_AUTH_TOKEN = TEST_PLIVO_AUTH_TOKEN;
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.resolveClinic.mockResolvedValue(BASE_CLINIC);
    mocks.getHours.mockResolvedValue([]);
    mocks.resolveBusinessState.mockReturnValue(state());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalAuthToken === undefined) delete process.env.PLIVO_AUTH_TOKEN;
    else process.env.PLIVO_AUTH_TOKEN = originalAuthToken;
  });

  it("returns to the main menu on signed digit 9", async () => {
    const xml = await (await informationPOST(signedInformation("9"))).text();
    expect(xml).toContain("Welcome to Sunrise Clinic.");
    expect(xml).toContain("/api/webhooks/plivo/input");
    expect(mocks.getHours).not.toHaveBeenCalled();
  });

  it.each(["1", "0", "", undefined])(
    "replays clinic information safely for invalid Digits=%s",
    async (digits) => {
      const xml = await (await informationPOST(signedInformation(digits))).text();
      expect(xml).toContain("That selection was not recognized.");
      expect(xml).toContain("Press 9 for the main menu.");
      expect(xml).toContain("/api/webhooks/plivo/information");
      expect(xml).not.toContain("<Dial");
    },
  );

  it("rejects a missing signature before clinic resolution", async () => {
    const request = signedInformation("9");
    request.headers.delete("X-Plivo-Signature-V3");
    expect((await informationPOST(request)).status).toBe(403);
    expect(mocks.resolveClinic).not.toHaveBeenCalled();
  });

  it("rejects an invalid signature", async () => {
    const request = signedInformation("9");
    request.headers.set("X-Plivo-Signature-V3", "invalid");
    expect((await informationPOST(request)).status).toBe(403);
  });

  it("rejects a missing nonce", async () => {
    const request = signedInformation("9");
    request.headers.delete("X-Plivo-Signature-V3-Nonce");
    expect((await informationPOST(request)).status).toBe(403);
  });

  it("fails closed when the validation token is absent", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    delete process.env.PLIVO_AUTH_TOKEN;
    expect((await informationPOST(signedInformation("9"))).status).toBe(503);
  });

  it("accepts a valid signature in a comma-separated list", async () => {
    const request = signedInformation("9");
    const valid = request.headers.get("X-Plivo-Signature-V3");
    request.headers.set("X-Plivo-Signature-V3", `invalid,${valid},invalid-2`);
    expect((await informationPOST(request)).status).toBe(200);
  });

  it("returns safe unavailable XML for an unresolved provider To", async () => {
    mocks.resolveClinic.mockResolvedValueOnce(null);
    const xml = await (await informationPOST(signedInformation("9"))).text();
    expect(xml).toContain("Telephone assistance is not configured");
    expect(xml).not.toContain("<GetInput");
  });
});
