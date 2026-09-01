import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as doctorPOST } from "@/app/api/webhooks/plivo/availability/doctor/route";
import { POST as typePOST } from "@/app/api/webhooks/plivo/availability/type/route";
import { POST as slotsPOST } from "@/app/api/webhooks/plivo/availability/slots/route";
import { FeatureError } from "@/lib/featureResolution";
import {
  buildSignedPlivoWebhookRequest,
  TEST_PLIVO_AUTH_TOKEN,
} from "../helpers/plivo";

const mocks = vi.hoisted(() => ({
  resolveClinic: vi.fn(),
  requireEntitlement: vi.fn(),
  handleDoctor: vi.fn(),
  handleType: vi.fn(),
  handleSlots: vi.fn(),
  getRuntimeMenu: vi.fn(),
}));

vi.mock("@/lib/telephony/clinicConfig", () => ({
  resolveInboundClinicByPlivoNumber: mocks.resolveClinic,
}));

vi.mock("@/lib/features", () => ({
  MODULE_FEATURES: { appointments: "appointments" },
  requireTenantFeatureEntitlement: mocks.requireEntitlement,
}));

vi.mock("@/lib/telephony/availability", () => ({
  handleDoctorMenuInput: mocks.handleDoctor,
  handleAppointmentTypeMenuInput: mocks.handleType,
  handleSlotMenuInput: mocks.handleSlots,
}));

vi.mock("@/lib/telephony/ivrRuntime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/telephony/ivrRuntime")>();
  return {
    ...actual,
    getClinicIvrRuntimeMenuForTrustedClinic: mocks.getRuntimeMenu,
  };
});

import {
  compileCustomClinicIvrRuntimeMenu,
  defaultClinicIvrRuntimeMenu,
} from "@/lib/telephony/ivrRuntime";

