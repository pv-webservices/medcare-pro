import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clinicFindFirst: vi.fn(),
  decrypt: vi.fn().mockReturnValue("decrypted-key"),
  getStatus: vi.fn(),
  deviceUpdateMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    clinic: { findFirst: mocks.clinicFindFirst },
    whatsappDevice: { updateMany: mocks.deviceUpdateMany },
  },
}));

vi.mock("@/lib/whatsapp", () => ({ getDeviceStatus: mocks.getStatus }));

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
} from "@/lib/whatsappProviderConfig";
import { connectWhatsappDeviceSchema } from "@/lib/whatsappDeviceManagement";

function device(id: string, sender: string) {
  return {
    id,
    tenantId: "tenant-a",
    phoneNumber: sender,
    enabled: true,
    connectionStatus: "CONNECTED",
    lastStatusCheckedAt: new Date(),
    providerAccount: {
      id: `account-${id}`,
      tenantId: "tenant-a",
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
        usedFallback: false,
      });
    expect(mocks.decrypt).toHaveBeenCalledWith(
      "encrypted-clinic-device",
      "tenant-a",
      "account-clinic-device",
    );
  });

  it("uses backup only when inherited primary is positively disconnected", async () => {
    const primary = { ...device("primary", "919111111111"), connectionStatus: "DISCONNECTED" };
    const backup = device("backup", "919222222222");
    mocks.clinicFindFirst.mockResolvedValueOnce({
      whatsappSettings: null,
      tenant: { whatsappSettings: { automaticFailover: true, defaultDevice: primary, backupDevice: backup } },
    });
    await expect(resolveWhatsappConfigForClinic("tenant-a", "clinic-a"))
      .resolves.toMatchObject({ deviceId: "backup", sender: "919222222222", usedFallback: true });

    mocks.clinicFindFirst.mockResolvedValueOnce({
      whatsappSettings: null,
      tenant: { whatsappSettings: { automaticFailover: true, defaultDevice: { ...primary, connectionStatus: "UNKNOWN" }, backupDevice: backup } },
    });
    await expect(resolveWhatsappConfigForClinic("tenant-a", "clinic-a"))
      .resolves.toMatchObject({ deviceId: "primary", usedFallback: false });
  });

  it("refreshes stale primary and backup status only when failover is enabled", async () => {
    const stale = new Date(Date.now() - 10 * 60 * 1000);
    const primary = { ...device("primary", "919111111111"), connectionStatus: "CONNECTED", lastStatusCheckedAt: stale };
    const backup = { ...device("backup", "919222222222"), lastStatusCheckedAt: stale };
    mocks.clinicFindFirst.mockResolvedValue({
      whatsappSettings: null,
      tenant: { whatsappSettings: { automaticFailover: true, defaultDevice: primary, backupDevice: backup } },
    });
    mocks.getStatus
      .mockResolvedValueOnce({ ok: true, device: { connected: false, status: "Disconnected" } })
      .mockResolvedValueOnce({ ok: true, device: { connected: true, status: "Connected" } });
    await expect(resolveWhatsappConfigForClinic("tenant-a", "clinic-a"))
      .resolves.toMatchObject({ deviceId: "backup", usedFallback: true });
    expect(mocks.getStatus).toHaveBeenCalledTimes(2);

    mocks.getStatus.mockClear();
    mocks.clinicFindFirst.mockResolvedValue({
      whatsappSettings: null,
      tenant: { whatsappSettings: { automaticFailover: false, defaultDevice: primary, backupDevice: backup } },
    });
    await resolveWhatsappConfigForClinic("tenant-a", "clinic-a");
    expect(mocks.getStatus).not.toHaveBeenCalled();
  });

  it("never applies organisation backup to a clinic-specific device", async () => {
    mocks.clinicFindFirst.mockResolvedValue({
      whatsappSettings: { device: { ...device("clinic", "919333333333"), connectionStatus: "DISCONNECTED" } },
      tenant: { whatsappSettings: { automaticFailover: true, defaultDevice: device("primary", "919111111111"), backupDevice: device("backup", "919222222222") } },
    });
    await expect(resolveWhatsappConfigForClinic("tenant-a", "clinic-a"))
      .resolves.toMatchObject({ deviceId: "clinic", usedFallback: false });
  });

  it("fails closed when primary and backup are both disconnected", async () => {
    const disconnected = (id: string, sender: string) => ({ ...device(id, sender), connectionStatus: "DISCONNECTED" });
    mocks.clinicFindFirst.mockResolvedValue({ whatsappSettings: null, tenant: { whatsappSettings: { automaticFailover: true, defaultDevice: disconnected("primary", "919111111111"), backupDevice: disconnected("backup", "919222222222") } } });
    await expect(resolveWhatsappConfigForClinic("tenant-a", "clinic-a")).resolves.toBeNull();
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
    expect(connectWhatsappDeviceSchema.safeParse({
      name: "Primary",
      phoneNumber: "rotate",
    }).success).toBe(false);

    const parsed = connectWhatsappDeviceSchema.parse({
      name: "Primary",
      phoneNumber: "+91 98765-43210",
    });
    expect(parsed.phoneNumber).toBe("919876543210");
  });
});
