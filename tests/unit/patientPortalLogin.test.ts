import { describe, it, expect, vi } from "vitest";
const mock = vi.hoisted(() => ({
  compare: vi.fn().mockResolvedValue(false),
  find: vi.fn().mockResolvedValue(null),
  audit: vi.fn().mockResolvedValue({}),
}));
vi.mock("bcryptjs", () => ({ default: { compare: mock.compare } }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    patientPortalLink: { findFirst: mock.find },
    patientPortalAuditEvent: { create: mock.audit },
  },
}));
import {
  loginPatientPortal,
  DUMMY_PATIENT_HASH,
  portalPasswordInput,
} from "@/lib/patientPortalPasswordAuth";
describe("Patient Portal dummy bcrypt path", () => {
  it.each(["unknown-org", "valid-looking-org"])(
    "compares dummy cost-12 hash for absent %s identity",
    async (organization) => {
      await expect(
        loginPatientPortal({
          organization,
          patientCode: "PT-001",
          password: "synthetic passphrase",
        }),
      ).rejects.toMatchObject({
        status: 400,
        message: "Invalid sign-in details.",
      });
      expect(mock.compare).toHaveBeenLastCalledWith(
        portalPasswordInput("synthetic passphrase"),
        DUMMY_PATIENT_HASH,
      );
      expect(mock.audit).toHaveBeenLastCalledWith({
        data: { event: "PORTAL_LOGIN_FAILED" },
      });
      expect(mock.find).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            patient: { patientCode: "PT-001", tenant: { slug: organization } },
          }),
        }),
      );
    },
  );
});
