import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as confirmPOST } from "@/app/api/webhooks/plivo/urgent/confirm/route";
import { POST as statusPOST } from "@/app/api/webhooks/plivo/urgent/status/route";
import {
  PLIVO_URGENT_STATUS_WEBHOOK_PATH,
  URGENT_DIAL_TIMEOUT_SECONDS,
} from "@/lib/telephony/plivo";
import { DOCUMENTED_DIAL_STATUSES } from "@/lib/telephony/urgent";
import {
  buildSignedPlivoWebhookRequest,
  TEST_PLIVO_AUTH_TOKEN,
  type PlivoFormParams,
} from "../helpers/plivo";

const CONFIRM_URL =
  "https://voice.medcare.example/api/webhooks/plivo/urgent/confirm";
const PROVIDER_NUMBER = "+919000000001";
const PROVIDER_TO = PROVIDER_NUMBER.slice(1);
const URGENT_NUMBER = "+919000000002";
const PUBLIC_NUMBER = "+919000000003";
const RECEPTION_NUMBER = "+919000000004";
const CALLER_A = "+919000000005";
const CALLER_B = "+919000000006";
const STATUS_URL = `${new URL(PLIVO_URGENT_STATUS_WEBHOOK_PATH, "https://voice.medcare.example").toString()}?sourceNumber=${encodeURIComponent(PROVIDER_NUMBER)}`;

const originalAuthToken = process.env.PLIVO_AUTH_TOKEN;
const resolveClinic = vi.hoisted(() => vi.fn());
const getRuntimeMenu = vi.hoisted(() => vi.fn());

vi.mock("@/lib/telephony/clinicConfig", () => ({
  resolveInboundClinicByPlivoNumber: resolveClinic,
}));

vi.mock("@/lib/telephony/ivrRuntime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/telephony/ivrRuntime")>();
  return {
    ...actual,
    getClinicIvrRuntimeMenuForTrustedClinic: getRuntimeMenu,
  };
});

import {
  compileCustomClinicIvrRuntimeMenu,
  defaultClinicIvrRuntimeMenu,
} from "@/lib/telephony/ivrRuntime";

const TEST_CLINIC = Object.freeze({
  clinicId: "clinic-a",
  tenantId: "tenant-a",
  clinicName: "Sunrise Clinic",
  timezone: "Asia/Kolkata",
  publicPhoneNumber: PUBLIC_NUMBER,
  receptionPhoneNumber: RECEPTION_NUMBER,
  urgentPhoneNumber: URGENT_NUMBER,
});

function signedConfirm(
  digits: string | null = "1",
  options: { url?: string; overrides?: PlivoFormParams } = {},
): Request {
  return buildSignedPlivoWebhookRequest({
    url: options.url ?? CONFIRM_URL,
    paramOverrides: {
      To: PROVIDER_TO,
      From: CALLER_A,
      ...(digits === null ? {} : { Digits: digits }),
      ...options.overrides,
    },
  });
}

function signedStatus(
  dialStatus: string | null = "completed",
  options: { url?: string; overrides?: PlivoFormParams } = {},
): Request {
  return buildSignedPlivoWebhookRequest({
    url: options.url ?? STATUS_URL,
    paramOverrides: {
      To: URGENT_NUMBER,
      From: PROVIDER_NUMBER,
      ...(dialStatus === null ? {} : { DialStatus: dialStatus }),
      ...options.overrides,
    },
  });
}

async function body(response: Response): Promise<string> {
  expect(response.headers.get("content-type")).toBe(
    "application/xml; charset=utf-8",
  );
  return response.text();
}

