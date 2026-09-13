import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@/lib/session", () => ({
  UnauthenticatedError: class extends Error {},
}));
const mocks = vi.hoisted(() => ({
  limit: vi.fn().mockResolvedValue(undefined),
  reset: vi.fn().mockResolvedValue(undefined),
  login: vi.fn().mockResolvedValue("mock-session-token"),
  resetPassword: vi.fn().mockResolvedValue({ tenantSlug: "sharma-clinic" }),
  verifyEmail: vi.fn().mockResolvedValue({ tenantSlug: "sharma-clinic" }),
}));
vi.mock("@/lib/patientPortalPasswordAuth", () => ({
  portalAuthRateLimit: mocks.limit,
  requestPatientPasswordReset: mocks.reset,
  loginPatientPortal: mocks.login,
  resetPatientPassword: mocks.resetPassword,
  verifyPatientRecoveryEmail: mocks.verifyEmail,
}));
import { POST } from "@/app/api/patient-portal/[...path]/route";
import {
  PORTAL_RESET_MESSAGE,
  PatientPortalError,
} from "@/lib/patientPortalSecurity";
beforeEach(() => {
  vi.stubEnv("AUTH_URL", "https://clinic.example");
  vi.clearAllMocks();
});
const request = (
  path: string,
  body: unknown,
  origin: string | null = "https://clinic.example",
) =>
  POST(
    new Request(`https://clinic.example/api/patient-portal/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(origin ? { origin } : {}),
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ path: path.split("/") }) },
  );
describe("Patient Portal public API privacy", () => {
  it.each([
    {
      organization: "unknown",
      patientCode: "PT-001",
      email: "unknown@example.test",
    },
    {
      organization: "valid-org",
      patientCode: "UNKNOWN",
      email: "patient@example.test",
    },
    {
      organization: "valid-org",
      patientCode: "PT-001",
      email: "wrong@example.test",
    },
    {
      organization: "valid-org",
      patientCode: "PT-001",
      email: "patient@example.test",
    },
    { organization: "!invalid", patientCode: "PT-001", email: "not-email" },
  ])("reset request always returns neutral response for %j", async (body) => {
    const response = await request("auth/forgot-password", body);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: { message: PORTAL_RESET_MESSAGE },
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("rejects browser identity authority before recovery service", async () => {
    await request("auth/forgot-password", {
      organization: "clinic",
      patientCode: "PT-001",
      email: "patient@example.test",
      patientId: "other",
    });
    expect(mocks.reset).not.toHaveBeenCalled();
  });
  it.each([null, "https://evil.example"])(
    "rejects missing/foreign origin %s before service",
    async (origin) => {
      const response = await request("auth/forgot-password", {}, origin);
      expect(response.status).toBe(403);
      expect(mocks.limit).not.toHaveBeenCalled();
      expect(mocks.reset).not.toHaveBeenCalled();
    },
  );
  it.each([
    "auth/login/request",
    "auth/login/verify",
    "auth/activation/request",
    "auth/activation/verify",
  ])("retired OTP route %s is unavailable", async (path) =>
    expect((await request(path, {})).status).toBe(404),
  );

  it("provides format guidance when organization fails slug format without DB disclosure", async () => {
    const response = await request("auth/login", {
      organization: "Sharma Clinic",
      patientCode: "PT-001",
      password: "password123",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      error: "Enter your Clinic Access Code, for example sharma-clinic.",
    });
    expect(mocks.login).not.toHaveBeenCalled();
  });

  it("returns generic sign-in failure for syntactically valid unknown slug", async () => {
    mocks.login.mockRejectedValueOnce(
      new PatientPortalError(400, "Invalid sign-in details."),
    );
    const response = await request("auth/login", {
      organization: "unknown-org",
      patientCode: "PT-001",
      password: "password123",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      error: "Invalid sign-in details.",
    });
    expect(mocks.login).toHaveBeenCalledWith(
      expect.objectContaining({ organization: "unknown-org" }),
      expect.any(Object),
    );
  });

  it("returns tenantSlug upon successful password reset", async () => {
    const token = "a".repeat(43);
    const response = await request("auth/reset-password", {
      token,
      password: "new-password-123",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: {
        message: "Password updated. Sign in with your new password.",
        tenantSlug: "sharma-clinic",
      },
    });
    expect(mocks.resetPassword).toHaveBeenCalledWith({
      token,
      password: "new-password-123",
    });
  });

  it("returns tenantSlug upon successful recovery email verification", async () => {
    const token = "b".repeat(43);
    const response = await request("auth/verify-email", {
      token,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: {
        message: "Recovery email verified.",
        tenantSlug: "sharma-clinic",
      },
    });
    expect(mocks.verifyEmail).toHaveBeenCalledWith(token);
  });
});
