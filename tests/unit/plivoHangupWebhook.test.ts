import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSignedPlivoWebhookRequest,
  TEST_PLIVO_AUTH_TOKEN,
} from "../helpers/plivo";

const mocks = vi.hoisted(() => ({
  resolveClinic: vi.fn(),
  completeCall: vi.fn(),
  requireTenantFeatureEntitlement: vi.fn(),
}));

vi.mock("@/lib/features", () => ({
  MODULE_FEATURES: { appointments: "appointments", ivr: "ivr" },
  requireTenantFeatureEntitlement: mocks.requireTenantFeatureEntitlement,
}));

vi.mock("@/lib/telephony/clinicConfig", () => ({
  resolveInboundClinicByPlivoNumber: mocks.resolveClinic,
}));
vi.mock("@/lib/telephony/callObservability", () => ({
  completeObservedProductionCall: mocks.completeCall,
}));

import { POST } from "@/app/api/webhooks/plivo/hangup/route";

const URL = "https://voice.medcare.example/api/webhooks/plivo/hangup";
const CALL_UUID = "4f7b0f40-4c0a-11ef-b5d8-0242ac120002";
const PROVIDER_NUMBER = "+919000000001";
const CALLER_NUMBER = "+919876544821";
const originalAuthToken = process.env.PLIVO_AUTH_TOKEN;
const originalPublicOrigin = process.env.PLIVO_PUBLIC_WEBHOOK_ORIGIN;

function signed(overrides: Record<string, string> = {}): Request {
  return buildSignedPlivoWebhookRequest({
    url: URL,
    paramOverrides: {
      CallUUID: CALL_UUID,
      From: CALLER_NUMBER,
      To: PROVIDER_NUMBER,
      Direction: "inbound",
      CallStatus: "completed",
      Duration: "125",
      HangupCauseName: "Normal Hangup",
      HangupCauseCode: "1000",
      HangupSource: "Caller",
      ...overrides,
    },
  });
}

describe("POST /api/webhooks/plivo/hangup", () => {
  beforeEach(() => {
    process.env.PLIVO_AUTH_TOKEN = TEST_PLIVO_AUTH_TOKEN;
    delete process.env.PLIVO_PUBLIC_WEBHOOK_ORIGIN;
    mocks.resolveClinic.mockReset().mockResolvedValue({
      clinicId: "clinic-a",
      tenantId: "tenant-a",
      clinicName: "Sunrise Clinic",
    });
    mocks.completeCall.mockReset().mockResolvedValue("recorded");
    mocks.requireTenantFeatureEntitlement.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalAuthToken === undefined) delete process.env.PLIVO_AUTH_TOKEN;
    else process.env.PLIVO_AUTH_TOKEN = originalAuthToken;
    if (originalPublicOrigin === undefined) delete process.env.PLIVO_PUBLIC_WEBHOOK_ORIGIN;
    else process.env.PLIVO_PUBLIC_WEBHOOK_ORIGIN = originalPublicOrigin;
  });

  it.each(["missing", "invalid"])("rejects a %s V3 signature before clinic lookup", async (kind) => {
    const request = signed();
    if (kind === "missing") request.headers.delete("X-Plivo-Signature-V3");
    else request.headers.set("X-Plivo-Signature-V3", "invalid");
    const response = await POST(request);
    expect(response.status).toBe(403);
    expect(mocks.resolveClinic).not.toHaveBeenCalled();
    expect(mocks.completeCall).not.toHaveBeenCalled();
  });

  it("fails closed when V3 validation is not configured", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    delete process.env.PLIVO_AUTH_TOKEN;
    const response = await POST(signed());
    expect(response.status).toBe(503);
    expect(mocks.resolveClinic).not.toHaveBeenCalled();
  });

  it("completes only by validated To, CallUUID, and bounded-duration input", async () => {
    const response = await POST(signed());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
    expect(mocks.resolveClinic).toHaveBeenCalledWith(PROVIDER_NUMBER);
    expect(mocks.completeCall).toHaveBeenCalledWith({
      clinicId: "clinic-a",
      providerCallUuid: CALL_UUID,
      duration: "125",
    });
  });

  it("accepts duplicate completion idempotently", async () => {
    expect((await POST(signed())).status).toBe(200);
    expect((await POST(signed())).status).toBe(200);
    expect(mocks.completeCall).toHaveBeenCalledTimes(2);
  });

  it.each(["unknown-call", "clinic-mismatch", "invalid-call", "write-failed"])(
    "deterministically accepts a safely ignored %s result",
    async (result) => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      mocks.completeCall.mockResolvedValueOnce(result);
      expect((await POST(signed())).status).toBe(200);
    },
  );

  it("accepts an unknown inbound To without inventing a recovery row", async () => {
    mocks.resolveClinic.mockResolvedValueOnce(null);
    const response = await POST(signed({ To: "+919000000099" }));
    expect(response.status).toBe(200);
    expect(mocks.completeCall).not.toHaveBeenCalled();
  });

  it("does not pass caller, cause, provider destination, or arbitrary scope to storage", async () => {
    const response = await POST(signed({
      clinicId: "clinic-b",
      tenantId: "tenant-b",
      DialBLegUUID: "private-b-leg-uuid",
    }));
    const storageInput = JSON.stringify(mocks.completeCall.mock.calls[0][0]);
    expect(storageInput).not.toContain(CALLER_NUMBER);
    expect(storageInput).not.toContain(PROVIDER_NUMBER);
    expect(storageInput).not.toContain("Normal Hangup");
    expect(storageInput).not.toContain("1000");
    expect(storageInput).not.toContain("private-b-leg-uuid");
    expect(storageInput).not.toContain("clinic-b");
    expect(await response.text()).toBe("");
  });

  it("rejects a tampered clinic authority field", async () => {
    const request = buildSignedPlivoWebhookRequest({
      url: URL,
      signatureUrl: `${URL}?tenantId=tenant-a`,
      paramOverrides: { To: PROVIDER_NUMBER },
    });
    expect((await POST(request)).status).toBe(403);
    expect(mocks.resolveClinic).not.toHaveBeenCalled();
  });

  it("contains unexpected persistence-layer failures to prevent retry loops", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.completeCall.mockRejectedValueOnce(new Error("database offline"));
    expect((await POST(signed())).status).toBe(200);
  });
});
