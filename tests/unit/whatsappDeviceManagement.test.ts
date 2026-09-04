import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  decrypt: vi.fn().mockReturnValue("tenant-api-key"),
  generateQr: vi.fn(),
  getStatus: vi.fn(),
  logout: vi.fn(),
  deleteProviderDevice: vi.fn(),
  deviceFindFirst: vi.fn(),
  deviceFindMany: vi.fn(),
  deviceCreate: vi.fn(),
  deviceCount: vi.fn(),
  deviceUpdateMany: vi.fn(),
  deviceUpdate: vi.fn(),
  deviceDeleteMany: vi.fn(),
  accountFindMany: vi.fn(),
  tenantSettingsFindUnique: vi.fn(),
  tenantSettingsUpdate: vi.fn(),
  clinicSettingsFindMany: vi.fn(),
  clinicSettingsCount: vi.fn(),
  clinicSettingsUpdateMany: vi.fn(),
  clinicSettingsDeleteMany: vi.fn(),
  transaction: vi.fn(),
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
  tenantWhatsappSettings: {
    findUnique: mocks.tenantSettingsFindUnique,
    update: mocks.tenantSettingsUpdate,
  },
  clinicWhatsappSettings: {
    count: mocks.clinicSettingsCount,
    updateMany: mocks.clinicSettingsUpdateMany,
    deleteMany: mocks.clinicSettingsDeleteMany,
  },
  auditLog: { create: vi.fn() },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    whatsappDevice: {
      findFirst: mocks.deviceFindFirst,
      findMany: mocks.deviceFindMany,
      updateMany: mocks.deviceUpdateMany,
      deleteMany: mocks.deviceDeleteMany,
      count: mocks.deviceCount,
    },
    whatsappProviderAccount: { findMany: mocks.accountFindMany },
    tenantWhatsappSettings: { findUnique: mocks.tenantSettingsFindUnique },
    clinicWhatsappSettings: { findMany: mocks.clinicSettingsFindMany },
    $transaction: mocks.transaction,
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
    WHATSAPP_ROUTING_UPDATED: "ROUTING",
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
  isWhatsappDeviceNotFoundMessage: (message: string) => message.includes("not added under this API key"),
}));

