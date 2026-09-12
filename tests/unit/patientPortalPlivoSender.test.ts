import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPatientPortalPlivoSender,
  type PlivoMessagesClient,
} from "@/lib/telephony/patientPortalPlivoSender";
import { patientPortalSender } from "@/lib/patientPortalSender";

describe("PatientPortalPlivoSender", () => {
  let mockCreate: ReturnType<typeof vi.fn>;
  let mockClient: PlivoMessagesClient;

  beforeEach(() => {
    mockCreate = vi.fn();
    mockClient = {
      messages: {
        create: mockCreate,
      },
    };
  });

  describe("Configuration validation", () => {
    it("fails closed when auth credentials are missing", () => {
      expect(() =>
        createPatientPortalPlivoSender({
          authId: "",
          authToken: "",
          senderId: "+14155550100",
        }),
      ).toThrow(/missing credentials/i);
    });

    it("fails closed when sender ID is missing", () => {
      expect(() =>
        createPatientPortalPlivoSender({
          authId: "AUTH123",
          authToken: "TOKEN123",
          senderId: "",
        }),
      ).toThrow(/missing sender number/i);
    });
  });

  describe("OTP delivery behavior", () => {
    it("sends login OTP with correct normalized destination and minimal security text without clinical data", async () => {
      mockCreate.mockResolvedValueOnce({
        messageUuid: ["msg-uuid-12345"],
        message: "message(s) queued",
      });

      const sender = createPatientPortalPlivoSender({
        authId: "AUTH123",
        authToken: "TOKEN123",
        senderId: "+14155550100",
        client: mockClient,
      });

      await sender.sendLoginCode({
        mobileE164: "+919876543210",
        code: "654321",
        purpose: "LOGIN",
      });

      expect(mockCreate).toHaveBeenCalledTimes(1);
      const [src, dst, text, options] = mockCreate.mock.calls[0];
      expect(src).toBe("+14155550100");
      expect(dst).toBe("+919876543210");
      expect(text).toContain("654321");
      expect(text).toContain("Your MEDCARE PRO verification code is 654321");
      expect(text).toContain("expires in 10 minutes");
      // Explicit privacy option passed to Plivo SDK to suppress logging on provider infrastructure
      expect(options).toEqual({ log: false });
      // Must not leak clinical information
      expect(text).not.toMatch(/prescription|diagnosis|doctor|clinic|visit/i);
    });

    it("sends activation OTP with correct destination", async () => {
      mockCreate.mockResolvedValueOnce({
        messageUuid: ["msg-uuid-activation-1"],
      });

      const sender = createPatientPortalPlivoSender({
        authId: "AUTH123",
        authToken: "TOKEN123",
        senderId: "+14155550100",
        client: mockClient,
      });

      await sender.sendLoginCode({
        mobileE164: "+919876543210",
        code: "123456",
        purpose: "ACTIVATION",
      });

      expect(mockCreate).toHaveBeenCalledTimes(1);
      const [src, dst, text] = mockCreate.mock.calls[0];
      expect(src).toBe("+14155550100");
      expect(dst).toBe("+919876543210");
      expect(text).toContain("123456");
    });

    it("sends portal activation link with correct destination without clinical data", async () => {
      mockCreate.mockResolvedValueOnce({
        messageUuid: ["msg-uuid-link-1"],
      });

      const sender = createPatientPortalPlivoSender({
        authId: "AUTH123",
        authToken: "TOKEN123",
        senderId: "+14155550100",
        client: mockClient,
      });

      const testUrl = "https://staging.example.com/patient/activate/token-abc-123";
      await sender.sendActivation({
        mobileE164: "+919876543210",
        activationUrl: testUrl,
      });

      expect(mockCreate).toHaveBeenCalledTimes(1);
      const [src, dst, text, options] = mockCreate.mock.calls[0];
      expect(src).toBe("+14155550100");
      expect(dst).toBe("+919876543210");
      expect(text).toContain(testUrl);
      expect(text).toContain("expires in 24 hours");
      expect(options).toEqual({ log: false });
      expect(text).not.toMatch(/prescription|diagnosis|doctor|clinic|visit/i);
    });
  });

  describe("Privacy and log hygiene", () => {
    it("never prints raw OTPs or activation tokens to stdout/stderr console logs", async () => {
      const consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      mockCreate.mockResolvedValueOnce({
        messageUuid: ["msg-uuid-safe-1"],
      });

      const sender = createPatientPortalPlivoSender({
        authId: "AUTH123",
        authToken: "TOKEN123",
        senderId: "+14155550100",
        client: mockClient,
      });

      const sensitiveOtp = "987654";
      await sender.sendLoginCode({
        mobileE164: "+919876543210",
        code: sensitiveOtp,
        purpose: "LOGIN",
      });

      // Verify no console call printed the sensitive OTP
      const allInfoOutput = consoleInfoSpy.mock.calls.flat().join(" ");
      const allErrorOutput = consoleErrorSpy.mock.calls.flat().join(" ");

      expect(allInfoOutput).not.toContain(sensitiveOtp);
      expect(allErrorOutput).not.toContain(sensitiveOtp);
      // Verify phone number is masked in logs
      expect(allInfoOutput).not.toContain("+919876543210");
      expect(allInfoOutput).toContain("+91****210");

      consoleInfoSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });
  });

  describe("Provider error handling and fail-closed behavior", () => {
    it("throws 503 PatientPortalError when Plivo rejects the send request", async () => {
      mockCreate.mockRejectedValueOnce(new Error("Plivo API Error: Invalid destination"));

      const sender = createPatientPortalPlivoSender({
        authId: "AUTH123",
        authToken: "TOKEN123",
        senderId: "+14155550100",
        client: mockClient,
      });

      await expect(
        sender.sendLoginCode({
          mobileE164: "+919876543210",
          code: "123456",
          purpose: "LOGIN",
        }),
      ).rejects.toThrow(/Failed to deliver verification code/i);
    });

    it("throws 503 PatientPortalError on network timeout", async () => {
      mockCreate.mockRejectedValueOnce(new Error("ETIMEDOUT: Connection timed out"));

      const sender = createPatientPortalPlivoSender({
        authId: "AUTH123",
        authToken: "TOKEN123",
        senderId: "+14155550100",
        client: mockClient,
      });

      await expect(
        sender.sendActivation({
          mobileE164: "+919876543210",
          activationUrl: "https://staging.example.com/patient/activate/123",
        }),
      ).rejects.toThrow(/Failed to deliver portal activation message/i);
    });
  });

  describe("patientPortalSender factory resolution", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    it("resolves Plivo sender when PATIENT_PORTAL_DELIVERY_PROVIDER=plivo", async () => {
      process.env.PATIENT_PORTAL_DELIVERY_PROVIDER = "plivo";
      process.env.PLIVO_AUTH_ID = "AUTH_TEST";
      process.env.PLIVO_AUTH_TOKEN = "TOKEN_TEST";
      process.env.PATIENT_PORTAL_SMS_SENDER = "+14155550100";

      const sender = await patientPortalSender();
      expect(sender).toBeDefined();
      expect(typeof sender.sendActivation).toBe("function");
      expect(typeof sender.sendLoginCode).toBe("function");
    });

    it("fails closed when PATIENT_PORTAL_DELIVERY_PROVIDER is unset and test transport is unset", async () => {
      delete process.env.PATIENT_PORTAL_DELIVERY_PROVIDER;
      delete process.env.PATIENT_PORTAL_TEST_TRANSPORT;

      await expect(patientPortalSender()).rejects.toThrow(
        /Patient Portal verification delivery is unavailable/i,
      );
    });
  });
});