describe("POST /api/webhooks/plivo/urgent/confirm", () => {
  beforeEach(() => {
    process.env.PLIVO_AUTH_TOKEN = TEST_PLIVO_AUTH_TOKEN;
    resolveClinic.mockReset();
    resolveClinic.mockResolvedValue(TEST_CLINIC);
    getRuntimeMenu.mockReset();
    getRuntimeMenu.mockResolvedValue(
      defaultClinicIvrRuntimeMenu(TEST_CLINIC.clinicName),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalAuthToken === undefined) delete process.env.PLIVO_AUTH_TOKEN;
    else process.env.PLIVO_AUTH_TOKEN = originalAuthToken;
  });

  it("returns a bounded configured Dial using only clinic config and canonical provider caller ID", async () => {
    const response = await confirmPOST(signedConfirm());
    const xml = await body(response);

    expect(response.status).toBe(200);
    expect(resolveClinic).toHaveBeenCalledWith(PROVIDER_TO);
    expect(xml).toContain("<Speak>Connecting you to urgent clinic assistance.</Speak>");
    expect(xml).toContain("<Dial");
    expect(xml).toContain(`<Number>${URGENT_NUMBER}</Number>`);
    expect(xml).toContain(`callerId="${PROVIDER_NUMBER}"`);
    expect(xml).toContain('method="POST"');
    expect(xml).toContain(`timeout="${URGENT_DIAL_TIMEOUT_SECONDS}"`);
    expect(xml).toContain('redirect="true"');
    expect(xml).toContain(
      "action=\"https://voice.medcare.example/api/webhooks/plivo/urgent/status?sourceNumber=%2B919000000001\"",
    );
    expect(xml).not.toContain("<Record");
    const spokenText = [...xml.matchAll(/<Speak[^>]*>(.*?)<\/Speak>/g)]
      .map((match) => match[1])
      .join(" ");
    expect(spokenText).not.toContain(URGENT_NUMBER);
  });

  it("ignores every caller-supplied destination field and query parameter", async () => {
    const injected = "+919000000099";
    const url = `${CONFIRM_URL}?destination=${encodeURIComponent(injected)}&phone=${encodeURIComponent(injected)}&urgentPhoneNumber=${encodeURIComponent(injected)}&number=${encodeURIComponent(injected)}&toNumber=${encodeURIComponent(injected)}`;
    const xml = await body(
      await confirmPOST(
        signedConfirm("1", {
          url,
          overrides: {
            destination: injected,
            phone: injected,
            urgentPhoneNumber: injected,
            number: injected,
            toNumber: injected,
            clinicId: "clinic-attacker",
            tenantId: "tenant-attacker",
          },
        }),
      ),
    );

    expect(xml).toContain(`<Number>${URGENT_NUMBER}</Number>`);
    expect(xml).not.toContain(injected);
    expect(xml).not.toContain("attacker");
  });

  it("does not let changing From control clinic, destination, or callerId", async () => {
    const firstXml = await body(
      await confirmPOST(signedConfirm("1", { overrides: { From: CALLER_A } })),
    );
    const secondXml = await body(
      await confirmPOST(signedConfirm("1", { overrides: { From: CALLER_B } })),
    );

    expect(resolveClinic).toHaveBeenNthCalledWith(1, PROVIDER_TO);
    expect(resolveClinic).toHaveBeenNthCalledWith(2, PROVIDER_TO);
    for (const xml of [firstXml, secondXml]) {
      expect(xml).toContain(`<Number>${URGENT_NUMBER}</Number>`);
      expect(xml).toContain(`callerId="${PROVIDER_NUMBER}"`);
      expect(xml).not.toContain(CALLER_A);
      expect(xml).not.toContain(CALLER_B);
    }
  });

  it.each([
    ["provider", PROVIDER_NUMBER],
    ["public", PUBLIC_NUMBER],
  ] as const)("fails closed when urgent destination equals the %s number", async (_label, urgentPhoneNumber) => {
    resolveClinic.mockResolvedValueOnce({ ...TEST_CLINIC, urgentPhoneNumber });

    const xml = await body(await confirmPOST(signedConfirm()));

    expect(xml).toContain("Urgent telephone transfer is temporarily unavailable.");
    expect(xml).not.toContain("<Dial");
    expect(xml).not.toContain("configuration");
  });

  it("does not fall back to reception when urgentPhoneNumber is missing", async () => {
    resolveClinic.mockResolvedValueOnce({
      ...TEST_CLINIC,
      urgentPhoneNumber: null,
    });

    const xml = await body(await confirmPOST(signedConfirm()));

    expect(xml).toContain("not currently configured for this clinic");
    expect(xml).toContain("call 112");
    expect(xml).not.toContain("<Dial");
    expect(xml).not.toContain(RECEPTION_NUMBER);
  });

  it("permits urgent and reception numbers to identify the same human destination", async () => {
    resolveClinic.mockResolvedValueOnce({
      ...TEST_CLINIC,
      urgentPhoneNumber: RECEPTION_NUMBER,
    });

    const xml = await body(await confirmPOST(signedConfirm()));

    expect(xml).toContain(`<Number>${RECEPTION_NUMBER}</Number>`);
    expect(xml).toContain("<Dial");
  });

  it.each([
    ["international provider", "14155550199", URGENT_NUMBER],
    ["international destination", PROVIDER_TO, "+14155550199"],
    ["malformed destination", PROVIDER_TO, "not-a-number"],
  ])("fails closed for %s", async (_label, to, urgentPhoneNumber) => {
    resolveClinic.mockResolvedValueOnce({ ...TEST_CLINIC, urgentPhoneNumber });
    const xml = await body(
      await confirmPOST(signedConfirm("1", { overrides: { To: to } })),
    );

    expect(xml).toContain("temporarily unavailable");
    expect(xml).not.toContain("<Dial");
  });

  it("returns digit 9 to an escaped clinic main menu without attempting transfer", async () => {
    resolveClinic.mockResolvedValueOnce({
      ...TEST_CLINIC,
      clinicName: "A & B <Clinic>",
    });

    const xml = await body(await confirmPOST(signedConfirm("9")));

    expect(xml).toContain("Welcome to A &amp; B &lt;Clinic&gt;.");
    expect(xml).toContain("/api/webhooks/plivo/input");
    expect(xml).not.toContain("<Dial");
  });

  it("returns digit 9 to the current valid custom main menu", async () => {
    const menu = compileCustomClinicIvrRuntimeMenu(TEST_CLINIC.clinicName, {
      greetingTemplate: "Custom urgent return for {clinicName}.",
      language: "en-US",
      voice: "WOMAN",
      items: [
        {
          digit: 4,
          label: "clinic information",
          action: "CLINIC_INFORMATION",
          position: 0,
          enabled: true,
        },
      ],
    });
    getRuntimeMenu.mockResolvedValueOnce(menu);
    const xml = await body(await confirmPOST(signedConfirm("9")));
    expect(xml).toContain("Custom urgent return for Sunrise Clinic.");
    expect(xml).toContain(`ivrRev=${menu.revision}`);
    expect(xml).not.toContain("<Dial");
  });

  it.each(["0", "2", "3", "8", "12", ""])(
    "repeats safe urgent guidance for invalid Digits=%j",
    async (digits) => {
      const xml = await body(await confirmPOST(signedConfirm(digits)));

      expect(xml).toContain("That selection was not recognized.");
      expect(xml).toContain("call 112 now");
      expect(xml).toContain("<GetInput");
      expect(xml).toContain("/api/webhooks/plivo/urgent/confirm");
      expect(xml).not.toContain("<Dial");
    },
  );

  it("repeats safe urgent guidance when Digits is missing", async () => {
    const xml = await body(await confirmPOST(signedConfirm(null)));
    expect(xml).toContain("That selection was not recognized.");
    expect(xml).toContain("call 112 now");
    expect(xml).toContain("<GetInput");
    expect(xml).not.toContain("<Dial");
  });

  it("fails closed when validated To does not resolve", async () => {
    resolveClinic.mockResolvedValueOnce(null);
    const xml = await body(await confirmPOST(signedConfirm()));
    expect(xml).toContain("Telephone assistance is not configured");
    expect(xml).not.toContain("<Dial");
  });
});