import {
  connectWhatsappDevice,
  disconnectWhatsappDevice,
  getWhatsappDeviceRoutingReferences,
  normalizeWhatsappDevicePhoneNumber,
  reconnectWhatsappDevice,
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
const row = { id: "device-a", tenantId: "tenant-a", providerAccountId: "account-a", phoneNumber: "919876543210", connectionStatus: "DISCONNECTED", webhookPublicId: null, webhookSecretHash: null, providerAccount: account };
const absent = { ok: false, reason: "NOT_FOUND", message: "Invalid sender device. This device is not added under this API key." };
const disconnected = { ok: true, device: { connected: false, status: "Disconnected" } };

describe("tenant WhatsApp device management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
    mocks.deviceFindFirst.mockResolvedValue(null);
    mocks.deviceFindMany.mockResolvedValue([]);
    mocks.deviceCount.mockResolvedValue(1);
    mocks.tenantSettingsFindUnique.mockResolvedValue(null);
    mocks.clinicSettingsFindMany.mockResolvedValue([]);
    mocks.clinicSettingsCount.mockResolvedValue(0);
    mocks.getStatus.mockResolvedValue(absent);
    mocks.generateQr.mockResolvedValue({ ok: true, qr: "safe-qr", message: "ready" });
    mocks.deleteProviderDevice.mockResolvedValue({ ok: true, message: "deleted" });
  });

  it("counts every local device toward provider capacity, including disabled devices", async () => {
    mocks.accountFindMany.mockResolvedValue([{ ...account, _count: { devices: 2 } }]);
    await expect(connectWhatsappDevice(actor, { phoneNumber: row.phoneNumber, name: "Device", providerAccountId: "account-a" })).rejects.toThrow("No WhatsApp device slots are available");
    expect(mocks.getStatus).not.toHaveBeenCalled();
  });

  it("keeps add-new separate from reconnect for an existing local device", async () => {
    mocks.deviceFindFirst.mockResolvedValueOnce(row);
    await expect(connectWhatsappDevice(actor, { phoneNumber: row.phoneNumber, name: "Device" })).rejects.toThrow("Use Reconnect");
    expect(mocks.accountFindMany).not.toHaveBeenCalled();
    expect(mocks.generateQr).not.toHaveBeenCalled();
  });

  it("creates PENDING only after valid QR material is returned", async () => {
    mocks.accountFindMany.mockResolvedValue([account]);
    await connectWhatsappDevice(actor, { phoneNumber: row.phoneNumber, name: "Device" });
    expect(mocks.deviceCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ connectionStatus: "MISSING" }) }));
    expect(mocks.deviceUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ connectionStatus: "PENDING" }) }));
  });

  it("invokes generateDeviceQr and returns alreadyConnected: false when device is absent at provider", async () => {
    mocks.accountFindMany.mockResolvedValue([account]);
    mocks.getStatus.mockResolvedValue({
      ok: false,
      reason: "NOT_FOUND",
      message: "Requested WhatsApp device was not found under this provider account.",
    });
    mocks.generateQr.mockResolvedValue({ ok: true, qr: "safe-qr", message: "ready" });
    const result = await connectWhatsappDevice(actor, { phoneNumber: row.phoneNumber, name: "Device" });
    expect(result).toMatchObject({
      alreadyConnected: false,
      qr: "safe-qr",
      phoneNumber: row.phoneNumber,
    });
    expect(mocks.generateQr).toHaveBeenCalledTimes(1);
  });

  it("returns alreadyConnected: true and skips generateDeviceQr when matching device is already connected at provider", async () => {
    mocks.accountFindMany.mockResolvedValue([account]);
    mocks.getStatus.mockResolvedValue({
      ok: true,
      device: { connected: true, status: "Connected" },
    });
    const result = await connectWhatsappDevice(actor, { phoneNumber: row.phoneNumber, name: "Device" });
    expect(result).toMatchObject({
      alreadyConnected: true,
      qr: null,
      phoneNumber: row.phoneNumber,
    });
    expect(mocks.generateQr).not.toHaveBeenCalled();
  });

  it("does not leave a new device PENDING after an ambiguous QR response", async () => {
    mocks.accountFindMany.mockResolvedValue([account]);
    mocks.generateQr.mockResolvedValue({ ok: false, definitive: false, message: "unexpected response" });
    await expect(connectWhatsappDevice(actor, { phoneNumber: row.phoneNumber, name: "Device" })).rejects.toThrow("not marked as connecting");
    expect(mocks.deviceUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { connectionStatus: "UNKNOWN" } }));
    expect(mocks.deviceUpdateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ connectionStatus: "PENDING" }) }));
  });

  it("removes a new reservation after a definitive QR rejection", async () => {
    mocks.accountFindMany.mockResolvedValue([account]);
    mocks.generateQr.mockResolvedValue({ ok: false, definitive: true, message: "rejected" });
    await expect(connectWhatsappDevice(actor, { phoneNumber: row.phoneNumber, name: "Device" })).rejects.toThrow("rejected");
    expect(mocks.deviceDeleteMany).toHaveBeenCalledWith({ where: { id: expect.any(String), tenantId: "tenant-a" } });
  });

  it("does not create a local row when the initial provider check is unavailable", async () => {
    mocks.accountFindMany.mockResolvedValue([account]);
    mocks.getStatus.mockResolvedValue({ ok: false, reason: "UNAVAILABLE", message: "provider unavailable" });
    await expect(connectWhatsappDevice(actor, { phoneNumber: row.phoneNumber, name: "Device" })).rejects.toThrow("No new device was created");
    expect(mocks.deviceCreate).not.toHaveBeenCalled();
  });

  it("selects a second owned provider when the first account is full", async () => {
    const second = { ...account, id: "account-b", encryptedApiKey: "encrypted-b", _count: { devices: 0 } };
    mocks.accountFindMany.mockResolvedValue([{ ...account, _count: { devices: 2 } }, second]);
    mocks.deviceCount.mockResolvedValue(0);
    await connectWhatsappDevice(actor, { phoneNumber: row.phoneNumber, name: "Device" });
    expect(mocks.deviceCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ providerAccountId: "account-b" }) }));
  });

  it("canonicalizes Indian local input and checks legacy and canonical duplicates", async () => {
    expect(normalizeWhatsappDevicePhoneNumber("9876543210")).toBe("919876543210");
    mocks.accountFindMany.mockResolvedValue([account]);
    await connectWhatsappDevice(actor, { phoneNumber: "9876543210", name: "Device" });
    expect(mocks.deviceFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ phoneNumber: { in: ["919876543210", "9876543210"] } }) }));
  });

  it("reconnects an existing DISCONNECTED device without capacity checks", async () => {
    mocks.deviceFindFirst.mockResolvedValue(row);
    mocks.getStatus.mockResolvedValue(disconnected);
    const result = await reconnectWhatsappDevice(actor, row.id);
    expect(result).toMatchObject({ deviceId: row.id, qr: "safe-qr", alreadyConnected: false });
    expect(mocks.accountFindMany).not.toHaveBeenCalled();
    expect(mocks.deviceCount).not.toHaveBeenCalled();
    expect(mocks.deviceUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ connectionStatus: "PENDING" }) }));
  });

  it("does not mark an existing device PENDING after ambiguous QR output", async () => {
    mocks.deviceFindFirst.mockResolvedValue(row);
    mocks.getStatus.mockResolvedValue(disconnected);
    mocks.generateQr.mockResolvedValue({ ok: false, definitive: false, message: "unexpected response" });
    await expect(reconnectWhatsappDevice(actor, row.id)).rejects.toThrow("not marked as connecting");
    expect(mocks.deviceUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ connectionStatus: "UNKNOWN" }) }));
    expect(mocks.deviceUpdateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ connectionStatus: "PENDING" }) }));
  });

  it("preserves the positively known prior state after QR provider rejection", async () => {
    mocks.deviceFindFirst.mockResolvedValue(row);
    mocks.getStatus.mockResolvedValue(disconnected);
    mocks.generateQr.mockResolvedValue({ ok: false, definitive: true, message: "rejected" });
    await expect(reconnectWhatsappDevice(actor, row.id)).rejects.toThrow("rejected");
    expect(mocks.deviceUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ connectionStatus: "DISCONNECTED" }) }));
  });

  it("refresh marks provider absence MISSING and a scanned QR CONNECTED", async () => {
    mocks.deviceFindFirst.mockResolvedValue({ ...row, connectionStatus: "PENDING" });
    await expect(refreshWhatsappDeviceStatus(actor, row.id)).resolves.toMatchObject({ connectionStatus: "MISSING", connected: false, present: false });
    mocks.getStatus.mockResolvedValue({ ok: true, device: { connected: true, status: "Connected" } });
    await expect(refreshWhatsappDeviceStatus(actor, row.id)).resolves.toMatchObject({ connectionStatus: "CONNECTED", connected: true, present: true });
  });

  it.each([
    ["Offline", "DISCONNECTED"],
    ["Disconnect", "DISCONNECTED"],
    ["Connecting", "PENDING"],
    ["unexpected-provider-state", "UNKNOWN"],
  ])("maps provider status %s without treating Connecting as Connected", async (providerStatus, expectedStatus) => {
    mocks.deviceFindFirst.mockResolvedValue(row);
    mocks.getStatus.mockResolvedValue({ ok: true, device: { connected: false, status: providerStatus } });
    await expect(refreshWhatsappDeviceStatus(actor, row.id)).resolves.toMatchObject({ connectionStatus: expectedStatus, connected: false, present: true });
  });

  it("returns structured primary, backup, clinic and eligible replacement references", async () => {
    mocks.deviceFindFirst.mockResolvedValue(row);
    mocks.tenantSettingsFindUnique.mockResolvedValue({ defaultDeviceId: row.id, backupDeviceId: null });
    mocks.clinicSettingsFindMany.mockResolvedValue([{ clinic: { id: "clinic-a", name: "Sharma Clinic" } }]);
    mocks.deviceFindMany.mockResolvedValue([{ id: "device-b", name: "Backup", phoneNumber: "919111111111", connectionStatus: "CONNECTED" }]);
    await expect(getWhatsappDeviceRoutingReferences(actor, row.id)).resolves.toEqual({
      references: { organisationPrimary: true, organisationBackup: false, clinics: [{ id: "clinic-a", name: "Sharma Clinic" }] },
      replacements: [{ id: "device-b", name: "Backup", phoneNumber: "919111111111", connectionStatus: "CONNECTED" }],
    });
  });

  it("allows explicit local cleanup when the configured provider confirms the device is absent", async () => {
    mocks.deviceFindFirst.mockResolvedValue(row);
    await expect(removeWhatsappDevice(actor, row.id)).resolves.toMatchObject({ providerAlreadyAbsent: true });
    expect(mocks.deleteProviderDevice).not.toHaveBeenCalled();
    expect(mocks.deviceDeleteMany).toHaveBeenCalledWith({ where: { id: row.id, tenantId: actor.tenantId } });
  });

  it("keeps referenced stale devices blocked until clear is explicit", async () => {
    mocks.deviceFindFirst.mockResolvedValue(row);
    mocks.tenantSettingsFindUnique.mockResolvedValue({ defaultDeviceId: row.id, backupDeviceId: null, automaticFailover: true });
    await expect(removeWhatsappDevice(actor, row.id)).rejects.toThrow("reassign or clear");
    await removeWhatsappDevice(actor, row.id, { routingAction: "clear" });
    expect(mocks.tenantSettingsUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { defaultDeviceId: null, backupDeviceId: null, automaticFailover: false } }));
  });

  it("reassigns primary and clinic routes to an eligible same-tenant device", async () => {
    const replacement = { id: "device-b" };
    mocks.deviceFindFirst
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce(replacement)
      .mockResolvedValueOnce({ id: row.id })
      .mockResolvedValueOnce(replacement);
    mocks.tenantSettingsFindUnique.mockResolvedValue({ defaultDeviceId: row.id, backupDeviceId: null, automaticFailover: false });
    mocks.clinicSettingsFindMany.mockResolvedValue([{ clinic: { id: "clinic-a", name: "Sharma Clinic" } }]);
    mocks.clinicSettingsCount.mockResolvedValue(1);
    mocks.getStatus.mockResolvedValue(disconnected);
    await removeWhatsappDevice(actor, row.id, { routingAction: "reassign", replacementDeviceId: replacement.id });
    expect(mocks.tenantSettingsUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ defaultDeviceId: replacement.id }) }));
    expect(mocks.clinicSettingsUpdateMany).toHaveBeenCalledWith({ where: { tenantId: actor.tenantId, deviceId: row.id }, data: { deviceId: replacement.id } });
  });

  it("rejects a cross-tenant replacement before deleting the provider device", async () => {
    mocks.deviceFindFirst.mockResolvedValueOnce(row).mockResolvedValueOnce(null);
    await expect(removeWhatsappDevice(actor, row.id, { routingAction: "reassign", replacementDeviceId: "tenant-b-device" })).rejects.toThrow("this organisation");
    expect(mocks.deleteProviderDevice).not.toHaveBeenCalled();
  });

  it("accepts provider absence reported by delete after a positive probe", async () => {
    mocks.deviceFindFirst.mockResolvedValue(row);
    mocks.getStatus.mockResolvedValue(disconnected);
    mocks.deleteProviderDevice.mockResolvedValue({ ok: false, message: "Invalid sender device. This device is not added under this API key." });
    await expect(removeWhatsappDevice(actor, row.id)).resolves.toMatchObject({ providerAlreadyAbsent: true });
    expect(mocks.deviceDeleteMany).toHaveBeenCalled();
  });

  it("clears primary and clinic override and disables impossible failover", async () => {
    mocks.deviceFindFirst.mockResolvedValue(row);
    mocks.tenantSettingsFindUnique.mockResolvedValue({ defaultDeviceId: row.id, backupDeviceId: null, automaticFailover: true });
    mocks.clinicSettingsFindMany.mockResolvedValue([{ clinic: { id: "clinic-a", name: "Sharma Clinic" } }]);
    mocks.clinicSettingsCount.mockResolvedValue(1);
    await removeWhatsappDevice(actor, row.id, { routingAction: "clear" });
    expect(mocks.clinicSettingsDeleteMany).toHaveBeenCalledWith({ where: { tenantId: actor.tenantId, deviceId: row.id } });
    expect(mocks.tenantSettingsUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { defaultDeviceId: null, backupDeviceId: null, automaticFailover: false } }));
  });

  it("finishes local cleanup on retry after provider delete succeeded but the DB transaction failed", async () => {
    mocks.deviceFindFirst.mockResolvedValue(row);
    mocks.getStatus.mockResolvedValueOnce(disconnected).mockResolvedValueOnce(absent);
    mocks.transaction.mockRejectedValueOnce(new Error("db failed"));
    await expect(removeWhatsappDevice(actor, row.id)).rejects.toThrow("db failed");
    mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
    await expect(removeWhatsappDevice(actor, row.id)).resolves.toMatchObject({ providerAlreadyAbsent: true });
    expect(mocks.deleteProviderDevice).toHaveBeenCalledTimes(1);
    expect(mocks.deviceDeleteMany).toHaveBeenCalled();
  });

  it("disconnect retains the row and uses the working provider logout path", async () => {
    mocks.deviceFindFirst.mockResolvedValue({ ...row, connectionStatus: "CONNECTED" });
    mocks.logout.mockResolvedValue({ ok: true });
    await disconnectWhatsappDevice(actor, row.id);
    expect(mocks.deviceDeleteMany).not.toHaveBeenCalled();
    expect(mocks.deviceUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ connectionStatus: "DISCONNECTED" }) }));
  });

  it("rejects guessed cross-tenant ids before provider or routing access", async () => {
    for (const operation of [
      () => refreshWhatsappDeviceStatus(actor, "device-b"),
      () => reconnectWhatsappDevice(actor, "device-b"),
      () => removeWhatsappDevice(actor, "device-b"),
      () => setWhatsappDeviceEnabled(actor, "device-b", false),
      () => regenerateWhatsappWebhook(actor, "device-b"),
      () => setupWhatsappWebhook(actor, "device-b"),
    ]) await expect(operation()).rejects.toThrow("not found");
    expect(mocks.getStatus).not.toHaveBeenCalled();
    expect(mocks.deleteProviderDevice).not.toHaveBeenCalled();
  });

  it("does not regenerate an already configured webhook during setup", async () => {
    mocks.deviceFindFirst.mockResolvedValue({ ...row, webhookPublicId: "public-a", webhookSecretHash: "hash-a" });
    await expect(setupWhatsappWebhook(actor, row.id)).resolves.toMatchObject({ webhookConfigured: true, webhookUrl: null });
    expect(mocks.deviceUpdate).not.toHaveBeenCalled();
  });

  it("generates distinct per-device webhook credentials and never audits raw secrets", async () => {
    const previousOrigin = process.env.NEXTAUTH_URL;
    process.env.NEXTAUTH_URL = "https://medcare.test";
    mocks.deviceFindFirst.mockResolvedValue(row);
    const first = await setupWhatsappWebhook(actor, row.id);
    const second = await regenerateWhatsappWebhook(actor, row.id);
    const token = new URL(first.webhookUrl!).searchParams.get("token");
    expect(second.webhookUrl).not.toBe(first.webhookUrl);
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain(token);
    if (previousOrigin === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = previousOrigin;
  });
});
