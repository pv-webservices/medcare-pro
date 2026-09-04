import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tenantFind: vi.fn(), accountFind: vi.fn(), encrypt: vi.fn().mockReturnValue("encrypted"), upsert: vi.fn(), audit: vi.fn(), deviceCount: vi.fn(),
}));
const tx = { whatsappProviderAccount: { upsert: mocks.upsert }, auditLog: { create: vi.fn() } };
vi.mock("@/lib/prisma", () => ({ prisma: { tenant: { findFirst: mocks.tenantFind }, whatsappProviderAccount: { findFirst: mocks.accountFind }, whatsappDevice: { count: mocks.deviceCount }, $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) } }));
vi.mock("@/lib/apiHandler", () => ({ BadRequestError: class BadRequestError extends Error {}, ConflictError: class ConflictError extends Error {} }));
vi.mock("@/lib/audit", () => ({ AUDIT_ACTIONS: { WHATSAPP_PROVIDER_ACCOUNT_CREATED: "CREATED", WHATSAPP_PROVIDER_ACCOUNT_UPDATED: "UPDATED", WHATSAPP_PROVIDER_KEY_REPLACED: "KEY", WHATSAPP_PROVIDER_ENABLED: "ENABLED", WHATSAPP_PROVIDER_DISABLED: "DISABLED", WHATSAPP_PROVIDER_DEVICE_LIMIT_CHANGED: "LIMIT" }, writeAuditLog: mocks.audit }));
vi.mock("@/lib/whatsappCredentialCrypto", () => ({ encryptWhatsappApiKey: mocks.encrypt }));

import { savePlatformWhatsappAccount } from "@/lib/platform/whatsappProvider";

const owner = { userId: "owner", platformRole: "SUPER_ADMIN" as const, sessionId: "session" };
describe("platform WhatsApp provider ownership", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.tenantFind.mockResolvedValue({ id: "tenant-a" }); });
  it("stores a new key only through the platform service and never audits plaintext", async () => {
    await savePlatformWhatsappAccount(owner, "tenant-a", { name: "Primary", apiBaseUrl: "https://provider.test/api", apiKey: "plain-api-key", deviceLimit: 2, enabled: true });
    expect(mocks.encrypt).toHaveBeenCalledWith("plain-api-key", "tenant-a", expect.any(String));
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ encryptedApiKey: "encrypted", deviceLimit: 2 }) }));
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("plain-api-key");
  });
  it("rejects a guessed account id outside the selected tenant", async () => {
    mocks.accountFind.mockResolvedValue(null);
    await expect(savePlatformWhatsappAccount(owner, "tenant-a", { accountId: "account-b", name: "Other", apiBaseUrl: "https://provider.test/api", deviceLimit: 2, enabled: true })).rejects.toThrow("not found");
    expect(mocks.encrypt).not.toHaveBeenCalled();
  });
  it("keeps customer APIs credential-free and gates the owner API with the platform helper", () => {
    const customerRoute = readFileSync(resolve("src/app/api/settings/whatsapp/route.ts"), "utf8");
    const ownerRoute = readFileSync(resolve("src/app/api/owner/applications/[id]/whatsapp/route.ts"), "utf8");
    expect(customerRoute).not.toContain("savePlatformWhatsappAccount");
    expect(customerRoute).not.toContain("apiKey");
    expect(ownerRoute).toContain("requirePlatformOwner");
  });
  it("uses the shared all-row device count for platform capacity", () => {
    const platformService = readFileSync(resolve("src/lib/platform/whatsappProvider.ts"), "utf8");
    const capacityHelper = readFileSync(resolve("src/lib/whatsappDeviceCapacity.ts"), "utf8");
    expect(platformService).toContain("whatsappConfiguredDeviceCount");
    expect(platformService).not.toContain("devices: { where: { enabled: true }");
    expect(capacityHelper).toContain("devices: true");
  });
});
