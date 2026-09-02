import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveClinic: vi.fn(),
  getHours: vi.fn(),
  resolveBusinessState: vi.fn(),
  getRuntimeMenu: vi.fn(),
  observeInboundCall: vi.fn(),
  observeCallEvents: vi.fn(),
}));

vi.mock("@/lib/telephony/clinicConfig", () => ({
  resolveInboundClinicByPlivoNumber: mocks.resolveClinic,
}));

vi.mock("@/lib/telephony/businessHours", () => ({
  getClinicBusinessHoursForTrustedClinic: mocks.getHours,
  resolveClinicBusinessState: mocks.resolveBusinessState,
}));

vi.mock("@/lib/telephony/ivrRuntime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/telephony/ivrRuntime")>();
  return {
    ...actual,
    getClinicIvrRuntimeMenuForTrustedClinic: mocks.getRuntimeMenu,
  };
});

vi.mock("@/lib/telephony/callObservability", () => ({
  observeInboundProductionCall: mocks.observeInboundCall,
  observeProductionCallEvents: mocks.observeCallEvents,
}));

import { POST as answerPOST } from "@/app/api/webhooks/plivo/answer/route";
import { POST as statusPOST } from "@/app/api/webhooks/plivo/reception/status/route";
import { RECEPTION_DIAL_TIMEOUT_SECONDS } from "@/lib/telephony/plivo";
import {
  compileCustomClinicIvrRuntimeMenu,
  defaultClinicIvrRuntimeMenu,
} from "@/lib/telephony/ivrRuntime";
import {
  buildSignedPlivoWebhookRequest,
  TEST_PLIVO_AUTH_TOKEN,
} from "../helpers/plivo";

const ANSWER_URL = "https://voice.medcare.example/api/webhooks/plivo/answer";
const PROVIDER_NUMBER = "+919000000001";
const RECEPTION_NUMBER = "+919000000002";
const PUBLIC_NUMBER = "+919000000003";
const CALLER_NUMBER = "+919000000004";
const STATUS_URL = `https://voice.medcare.example/api/webhooks/plivo/reception/status?sourceNumber=${encodeURIComponent(PROVIDER_NUMBER)}`;
const originalAuthToken = process.env.PLIVO_AUTH_TOKEN;

const BASE_CLINIC = Object.freeze({
  clinicId: "clinic-a",
  tenantId: "tenant-a",
  clinicName: "Sunrise Clinic",
  clinicAddress: "1 Main Road",
  clinicCity: "Pune",
  timezone: "Asia/Kolkata",
  routingMode: "AFTER_HOURS" as const,
  publicPhoneNumber: PUBLIC_NUMBER,
  receptionPhoneNumber: RECEPTION_NUMBER,
  urgentPhoneNumber: "+919000000005",
});

const CUSTOM_RUNTIME_MENU = compileCustomClinicIvrRuntimeMenu(
  BASE_CLINIC.clinicName,
  {
    greetingTemplate: "Custom greeting for {clinicName}.",
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
  },
);

async function answer(overrides: Record<string, string> = {}) {
  const response = await answerPOST(
    buildSignedPlivoWebhookRequest({
      url: ANSWER_URL,
      paramOverrides: {
        To: PROVIDER_NUMBER,
        From: CALLER_NUMBER,
        ...overrides,
      },
    }),
  );
  return { response, xml: await response.text() };
}

function signedStatus(
  status: string | null = "completed",
  options: { url?: string; signatureUrl?: string; to?: string } = {},
) {
  const params: Record<string, string> = {
    CallUUID: "call-a",
    DialALegUUID: "a-leg-call-0001",
    DialBLegUUID: "b-leg-call-0001",
    From: CALLER_NUMBER,
    To: options.to ?? RECEPTION_NUMBER,
  };
  if (status !== null) params.DialStatus = status;
  return buildSignedPlivoWebhookRequest({
    url: options.url ?? STATUS_URL,
    signatureUrl: options.signatureUrl,
    params,
  });
}

