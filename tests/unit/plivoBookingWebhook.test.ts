import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeatureError } from "@/lib/featureResolution";
import {
  buildSignedPlivoWebhookRequest,
  TEST_PLIVO_AUTH_TOKEN,
} from "../helpers/plivo";

const mocks = vi.hoisted(() => ({
  resolveClinic: vi.fn(),
  requireEntitlement: vi.fn(),
  identity: vi.fn(),
  doctor: vi.fn(),
  type: vi.fn(),
  slots: vi.fn(),
  confirm: vi.fn(),
  getRuntimeMenu: vi.fn(),
}));

vi.mock("@/lib/telephony/clinicConfig", () => ({
  resolveInboundClinicByPlivoNumber: mocks.resolveClinic,
}));
vi.mock("@/lib/features", () => ({
  MODULE_FEATURES: { appointments: "appointments" },
  requireTenantFeatureEntitlement: mocks.requireEntitlement,
}));
vi.mock("@/lib/telephony/booking", () => ({
  handleBookingIdentityInput: mocks.identity,
  handleBookingDoctorInput: mocks.doctor,
  handleBookingTypeInput: mocks.type,
  handleBookingSlotInput: mocks.slots,
  handleBookingConfirmationInput: mocks.confirm,
}));
vi.mock("@/lib/telephony/ivrRuntime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/telephony/ivrRuntime")>();
  return {
    ...actual,
    getClinicIvrRuntimeMenuForTrustedClinic: mocks.getRuntimeMenu,
  };
});

import { POST as identityPost } from "@/app/api/webhooks/plivo/booking/identity/route";
import { POST as doctorPost } from "@/app/api/webhooks/plivo/booking/doctor/route";
import { POST as typePost } from "@/app/api/webhooks/plivo/booking/type/route";
import { POST as slotsPost } from "@/app/api/webhooks/plivo/booking/slots/route";
import { POST as confirmPost } from "@/app/api/webhooks/plivo/booking/confirm/route";
import {
  compileCustomClinicIvrRuntimeMenu,
  defaultClinicIvrRuntimeMenu,
} from "@/lib/telephony/ivrRuntime";

const originalToken = process.env.PLIVO_AUTH_TOKEN;
const clinic = Object.freeze({
  clinicId: "clinic-a",
  tenantId: "tenant-a",
  clinicName: "Sunrise Clinic",
  timezone: "Asia/Kolkata",
  publicPhoneNumber: null,
  receptionPhoneNumber: null,
  urgentPhoneNumber: null,
});
const customRuntimeMenu = compileCustomClinicIvrRuntimeMenu(clinic.clinicName, {
  greetingTemplate: "Custom booking return for {clinicName}.",
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
  ["identity", identityPost, mocks.identity],
  ["doctor", doctorPost, mocks.doctor],
  ["type", typePost, mocks.type],
  ["slots", slotsPost, mocks.slots],
  ["confirm", confirmPost, mocks.confirm],
] as const;

function requestFor(path: string): Request {
  return buildSignedPlivoWebhookRequest({
    url: `https://medcare.example/api/webhooks/plivo/booking/${path}`,
    paramOverrides: { Digits: "1" },
  });
}

describe("every Stage 5 booking webhook", () => {
  beforeEach(() => {
    process.env.PLIVO_AUTH_TOKEN = TEST_PLIVO_AUTH_TOKEN;
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.resolveClinic.mockResolvedValue(clinic);
    mocks.requireEntitlement.mockResolvedValue(undefined);
    mocks.getRuntimeMenu.mockResolvedValue(
      defaultClinicIvrRuntimeMenu(clinic.clinicName),
    );
    for (const handler of [mocks.identity, mocks.doctor, mocks.type, mocks.slots, mocks.confirm]) {
      handler.mockResolvedValue("<Response><Speak>Safe booking response.</Speak></Response>");
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalToken === undefined) delete process.env.PLIVO_AUTH_TOKEN;
    else process.env.PLIVO_AUTH_TOKEN = originalToken;
  });

  it.each(routes)("%s rejects a missing signature", async (path, post, handler) => {
    const request = requestFor(path);
    request.headers.delete("X-Plivo-Signature-V3");
    expect((await post(request)).status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it.each(routes)("%s rejects an invalid signature", async (path, post, handler) => {
    const request = requestFor(path);
    request.headers.set("X-Plivo-Signature-V3", "invalid");
    expect((await post(request)).status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it.each(routes)("%s rejects a missing nonce", async (path, post, handler) => {
    const request = requestFor(path);
    request.headers.delete("X-Plivo-Signature-V3-Nonce");
    expect((await post(request)).status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it.each(routes)("%s fails closed without the auth token", async (path, post) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    delete process.env.PLIVO_AUTH_TOKEN;
    expect((await post(requestFor(path))).status).toBe(503);
  });

  it.each(routes)("%s accepts a valid signature list", async (path, post, handler) => {
    const request = requestFor(path);
    const valid = request.headers.get("X-Plivo-Signature-V3");
    request.headers.set("X-Plivo-Signature-V3", `invalid,${valid},invalid-two`);
    const response = await post(request);
    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        clinic,
        digits: "1",
        from: expect.any(String),
        callUuid: expect.any(String),
      }),
    );
  });

  it.each(routes)("%s returns generic XML for an unknown or disabled To", async (path, post, handler) => {
    mocks.resolveClinic.mockResolvedValueOnce(null);
    const response = await post(requestFor(path));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("not configured for this number");
    expect(handler).not.toHaveBeenCalled();
  });

  it.each(routes)(
    "%s preserves a valid custom menu when booking entitlement is denied",
    async (path, post, handler) => {
      mocks.getRuntimeMenu.mockResolvedValueOnce(customRuntimeMenu);
      mocks.requireEntitlement.mockRejectedValueOnce(
        new FeatureError("appointments", "entitlement"),
      );
      const response = await post(requestFor(path));
      const xml = await response.text();
      expect(response.status).toBe(200);
      expect(handler).not.toHaveBeenCalled();
      expect(xml).toContain("Custom booking return for Sunrise Clinic.");
      expect(xml).toContain(`ivrRev=${customRuntimeMenu.revision}`);
    },
  );

  it.each([
    ["doctor", doctorPost, "page", "0", "1"],
    ["type", typePost, "doctorId", "doctor-a", "doctor-b"],
    ["type", typePost, "page", "0", "1"],
    ["slots", slotsPost, "offset", "0", "6"],
    ["confirm", confirmPost, "startTime", "09:00", "10:00"],
  ] as const)(
    "%s rejects post-signature tampering of %s",
    async (path, post, key, original, tampered) => {
      const signed = buildSignedPlivoWebhookRequest({
        url: `https://medcare.example/api/webhooks/plivo/booking/${path}?${key}=${encodeURIComponent(original)}`,
        paramOverrides: { Digits: "1" },
      });
      const body = await signed.text();
      const request = new Request(
        `https://medcare.example/api/webhooks/plivo/booking/${path}?${key}=${encodeURIComponent(tampered)}`,
        { method: "POST", headers: signed.headers, body },
      );
      expect((await post(request)).status).toBe(403);
    },
  );
});