describe("POST /api/webhooks/plivo/urgent/status", () => {
  beforeEach(() => {
    process.env.PLIVO_AUTH_TOKEN = TEST_PLIVO_AUTH_TOKEN;
    resolveClinic.mockReset();
    resolveClinic.mockResolvedValue(TEST_CLINIC);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalAuthToken === undefined) delete process.env.PLIVO_AUTH_TOKEN;
    else process.env.PLIVO_AUTH_TOKEN = originalAuthToken;
  });

  it("resolves clinic from signed server-generated sourceNumber, not callback body To", async () => {
    const xml = await body(
      await statusPOST(
        signedStatus("completed", { overrides: { To: "+919000000099" } }),
      ),
    );

    expect(resolveClinic).toHaveBeenCalledWith(PROVIDER_NUMBER);
    expect(xml).toContain("<Response");
  });

  it("finishes safely after a completed human conversation", async () => {
    const xml = await body(await statusPOST(signedStatus("completed")));
    expect(xml).toContain("<Response");
    expect(xml).not.toContain("could not connect");
    expect(xml).not.toContain("<GetInput");
    expect(xml).not.toContain("appointment");
  });

  it.each(["busy", "failed", "cancel", "timeout", "no-answer"])(
    "returns generic safe guidance for documented DialStatus=%s",
    async (dialStatus) => {
      const xml = await body(await statusPOST(signedStatus(dialStatus)));
      expect(xml).toContain("We could not connect you to urgent clinic assistance.");
      expect(xml).toContain("call 112");
      expect(xml).not.toContain(dialStatus);
      expect(xml).not.toContain("<GetInput");
    },
  );

  it.each(["future-status", "COMPLETED", "", null])(
    "treats unknown DialStatus=%j as a generic failure",
    async (dialStatus) => {
      const xml = await body(await statusPOST(signedStatus(dialStatus)));
      expect(xml).toContain("We could not connect");
      expect(xml).toContain("call 112");
      if (dialStatus) expect(xml).not.toContain(dialStatus);
    },
  );

  it("never exposes callback diagnostics or private numbers in status XML", async () => {
    const values = {
      DialBLegUUID: "private-b-leg-uuid",
      DialALegUUID: "private-a-leg-uuid",
      DialHangupCause: "private-carrier-cause",
      From: CALLER_A,
      urgentPhoneNumber: URGENT_NUMBER,
      receptionPhoneNumber: RECEPTION_NUMBER,
      patientName: "Private Patient",
    };
    const xml = await body(
      await statusPOST(signedStatus("busy", { overrides: values })),
    );

    for (const value of Object.values(values)) expect(xml).not.toContain(value);
  });

  it.each([
    ["missing", "https://voice.medcare.example/api/webhooks/plivo/urgent/status"],
    [
      "duplicate",
      `${STATUS_URL}&sourceNumber=${encodeURIComponent("+919000000099")}`,
    ],
  ])("fails safely for %s callback source state", async (_label, url) => {
    const xml = await body(await statusPOST(signedStatus("completed", { url })));
    expect(xml).toContain("We could not connect");
    expect(xml).not.toContain("<Dial");
  });
});