describe("Stage 7 /answer effective routing", () => {
  beforeEach(() => {
    process.env.PLIVO_AUTH_TOKEN = TEST_PLIVO_AUTH_TOKEN;
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.resolveClinic.mockResolvedValue(BASE_CLINIC);
    mocks.getHours.mockResolvedValue([]);
    mocks.resolveBusinessState.mockReturnValue({ isOpen: false });
    mocks.getRuntimeMenu.mockResolvedValue(
      defaultClinicIvrRuntimeMenu(BASE_CLINIC.clinicName),
    );
    mocks.observeInboundCall.mockResolvedValue("recorded");
    mocks.observeCallEvents.mockResolvedValue("recorded");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalAuthToken === undefined) delete process.env.PLIVO_AUTH_TOKEN;
    else process.env.PLIVO_AUTH_TOKEN = originalAuthToken;
  });

  it("routes AFTER_HOURS directly to IVR without reading hours", async () => {
    mocks.resolveClinic.mockResolvedValueOnce({
      ...BASE_CLINIC,
      routingMode: "AFTER_HOURS",
    });
    mocks.resolveBusinessState.mockReturnValueOnce({ isOpen: true });
    const { xml } = await answer();
    expect(xml).toContain("<GetInput");
    expect(xml).not.toContain("<Dial");
    expect(mocks.getHours).not.toHaveBeenCalled();
    expect(mocks.resolveBusinessState).not.toHaveBeenCalled();
  });

  it("routes OPEN to only the stored reception number", async () => {
    mocks.resolveClinic.mockResolvedValueOnce({
      ...BASE_CLINIC,
      routingMode: "OPEN",
    });
    const { xml } = await answer({
      destination: "+919999999999",
      phone: "+919999999998",
      receptionPhoneNumber: "+919999999997",
      number: "+919999999996",
      toNumber: "+919999999995",
    });
    expect(xml).toContain("<Dial");
    expect(xml).toContain(`<Number>${RECEPTION_NUMBER}</Number>`);
    expect(mocks.getRuntimeMenu).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: "clinic-a" }),
    );
    expect(xml).toContain(`callerId="${PROVIDER_NUMBER}"`);
    expect(xml).toContain(`timeout="${RECEPTION_DIAL_TIMEOUT_SECONDS}"`);
    expect(xml).toContain('method="POST"');
    expect(xml).toContain('redirect="true"');
    expect(xml).toContain(
      "/api/webhooks/plivo/reception/status?sourceNumber=%2B919000000001",
    );
    expect(xml).not.toContain("+9199999999");
    expect(xml).not.toContain("<Record");
    expect(mocks.getHours).not.toHaveBeenCalled();
    expect(mocks.observeInboundCall).toHaveBeenCalledWith(expect.objectContaining({
      clinicId: "clinic-a",
      initialRoute: "RECEPTION",
      routingModeAtStart: "OPEN",
      events: ["ROUTED_TO_RECEPTION"],
    }));
  });

  it("routes AUTO-open to reception using clinic-local business state", async () => {
    mocks.resolveClinic.mockResolvedValueOnce({
      ...BASE_CLINIC,
      routingMode: "AUTO",
    });
    mocks.resolveBusinessState.mockReturnValueOnce({ isOpen: true });
    const { xml } = await answer();
    expect(mocks.getHours).toHaveBeenCalledWith("clinic-a");
    expect(mocks.resolveBusinessState).toHaveBeenCalledWith(
      expect.objectContaining({ timezone: "Asia/Kolkata", hours: [] }),
    );
    expect(xml).toContain(`<Number>${RECEPTION_NUMBER}</Number>`);
    expect(mocks.observeInboundCall).toHaveBeenCalledWith(expect.objectContaining({
      routingModeAtStart: "AUTO",
      initialRoute: "RECEPTION",
      events: ["ROUTED_TO_RECEPTION"],
    }));
  });

  it("routes AUTO-closed to IVR", async () => {
    mocks.resolveClinic.mockResolvedValueOnce({
      ...BASE_CLINIC,
      routingMode: "AUTO",
    });
    const { xml } = await answer();
    expect(xml).toContain("<GetInput");
    expect(xml).not.toContain("<Dial");
    expect(mocks.observeInboundCall).toHaveBeenCalledWith(expect.objectContaining({
      routingModeAtStart: "AUTO",
      initialRoute: "IVR",
      events: ["ROUTED_TO_IVR"],
    }));
  });

  it("uses a valid custom profile when AUTO-closed routes to IVR", async () => {
    mocks.resolveClinic.mockResolvedValueOnce({
      ...BASE_CLINIC,
      routingMode: "AUTO",
    });
    mocks.getRuntimeMenu.mockResolvedValueOnce(CUSTOM_RUNTIME_MENU);
    const { xml } = await answer();
    expect(xml).toContain("Custom greeting for Sunrise Clinic.");
    expect(xml).toContain(`ivrRev=${CUSTOM_RUNTIME_MENU.revision}`);
    expect(xml).not.toContain("Press 1 for tomorrow slots.");
  });

  it("falls back to IVR when reception is missing without using urgent", async () => {
    mocks.resolveClinic.mockResolvedValueOnce({
      ...BASE_CLINIC,
      routingMode: "OPEN",
      receptionPhoneNumber: null,
    });
    const { xml } = await answer();
    expect(xml).toContain("<GetInput");
    expect(xml).not.toContain("<Dial");
    expect(xml).not.toContain(BASE_CLINIC.urgentPhoneNumber);
    expect(mocks.observeInboundCall).toHaveBeenCalledWith(expect.objectContaining({
      initialRoute: "RECEPTION",
      phoneMenuSource: "DEFAULT",
      events: [
        "ROUTED_TO_RECEPTION",
        "RECEPTION_FALLBACK_TO_IVR",
        "ROUTED_TO_IVR",
      ],
    }));
  });

  it("uses a valid custom menu for an unsafe reception fallback", async () => {
    mocks.resolveClinic.mockResolvedValueOnce({
      ...BASE_CLINIC,
      routingMode: "OPEN",
      receptionPhoneNumber: null,
    });
    mocks.getRuntimeMenu.mockResolvedValueOnce(CUSTOM_RUNTIME_MENU);
    const { xml } = await answer();
    expect(xml).toContain("Custom greeting for Sunrise Clinic.");
    expect(xml).toContain(`ivrRev=${CUSTOM_RUNTIME_MENU.revision}`);
  });

  it.each([
    ["provider loop", PROVIDER_NUMBER, PUBLIC_NUMBER],
    ["public-number loop", PUBLIC_NUMBER, PUBLIC_NUMBER],
  ])("falls back to IVR for a %s", async (_case, reception, publicNumber) => {
    mocks.resolveClinic.mockResolvedValueOnce({
      ...BASE_CLINIC,
      routingMode: "OPEN",
      receptionPhoneNumber: reception,
      publicPhoneNumber: publicNumber,
    });
    const { xml } = await answer();
    expect(xml).toContain("<GetInput");
    expect(xml).not.toContain("<Dial");
  });

  it.each([
    ["non-Indian provider", "+14155550199", RECEPTION_NUMBER],
    ["non-Indian reception", PROVIDER_NUMBER, "+14155550198"],
  ])("falls back to IVR for %s", async (_case, provider, reception) => {
    mocks.resolveClinic.mockResolvedValueOnce({
      ...BASE_CLINIC,
      routingMode: "OPEN",
      receptionPhoneNumber: reception,
    });
    const { xml } = await answer({ To: provider });
    expect(xml).toContain("<GetInput");
    expect(xml).not.toContain("<Dial");
  });

  it("never uses caller From as destination or Dial callerId", async () => {
    mocks.resolveClinic.mockResolvedValueOnce({
      ...BASE_CLINIC,
      routingMode: "OPEN",
    });
    const caller = "+919888888888";
    const { xml } = await answer({ From: caller });
    expect(xml).toContain(`callerId="${PROVIDER_NUMBER}"`);
    expect(xml).toContain(`<Number>${RECEPTION_NUMBER}</Number>`);
    expect(xml).not.toContain(caller);
  });
});

