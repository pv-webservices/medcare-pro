import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  decrypt: vi.fn().mockReturnValue("tenant-api-key"),
  generateQr: vi.fn(),
  getStatus: vi.fn(),
  logout: vi.fn(),
  deleteProviderDevice: vi.fn(),
  deviceFindFirst: vi.fn(),
  deviceCreate: vi.fn(),
  deviceCount: vi.fn(),
  deviceUpdateMany: vi.fn(),
  deviceUpdate: vi.fn(),
  deviceDeleteMany: vi.fn(),
  accountFindMany: vi.fn(),
  audit: vi.fn(),
}));

const tx = {
  whatsappDevice: {
    findFirst: mocks.deviceFindFirst,
    create: mocks.deviceCreate,
    count: mocks.deviceCount,
    updateMany: mocks.deviceUpdateMany,
    update: mocks.deviceUpdate,
    deleteMany: mocks.deviceDeleteMany,
  },
  auditLog: { create: vi.fn() },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    whatsappDevice: {
      findFirst: mocks.deviceFindFirst,
      updateMany: mocks.deviceUpdateMany,
      deleteMany: mocks.deviceDeleteMany,
      count: mocks.deviceCount,
    },
    whatsappProviderAccount: { findMany: mocks.accountFindMany },
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  },
}));
vi.mock("@/lib/rbac", () => ({ requirePermission: mocks.requirePermission }));
vi.mock("@/lib/apiHandler", () => ({ BadRequestError: class BadRequestError extends Error {}, ConflictError: class ConflictError extends Error {} }));
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: {
    WHATSAPP_DEVICE_CREATED: "CREATED",
    WHATSAPP_DEVICE_QR_INITIATED: "QR",
    WHATSAPP_DEVICE_CONNECTED: "CONNECTED",
    WHATSAPP_DEVICE_DISCONNECTED: "DISCONNECTED",
    WHATSAPP_DEVICE_REMOVED: "REMOVED",
    WHATSAPP_WEBHOOK_REGENERATED: "WEBHOOK",
  },
  writeAuditLog: mocks.audit,
}));
vi.mock("@/lib/whatsappCredentialCrypto", () => ({ decryptWhatsappApiKey: mocks.decrypt }));
vi.mock("@/lib/whatsapp", () => ({
  generateDeviceQr: mocks.generateQr,
  getDeviceStatus: mocks.getStatus,
  logoutDevice: mocks.logout,
  deleteDevice: mocks.deleteProviderDevice,
}));

import {
  connectWhatsappDevice,
  disconnectWhatsappDevice,
  normalizeWhatsappDevicePhoneNumber,
  refreshWhatsappDeviceStatus,
  regenerateWhatsappWebhook,
  removeWhatsappDevice,
  setWhatsappDeviceEnabled,
  setupWhatsappWebhook,
} from "@/lib/whatsappDeviceManagement";

const actor = { userId: "user-a", tenantId: "tenant-a" };
const account = {
  id: "account-a",
  tenantId: "tenant-a",
  apiBaseUrl: "https://provider.test/api",
  encryptedApiKey: "encrypted-a",
  enabled: true,
  deviceLimit: 2,
  _count: { devices: 1 },
};
const absent = { ok: false, reason: "NOT_FOUND", message: "not present" };

