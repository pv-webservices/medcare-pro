import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  decrypt: vi.fn().mockReturnValue("tenant-api-key"),
  generateQr: vi.fn(),
  getStatus: vi.fn(),
  logout: vi.fn(),
  deleteDevice: vi.fn(),
  deviceFindFirst: vi.fn(),
  deviceCreate: vi.fn(),
  deviceUpdate: vi.fn(),
  accountFindMany: vi.fn(),
  audit: vi.fn(),
}));

const tx = {
  whatsappDevice: { findFirst: mocks.deviceFindFirst, create: mocks.deviceCreate, update: mocks.deviceUpdate },
  whatsappProviderAccount: { findMany: mocks.accountFindMany },
  auditLog: { create: vi.fn() },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    whatsappDevice: { findFirst: mocks.deviceFindFirst, update: mocks.deviceUpdate },
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  },
}));
vi.mock("@/lib/rbac", () => ({ requirePermission: mocks.requirePermission }));
vi.mock("@/lib/apiHandler", () => ({ BadRequestError: class BadRequestError extends Error {}, ConflictError: class ConflictError extends Error {} }));
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: { WHATSAPP_DEVICE_CREATED: "CREATED", WHATSAPP_DEVICE_QR_INITIATED: "QR", WHATSAPP_DEVICE_CONNECTED: "CONNECTED", WHATSAPP_DEVICE_DISCONNECTED: "DISCONNECTED" },
  writeAuditLog: mocks.audit,
}));
vi.mock("@/lib/whatsappCredentialCrypto", () => ({ decryptWhatsappApiKey: mocks.decrypt }));
vi.mock("@/lib/whatsapp", () => ({
  generateDeviceQr: mocks.generateQr,
  getDeviceStatus: mocks.getStatus,
  logoutDevice: mocks.logout,
  deleteDevice: mocks.deleteDevice,
}));

import { connectWhatsappDevice, disconnectWhatsappDevice, refreshWhatsappDeviceStatus, regenerateWhatsappWebhook, removeWhatsappDevice, setWhatsappDeviceEnabled } from "@/lib/whatsappDeviceManagement";

const actor = { userId: "user-a", tenantId: "tenant-a" };
const account = { id: "account-a", tenantId: "tenant-a", apiBaseUrl: "https://provider.test/api", encryptedApiKey: "encrypted-a", deviceLimit: 2, _count: { devices: 1 } };

describe("tenant WhatsApp device management", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.deviceFindFirst.mockResolvedValue(null); });

  it("enforces account capacity before QR provisioning", async () => {
    mocks.accountFindMany.mockResolvedValue([{ ...account, _count: { devices: 2 } }]);
    await expect(connectWhatsappDevice(actor, { phoneNumber: "919876543210", name: "Device", providerAccountId: "account-a" }))
      .rejects.toThrow("No WhatsApp device slots are available");
    expect(mocks.generateQr).not.toHaveBeenCalled();
  });

  it("uses the tenant account key server-side and returns no credential", async () => {
    mocks.accountFindMany.mockResolvedValue([account]);
    mocks.generateQr.mockResolvedValue({ ok: true, qr: "safe-qr", message: "ok" });
    const result = await connectWhatsappDevice(actor, { phoneNumber: "919876543210", name: "Device", providerAccountId: "account-a" });
    expect(mocks.decrypt).toHaveBeenCalledWith("encrypted-a", "tenant-a", "account-a");
    expect(mocks.generateQr).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "tenant-api-key", sender: "919876543210" }), "919876543210");
    expect(result).toMatchObject({ qr: "safe-qr", phoneNumber: "919876543210" });
    expect(result).not.toHaveProperty("apiKey");
  });

  it("rejects a guessed cross-tenant device id before provider access", async () => {
    mocks.deviceFindFirst.mockResolvedValue(null);
    await expect(refreshWhatsappDeviceStatus(actor, "device-b")).rejects.toThrow("not found");
    expect(mocks.getStatus).not.toHaveBeenCalled();
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });

  it("all device mutations reject a guessed cross-tenant id", async () => {
    for (const operation of [
      () => disconnectWhatsappDevice(actor, "device-b"),
      () => removeWhatsappDevice(actor, "device-b"),
      () => setWhatsappDeviceEnabled(actor, "device-b", false),
      () => regenerateWhatsappWebhook(actor, "device-b"),
    ]) await expect(operation()).rejects.toThrow("not found");
    expect(mocks.logout).not.toHaveBeenCalled();
    expect(mocks.deleteDevice).not.toHaveBeenCalled();
  });

  it("persists a positive connected status", async () => {
    mocks.deviceFindFirst.mockResolvedValue({ id: "device-a", tenantId: "tenant-a", phoneNumber: "919876543210", connectionStatus: "PENDING", providerAccount: account });
    mocks.getStatus.mockResolvedValue({ ok: true, device: { connected: true, status: "Connected", webhookUrl: null, messagesSent: null } });
    await expect(refreshWhatsappDeviceStatus(actor, "device-a")).resolves.toMatchObject({ connectionStatus: "CONNECTED", connected: true });
    expect(mocks.deviceUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "device-a" }, data: expect.objectContaining({ connectionStatus: "CONNECTED" }) }));
  });
});