describe("Stage 7 reception Dial action callback", () => {
  beforeEach(() => {
    process.env.PLIVO_AUTH_TOKEN = TEST_PLIVO_AUTH_TOKEN;
    mocks.resolveClinic.mockReset();
    mocks.resolveClinic.mockResolvedValue(BASE_CLINIC);
    mocks.getRuntimeMenu.mockReset();
    mocks.getRuntimeMenu.mockResolvedValue(
      defaultClinicIvrRuntimeMenu(BASE_CLINIC.clinicName),
    );
    mocks.observeCallEvents.mockReset();
    mocks.observeCallEvents.mockResolvedValue("recorded");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalAuthToken === undefined) delete process.env.PLIVO_AUTH_TOKEN;
    else process.env.PLIVO_AUTH_TOKEN = originalAuthToken;
  });

  it("resolves clinic from signed sourceNumber rather than callback body To", async () => {
    await statusPOST(signedStatus("completed", { to: "+919999999999" }));
    expect(mocks.resolveClinic).toHaveBeenCalledWith(PROVIDER_NUMBER);
  });

  it("returns final empty XML after a completed reception conversation", async () => {
    const xml = await (await statusPOST(signedStatus("completed"))).text();
    expect(xml).toContain("<Response");
    expect(xml).not.toContain("<GetInput");
    expect(xml).not.toContain("<Dial");
    expect(mocks.getRuntimeMenu).not.toHaveBeenCalled();
    expect(mocks.observeCallEvents).toHaveBeenCalledWith({
      clinicId: "clinic-a",
      providerCallUuid: "a-leg-call-0001",
      events: ["RECEPTION_CONNECTED"],
    });
  });

  it("uses a valid custom profile after a failed reception transfer", async () => {
    mocks.getRuntimeMenu.mockResolvedValueOnce(CUSTOM_RUNTIME_MENU);
    const xml = await (await statusPOST(signedStatus("failed"))).text();
    expect(xml).toContain("We could not connect you to reception.");
    expect(xml).toContain("Custom greeting for Sunrise Clinic.");
    expect(xml).toContain(`ivrRev=${CUSTOM_RUNTIME_MENU.revision}`);
    expect(mocks.observeCallEvents).toHaveBeenCalledWith(expect.objectContaining({
      providerCallUuid: "a-leg-call-0001",
      events: ["RECEPTION_FAILED", "RECEPTION_FALLBACK_TO_IVR"],
    }));
    expect(JSON.stringify(mocks.observeCallEvents.mock.calls)).not.toContain("b-leg-call-0001");
  });

  it("preserves reception fallback XML when event persistence fails", async () => {
    const baseline = await (await statusPOST(signedStatus("failed"))).text();
    mocks.observeCallEvents.mockResolvedValueOnce("write-failed");
    const degraded = await (await statusPOST(signedStatus("failed"))).text();
    expect(degraded).toBe(baseline);
  });

  it.each([
    "busy",
    "failed",
    "cancel",
    "timeout",
    "no-answer",
    "future-status",
    "",
    null,
  ])("falls directly to IVR without redial for DialStatus=%s", async (status) => {
    const xml = await (await statusPOST(signedStatus(status))).text();
    expect(xml).toContain("We could not connect you to reception.");
    expect(xml).toContain("<GetInput");
    expect(xml).not.toContain("<Dial");
    expect(xml).not.toContain("/api/webhooks/plivo/answer");
  });

  it("rejects a missing signature before resolving source state", async () => {
    const request = signedStatus();
    request.headers.delete("X-Plivo-Signature-V3");
    expect((await statusPOST(request)).status).toBe(403);
    expect(mocks.resolveClinic).not.toHaveBeenCalled();
  });

  it("rejects an invalid signature", async () => {
    const request = signedStatus();
    request.headers.set("X-Plivo-Signature-V3", "invalid");
    expect((await statusPOST(request)).status).toBe(403);
  });

  it("rejects a missing nonce", async () => {
    const request = signedStatus();
    request.headers.delete("X-Plivo-Signature-V3-Nonce");
    expect((await statusPOST(request)).status).toBe(403);
  });

  it("fails closed when the validation token is missing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    delete process.env.PLIVO_AUTH_TOKEN;
    expect((await statusPOST(signedStatus())).status).toBe(503);
  });

  it("accepts a valid signature in a comma-separated list", async () => {
    const request = signedStatus();
    const valid = request.headers.get("X-Plivo-Signature-V3");
    request.headers.set("X-Plivo-Signature-V3", `invalid,${valid},invalid-2`);
    expect((await statusPOST(request)).status).toBe(200);
  });

  it("rejects a sourceNumber tampered after signing", async () => {
    const tampered = STATUS_URL.replace(PROVIDER_NUMBER.slice(3), "9111111111");
    expect(
      (
        await statusPOST(
          signedStatus("completed", {
            url: tampered,
            signatureUrl: STATUS_URL,
          }),
        )
      ).status,
    ).toBe(403);
  });

  it("returns safe unavailable XML for an unknown signed sourceNumber", async () => {
    mocks.resolveClinic.mockResolvedValueOnce(null);
    const xml = await (await statusPOST(signedStatus())).text();
    expect(xml).toContain("Telephone assistance is not configured");
    expect(xml).not.toContain("<Dial");
  });
});
