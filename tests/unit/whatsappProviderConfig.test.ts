import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clinicFindFirst: vi.fn(),
  decrypt: vi.fn().mockReturnValue("decrypted-key"),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    clinic: { findFirst: mocks.clinicFindFirst },
  },
}));

vi.mock("@/lib/apiHandler", () => ({
  BadRequestError: class BadRequestError extends Error {},
  ConflictError: class ConflictError extends Error {},
}));

vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: {},
  writeAuditLog: vi.fn(),
}));

vi.mock("@/lib/rbac", () => ({
  can: vi.fn(),
  requirePermission: vi.fn(),
  PermissionError: class PermissionError extends Error {},
}));

vi.mock("@/lib/whatsappCredentialCrypto", () => ({
  decryptWhatsappApiKey: mocks.decrypt,
  encryptWhatsappApiKey: vi.fn(),
}));

import {
  resolveWhatsappConfigForClinic,
  saveWhatsappDeviceSchema,
} from "@/lib/whatsappProviderConfig";

function device(id: string, sender: string) {
  return {
    id,
    tenantId: "tenant-a",
    phoneNumber: sender,
    enabled: true,
    providerAccount: {
      id: `account-${id}`,
      enabled: true,
      apiBaseUrl: "https://bot.rkvrobo.in/api/",
      encryptedApiKey: `encrypted-${id}`,
    },
  };
}

describe("tenant WhatsApp provider routing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the clinic override before the organisation default", async () => {
    mocks.clinicFindFirst.mockResolvedValue({
      whatsappSettings: { device: device("clinic-device", "919111111111") },
      tenant: { whatsappSettings: { defaultDevice: device("default-device", "919222222222") } },
    });

    await expect(resolveWhatsappConfigForClinic("tenant-a", "clinic-a"))
      .resolves.toEqual({
        apiKey: "decrypted-key",
        baseUrl: "https://bot.rkvrobo.in/api",
        deviceId: "clinic-device",
        providerAccountId: "account-clinic-device",
        sender: "919111111111",
      });
    expect(mocks.decrypt).toHaveBeenCalledWith(
      "encrypted-clinic-device",
      "tenant-a",
      "account-clinic-device",
    );
  });

  it("falls back to the organisation default and fails closed for inactive devices", async () => {
    const fallback = device("default-device", "919222222222");
    mocks.clinicFindFirst.mockResolvedValueOnce({
      whatsappSettings: null,
      tenant: { whatsappSettings: { defaultDevice: fallback } },
    });
    await expect(resolveWhatsappConfigForClinic("tenant-a", "clinic-a"))
      .resolves.toMatchObject({ sender: "919222222222" });

    mocks.clinicFindFirst.mockResolvedValueOnce({
      whatsappSettings: { device: { ...fallback, enabled: false } },
      tenant: { whatsappSettings: null },
    });
    await expect(resolveWhatsappConfigForClinic("tenant-a", "clinic-a"))
      .resolves.toBeNull();
  });

  it("rejects rotation and normalises a deterministic device number", () => {
    expect(saveWhatsappDeviceSchema.safeParse({
      providerAccountId: "account-a",
      name: "Primary",
      phoneNumber: "rotate",
    }).success).toBe(false);

    const parsed = saveWhatsappDeviceSchema.parse({
      providerAccountId: "account-a",
      name: "Primary",
      phoneNumber: "+91 98765-43210",
    });
    expect(parsed.phoneNumber).toBe("919876543210");
  });
});
