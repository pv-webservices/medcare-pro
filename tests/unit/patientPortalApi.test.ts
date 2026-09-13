import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@/lib/session", () => ({
  UnauthenticatedError: class extends Error {},
}));
const mocks = vi.hoisted(() => ({
  limit: vi.fn().mockResolvedValue(undefined),
  reset: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/patientPortalPasswordAuth", () => ({
  portalAuthRateLimit: mocks.limit,
  requestPatientPasswordReset: mocks.reset,
}));
import { POST } from "@/app/api/patient-portal/[...path]/route";
import { PORTAL_RESET_MESSAGE } from "@/lib/patientPortalSecurity";
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
});