const originalAuthToken = process.env.PLIVO_AUTH_TOKEN;
const CLINIC = Object.freeze({
  clinicId: "clinic-a",
  tenantId: "tenant-a",
  clinicName: "Sunrise Clinic",
  timezone: "Asia/Kolkata",
  publicPhoneNumber: null,
  receptionPhoneNumber: null,
  urgentPhoneNumber: null,
});
const XML = "<Response><Speak>Stage 4 menu.</Speak></Response>";
const CUSTOM_RUNTIME_MENU = compileCustomClinicIvrRuntimeMenu(CLINIC.clinicName, {
  greetingTemplate: "Custom availability return for {clinicName}.",
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

const routes = [
  {
    label: "doctor",
    url: "https://medcare-tunnel.example/api/webhooks/plivo/availability/doctor?page=0",
    tamperedUrl:
      "https://medcare-tunnel.example/api/webhooks/plivo/availability/doctor?page=1",
    post: doctorPOST,
    handler: mocks.handleDoctor,
  },
  {
    label: "appointment type",
    url: "https://medcare-tunnel.example/api/webhooks/plivo/availability/type?doctorId=doctor-a&page=0",
    tamperedUrl:
      "https://medcare-tunnel.example/api/webhooks/plivo/availability/type?doctorId=doctor-b&page=0",
    post: typePOST,
    handler: mocks.handleType,
  },
  {
    label: "slot page",
    url: "https://medcare-tunnel.example/api/webhooks/plivo/availability/slots?doctorId=doctor-a&appointmentTypeId=type-a&offset=0",
    tamperedUrl:
      "https://medcare-tunnel.example/api/webhooks/plivo/availability/slots?doctorId=doctor-a&appointmentTypeId=type-b&offset=6",
    post: slotsPOST,
    handler: mocks.handleSlots,
  },
] as const;

describe.each(routes)("POST Stage 4 $label webhook", (route) => {
  beforeEach(() => {
    process.env.PLIVO_AUTH_TOKEN = TEST_PLIVO_AUTH_TOKEN;
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.resolveClinic.mockResolvedValue(CLINIC);
    mocks.requireEntitlement.mockResolvedValue(undefined);
    mocks.handleDoctor.mockResolvedValue(XML);
    mocks.handleType.mockResolvedValue(XML);
    mocks.handleSlots.mockResolvedValue(XML);
    mocks.getRuntimeMenu.mockResolvedValue(
      defaultClinicIvrRuntimeMenu(CLINIC.clinicName),
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

  function signed(
    url: string = route.url,
    signatureUrl: string = url,
  ): Request {
    return buildSignedPlivoWebhookRequest({
      url,
      signatureUrl,
      paramOverrides: { Digits: "1" },
    });
  }

  it("validates, resolves clinic from validated To, checks entitlement, and delegates", async () => {
    const response = await route.post(signed());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/xml; charset=utf-8",
    );
    expect(await response.text()).toBe(XML);
    expect(mocks.resolveClinic).toHaveBeenCalledWith("14155550199");
    expect(mocks.requireEntitlement).toHaveBeenCalledWith(
      "tenant-a",
      "appointments",
    );
    expect(route.handler).toHaveBeenCalledWith({
      requestUrl: route.url,
      clinic: CLINIC,
      digits: "1",
      runtimeMenu: expect.objectContaining({ source: "default" }),
    });
  });

  it("rejects a missing signature before clinic resolution", async () => {
    const request = signed();
    request.headers.delete("X-Plivo-Signature-V3");

    expect((await route.post(request)).status).toBe(403);
    expect(mocks.resolveClinic).not.toHaveBeenCalled();
  });

  it("rejects an invalid signature before clinic resolution", async () => {
    const request = signed();
    request.headers.set("X-Plivo-Signature-V3", "invalid");

    expect((await route.post(request)).status).toBe(403);
    expect(mocks.resolveClinic).not.toHaveBeenCalled();
  });

  it("rejects a missing nonce before clinic resolution", async () => {
    const request = signed();
    request.headers.delete("X-Plivo-Signature-V3-Nonce");

    expect((await route.post(request)).status).toBe(403);
    expect(mocks.resolveClinic).not.toHaveBeenCalled();
  });

  it("fails closed when the validation token is missing", async () => {
    delete process.env.PLIVO_AUTH_TOKEN;

    expect((await route.post(signed())).status).toBe(503);
    expect(mocks.resolveClinic).not.toHaveBeenCalled();
  });

  it("accepts a valid member of a comma-separated signature header", async () => {
    const request = signed();
    const valid = request.headers.get("X-Plivo-Signature-V3");
    request.headers.set("X-Plivo-Signature-V3", `invalid,${valid}`);

    expect((await route.post(request)).status).toBe(200);
    expect(route.handler).toHaveBeenCalledOnce();
  });

  it("returns generic XML for an unknown or disabled destination", async () => {
    mocks.resolveClinic.mockResolvedValueOnce(null);

    const response = await route.post(signed());
    const xml = await response.text();

    expect(response.status).toBe(200);
    expect(xml).toContain(
      "Telephone assistance is not configured for this number.",
    );
    expect(mocks.requireEntitlement).not.toHaveBeenCalled();
    expect(route.handler).not.toHaveBeenCalled();
  });

  it("returns a safe menu when tenant appointment entitlement is denied", async () => {
    mocks.getRuntimeMenu.mockResolvedValueOnce(CUSTOM_RUNTIME_MENU);
    mocks.requireEntitlement.mockRejectedValueOnce(
      new FeatureError("appointments", "entitlement"),
    );

    const response = await route.post(signed());
    const xml = await response.text();

    expect(response.status).toBe(200);
    expect(xml).toContain(
      "Telephone appointment availability is not available for this clinic.",
    );
    expect(xml).toContain("Custom availability return for Sunrise Clinic.");
    expect(xml).toContain(`ivrRev=${CUSTOM_RUNTIME_MENU.revision}`);
    expect(route.handler).not.toHaveBeenCalled();
  });

  it("rejects tampering with signed query state", async () => {
    const response = await route.post(signed(route.tamperedUrl, route.url));

    expect(response.status).toBe(403);
    expect(mocks.resolveClinic).not.toHaveBeenCalled();
    expect(route.handler).not.toHaveBeenCalled();
  });

  it("uses controlled 5xx behavior for infrastructure failures", async () => {
    route.handler.mockRejectedValueOnce(new Error("database unavailable"));

    const response = await route.post(signed());

    expect(response.status).toBe(503);
    expect(await response.text()).toBe("Service unavailable.");
  });
});

describe("independent signed slot-state binding", () => {
  const signedUrl =
    "https://medcare-tunnel.example/api/webhooks/plivo/availability/slots?doctorId=doctor-a&appointmentTypeId=type-a&offset=0";

  beforeEach(() => {
    process.env.PLIVO_AUTH_TOKEN = TEST_PLIVO_AUTH_TOKEN;
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.resolveClinic.mockResolvedValue(CLINIC);
    mocks.requireEntitlement.mockResolvedValue(undefined);
    mocks.handleSlots.mockResolvedValue(XML);
  });

  afterEach(() => {
    if (originalAuthToken === undefined) {
      delete process.env.PLIVO_AUTH_TOKEN;
    } else {
      process.env.PLIVO_AUTH_TOKEN = originalAuthToken;
    }
  });

  it.each([
    [
      "appointmentTypeId",
      "https://medcare-tunnel.example/api/webhooks/plivo/availability/slots?doctorId=doctor-a&appointmentTypeId=type-b&offset=0",
    ],
    [
      "offset",
      "https://medcare-tunnel.example/api/webhooks/plivo/availability/slots?doctorId=doctor-a&appointmentTypeId=type-a&offset=6",
    ],
  ])("rejects changing %s after signing", async (_field, requestUrl) => {
    const request = buildSignedPlivoWebhookRequest({
      url: requestUrl,
      signatureUrl: signedUrl,
      paramOverrides: { Digits: "8" },
    });

    expect((await slotsPOST(request)).status).toBe(403);
    expect(mocks.resolveClinic).not.toHaveBeenCalled();
    expect(mocks.handleSlots).not.toHaveBeenCalled();
  });
});