describe.each([
  ["urgent confirm", confirmPOST, () => signedConfirm()],
  ["urgent status", statusPOST, () => signedStatus()],
] as const)("V3 protection for %s", (_name, post, requestFactory) => {
  beforeEach(() => {
    process.env.PLIVO_AUTH_TOKEN = TEST_PLIVO_AUTH_TOKEN;
    resolveClinic.mockReset();
    resolveClinic.mockResolvedValue(TEST_CLINIC);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalAuthToken === undefined) delete process.env.PLIVO_AUTH_TOKEN;
    else process.env.PLIVO_AUTH_TOKEN = originalAuthToken;
  });

  it("rejects a missing signature", async () => {
    const request = requestFactory();
    request.headers.delete("X-Plivo-Signature-V3");
    expect((await post(request)).status).toBe(403);
    expect(resolveClinic).not.toHaveBeenCalled();
  });

  it("rejects an invalid signature", async () => {
    const request = requestFactory();
    request.headers.set("X-Plivo-Signature-V3", "invalid");
    expect((await post(request)).status).toBe(403);
    expect(resolveClinic).not.toHaveBeenCalled();
  });

  it("rejects a missing nonce", async () => {
    const request = requestFactory();
    request.headers.delete("X-Plivo-Signature-V3-Nonce");
    expect((await post(request)).status).toBe(403);
    expect(resolveClinic).not.toHaveBeenCalled();
  });

  it("fails closed when PLIVO_AUTH_TOKEN is missing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    delete process.env.PLIVO_AUTH_TOKEN;
    expect((await post(requestFactory())).status).toBe(503);
    expect(resolveClinic).not.toHaveBeenCalled();
  });

  it("accepts a valid signature within a comma-separated list", async () => {
    const request = requestFactory();
    const valid = request.headers.get("X-Plivo-Signature-V3");
    request.headers.set("X-Plivo-Signature-V3", `invalid,${valid},invalid-2`);
    expect((await post(request)).status).toBe(200);
    expect(resolveClinic).toHaveBeenCalledTimes(1);
  });
});

describe("Stage 6 scope and provider contract", () => {
  it("tracks the exact current Dial action statuses, including cancel", () => {
    expect(DOCUMENTED_DIAL_STATUSES).toEqual([
      "completed",
      "busy",
      "failed",
      "cancel",
      "timeout",
      "no-answer",
    ]);
  });

  it("keeps urgent routes stateless and free of appointment, patient, audit, and REST call operations", () => {
    const files = [
      "src/lib/telephony/urgent.ts",
      "src/app/api/webhooks/plivo/urgent/confirm/route.ts",
      "src/app/api/webhooks/plivo/urgent/status/route.ts",
    ];
    const source = files
      .map((path) => readFileSync(resolve(path), "utf8"))
      .join("\n");

    expect(source).not.toMatch(/@\/lib\/prisma|RestClient|calls\.create|addRecord/);
    expect(source).not.toMatch(
      /Patient|Registration|Appointment|TelephonyBookingRequest|AuditLog/,
    );
    expect(source).not.toMatch(/\.create\s*\(|\.update\s*\(|\.upsert\s*\(/);
  });
});