describe("tenant WhatsApp device management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deviceFindFirst.mockResolvedValue(null);
    mocks.deviceCount.mockResolvedValue(1);
    mocks.getStatus.mockResolvedValue(absent);
    mocks.generateQr.mockResolvedValue({ ok: true, qr: "safe-qr", message: "ready" });
  });

  it("counts every local device toward provider capacity, including disabled devices", async () => {
    mocks.accountFindMany.mockResolvedValue([{ ...account, _count: { devices: 2 } }]);
    await expect(connectWhatsappDevice(actor, { phoneNumber: "919876543210", name: "Device", providerAccountId: "account-a" }))
      .rejects.toThrow("No WhatsApp device slots are available");
    expect(mocks.getStatus).not.toHaveBeenCalled();
    expect(mocks.generateQr).not.toHaveBeenCalled();
  });

  it("checks provider state, uses the tenant key, and returns QR without credentials", async () => {
    mocks.accountFindMany.mockResolvedValue([account]);
    const result = await connectWhatsappDevice(actor, { phoneNumber: "919876543210", name: "Device", providerAccountId: "account-a" });
    expect(mocks.getStatus).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "tenant-api-key", sender: "919876543210" }));
    expect(mocks.generateQr).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "tenant-api-key", sender: "919876543210" }), "919876543210");
    expect(result).toMatchObject({ qr: "safe-qr", phoneNumber: "919876543210", alreadyConnected: false });
    expect(result).not.toHaveProperty("apiKey");
  });

  it("imports a provider device that is already connected without generating QR", async () => {
    mocks.accountFindMany.mockResolvedValue([{ ...account, _count: { devices: 0 } }]);
    mocks.deviceCount.mockResolvedValue(0);
    mocks.getStatus.mockResolvedValue({ ok: true, device: { connected: true, status: "Connected" } });
    const result = await connectWhatsappDevice(actor, { phoneNumber: "919876543210", name: "Existing", providerAccountId: "account-a" });
    expect(result).toMatchObject({ alreadyConnected: true, qr: null, message: "WhatsApp number is already connected." });
    expect(mocks.deviceCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ connectionStatus: "CONNECTED" }) }));
    expect(mocks.generateQr).not.toHaveBeenCalled();
  });

  it("synchronizes an existing local record instead of creating a duplicate", async () => {
    mocks.deviceFindFirst.mockResolvedValue({
      id: "device-a",
      tenantId: "tenant-a",
      providerAccountId: "account-a",
      phoneNumber: "8920847457",
      connectionStatus: "UNKNOWN",
      providerAccount: account,
    });
    mocks.getStatus.mockResolvedValue({ ok: true, device: { connected: true, status: "Connected" } });
    const result = await connectWhatsappDevice(actor, { phoneNumber: "918920847457", name: "Existing" });
    expect(result).toMatchObject({ deviceId: "device-a", alreadyConnected: true, qr: null });
    expect(mocks.deviceCreate).not.toHaveBeenCalled();
    expect(mocks.deviceUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ phoneNumber: "918920847457", connectionStatus: "CONNECTED" }),
    }));
  });

  it("removes a new reservation after a definitive QR rejection", async () => {
    mocks.accountFindMany.mockResolvedValue([account]);
    mocks.generateQr.mockResolvedValue({ ok: false, definitive: true, message: "rejected" });
    await expect(connectWhatsappDevice(actor, { phoneNumber: "919876543210", name: "Device" })).rejects.toThrow("rejected");
    expect(mocks.deviceDeleteMany).toHaveBeenCalledWith({ where: { id: expect.any(String), tenantId: "tenant-a" } });
  });

  it("retains one recoverable pending row after an ambiguous QR outcome", async () => {
    mocks.accountFindMany.mockResolvedValue([account]);
    mocks.generateQr.mockResolvedValue({ ok: false, definitive: false, message: "timeout" });
    await expect(connectWhatsappDevice(actor, { phoneNumber: "919876543210", name: "Device" })).rejects.toThrow("recoverable pending state");
    expect(mocks.deviceCreate).toHaveBeenCalledTimes(1);
    expect(mocks.deviceDeleteMany).not.toHaveBeenCalled();
  });

  it("does not create a local row when the initial provider check is unavailable", async () => {
    mocks.accountFindMany.mockResolvedValue([account]);
    mocks.getStatus.mockResolvedValue({ ok: false, reason: "UNAVAILABLE", message: "provider unavailable" });
    await expect(connectWhatsappDevice(actor, { phoneNumber: "919876543210", name: "Device" }))
      .rejects.toThrow("no new device was created");
    expect(mocks.deviceCreate).not.toHaveBeenCalled();
    expect(mocks.generateQr).not.toHaveBeenCalled();
  });

  it("selects a second owned provider when the first account is full", async () => {
    const second = { ...account, id: "account-b", encryptedApiKey: "encrypted-b", _count: { devices: 0 } };
    mocks.accountFindMany.mockResolvedValue([
      { ...account, _count: { devices: 2 } },
      second,
    ]);
    mocks.deviceCount.mockResolvedValue(0);
    await connectWhatsappDevice(actor, { phoneNumber: "919876543210", name: "Device" });
    expect(mocks.deviceCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ providerAccountId: "account-b" }),
    }));
    expect(mocks.decrypt).toHaveBeenCalledWith("encrypted-b", "tenant-a", "account-b");
  });

  it("canonicalizes Indian local input and checks legacy and canonical duplicates", async () => {
    expect(normalizeWhatsappDevicePhoneNumber("8920847457")).toBe("918920847457");
    expect(normalizeWhatsappDevicePhoneNumber("+91 89208-47457")).toBe("918920847457");
    mocks.accountFindMany.mockResolvedValue([account]);
    await connectWhatsappDevice(actor, { phoneNumber: "918920847457", name: "Device" });
    expect(mocks.deviceFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ phoneNumber: { in: ["918920847457", "8920847457"] } }),
    }));
  });

  it("rejects a guessed cross-tenant device id before provider access", async () => {
    await expect(refreshWhatsappDeviceStatus(actor, "device-b")).rejects.toThrow("not found");
    expect(mocks.getStatus).not.toHaveBeenCalled();
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });

  it("rejects a guessed provider account from another tenant before decrypting it", async () => {
    mocks.accountFindMany.mockResolvedValue([]);
    await expect(connectWhatsappDevice(actor, {
      phoneNumber: "919876543210",
      name: "Device",
      providerAccountId: "provider-b",
    })).rejects.toThrow("No active WhatsApp provider account");
    expect(mocks.accountFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "provider-b", tenantId: "tenant-a" }),
    }));
    expect(mocks.decrypt).not.toHaveBeenCalled();
    expect(mocks.getStatus).not.toHaveBeenCalled();
  });

  it("all device mutations reject a guessed cross-tenant id", async () => {
    for (const operation of [
      () => disconnectWhatsappDevice(actor, "device-b"),
      () => removeWhatsappDevice(actor, "device-b"),
      () => setWhatsappDeviceEnabled(actor, "device-b", false),
      () => regenerateWhatsappWebhook(actor, "device-b"),
      () => setupWhatsappWebhook(actor, "device-b"),
    ]) await expect(operation()).rejects.toThrow("not found");
    expect(mocks.logout).not.toHaveBeenCalled();
    expect(mocks.deleteProviderDevice).not.toHaveBeenCalled();
  });

  it("persists a positive connected status", async () => {
    mocks.deviceFindFirst.mockResolvedValue({ id: "device-a", tenantId: "tenant-a", phoneNumber: "919876543210", connectionStatus: "PENDING", providerAccount: account });
    mocks.getStatus.mockResolvedValue({ ok: true, device: { connected: true, status: "Connected" } });
    await expect(refreshWhatsappDeviceStatus(actor, "device-a")).resolves.toMatchObject({ connectionStatus: "CONNECTED", connected: true, present: true });
    expect(mocks.deviceUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "device-a", tenantId: "tenant-a" }, data: expect.objectContaining({ connectionStatus: "CONNECTED" }) }));
  });

  it("disconnect keeps the row while remove deletes it only after provider success", async () => {
    const row = { id: "device-a", tenantId: "tenant-a", phoneNumber: "919876543210", connectionStatus: "CONNECTED", providerAccount: account };
    mocks.deviceFindFirst.mockResolvedValue(row);
    mocks.logout.mockResolvedValue({ ok: true });
    await disconnectWhatsappDevice(actor, "device-a");
    expect(mocks.deviceDeleteMany).not.toHaveBeenCalled();

    mocks.deleteProviderDevice.mockResolvedValue({ ok: true });
    mocks.deviceCount.mockResolvedValue(0);
    await removeWhatsappDevice(actor, "device-a");
    expect(mocks.deviceDeleteMany).toHaveBeenCalledWith({ where: { id: "device-a", tenantId: "tenant-a" } });
  });

  it("does not regenerate an already configured webhook during setup", async () => {
    mocks.deviceFindFirst.mockResolvedValue({ id: "device-a", tenantId: "tenant-a", webhookPublicId: "public-a", webhookSecretHash: "hash-a", providerAccount: account });
    await expect(setupWhatsappWebhook(actor, "device-a")).resolves.toMatchObject({ webhookConfigured: true, webhookUrl: null });
    expect(mocks.deviceUpdateMany).not.toHaveBeenCalled();
  });

  it("generates distinct per-device webhook credentials and never audits raw secrets", async () => {
    const previousOrigin = process.env.NEXTAUTH_URL;
    process.env.NEXTAUTH_URL = "https://medcare.test";
    const row = { id: "device-a", tenantId: "tenant-a", webhookPublicId: null, webhookSecretHash: null, providerAccount: account };
    mocks.deviceFindFirst.mockResolvedValue(row);
    const first = await setupWhatsappWebhook(actor, "device-a");
    const second = await regenerateWhatsappWebhook(actor, "device-a");
    expect(first.webhookUrl).toMatch(/^https:\/\/medcare\.test\/api\/whatsapp\/webhook\/[^?]+\?token=.+/);
    expect(second.webhookUrl).not.toBe(first.webhookUrl);
    const rawTokens = [first.webhookUrl, second.webhookUrl].map((url) => new URL(url!).searchParams.get("token"));
    expect(JSON.stringify(mocks.deviceUpdate.mock.calls)).not.toContain(rawTokens[0]);
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain(rawTokens[0]);
    if (previousOrigin === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = previousOrigin;
  });
});
