import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";
import { BadRequestError, ConflictError } from "@/lib/apiHandler";
import type { PlatformActorContext } from "@/lib/platform/context";
import { prisma } from "@/lib/prisma";
import { CUSTOMER_TENANT_WHERE } from "@/lib/platformTenant";
import { encryptWhatsappApiKey } from "@/lib/whatsappCredentialCrypto";
import { configuredWhatsappDeviceCount, whatsappConfiguredDeviceCount } from "@/lib/whatsappDeviceCapacity";

const baseUrl = z.string().trim().url().max(500).transform((value) => value.replace(/\/+$/, ""))
  .refine((value) => new URL(value).protocol === "https:", "The provider API URL must use HTTPS.");

export const platformWhatsappAccountSchema = z.object({
  accountId: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(100),
  apiBaseUrl: baseUrl.default("https://bot.rkvrobo.in/api"),
  apiKey: z.string().trim().min(8).max(1000).optional(),
  deviceLimit: z.number().int().min(1).max(100),
  enabled: z.boolean(),
}).strict().superRefine((value, ctx) => {
  if (!value.accountId && !value.apiKey) {
    ctx.addIssue({ code: "custom", path: ["apiKey"], message: "API key is required for a new provider account." });
  }
});

export interface PlatformWhatsappAccountView {
  id: string;
  name: string;
  apiBaseUrl: string;
  enabled: boolean;
  deviceLimit: number;
  configuredDevices: number;
  apiKeyConfigured: boolean;
}

async function assertCustomerTenant(tenantId: string): Promise<void> {
  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, ...CUSTOMER_TENANT_WHERE },
    select: { id: true },
  });
  if (!tenant) throw new BadRequestError("Organisation not found.");
}

export async function listPlatformWhatsappAccounts(
  _owner: PlatformActorContext,
  tenantId: string,
): Promise<PlatformWhatsappAccountView[]> {
  await assertCustomerTenant(tenantId);
  const rows = await prisma.whatsappProviderAccount.findMany({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      apiBaseUrl: true,
      enabled: true,
      deviceLimit: true,
      encryptedApiKey: true,
      ...whatsappConfiguredDeviceCount,
    },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    apiBaseUrl: row.apiBaseUrl,
    enabled: row.enabled,
    deviceLimit: row.deviceLimit,
    configuredDevices: configuredWhatsappDeviceCount(row),
    apiKeyConfigured: row.encryptedApiKey.length > 0,
  }));
}

export async function savePlatformWhatsappAccount(
  owner: PlatformActorContext,
  tenantId: string,
  input: z.infer<typeof platformWhatsappAccountSchema>,
): Promise<void> {
  await assertCustomerTenant(tenantId);
  const accountId = input.accountId ?? randomUUID();
  const existing = input.accountId
    ? await prisma.whatsappProviderAccount.findFirst({
        where: { id: input.accountId, tenantId },
        select: { id: true, encryptedApiKey: true, enabled: true, deviceLimit: true, ...whatsappConfiguredDeviceCount },
      })
    : null;
  if (input.accountId && !existing) throw new BadRequestError("Provider account not found.");
  if (existing && input.deviceLimit < existing._count.devices) {
    throw new ConflictError("Device limit cannot be lower than the number of configured devices.");
  }
  if (existing?.enabled && !input.enabled) {
    const references = await prisma.whatsappDevice.count({
      where: {
        tenantId,
        providerAccountId: accountId,
        OR: [{ tenantDefaults: { some: {} } }, { tenantBackups: { some: {} } }, { clinicOverrides: { some: {} } }],
      },
    });
    if (references > 0) throw new ConflictError("Reassign primary, backup, and clinic devices before disabling this provider account.");
  }
  const encryptedApiKey = input.apiKey
    ? encryptWhatsappApiKey(input.apiKey, tenantId, accountId)
    : existing!.encryptedApiKey;

  await prisma.$transaction(async (tx) => {
    await tx.whatsappProviderAccount.upsert({
      where: { id: accountId },
      create: { id: accountId, tenantId, name: input.name, apiBaseUrl: input.apiBaseUrl, encryptedApiKey, deviceLimit: input.deviceLimit, enabled: input.enabled },
      update: { name: input.name, apiBaseUrl: input.apiBaseUrl, encryptedApiKey, deviceLimit: input.deviceLimit, enabled: input.enabled },
    });
    const base = { targetType: "WhatsappProviderAccount", targetId: accountId, actorUserId: owner.userId, actorPlatformRole: owner.platformRole, actorTenantId: null, afterValue: { tenantId } } as const;
    await writeAuditLog(tx, { ...base, action: existing ? AUDIT_ACTIONS.WHATSAPP_PROVIDER_ACCOUNT_UPDATED : AUDIT_ACTIONS.WHATSAPP_PROVIDER_ACCOUNT_CREATED });
    if (existing && input.apiKey) await writeAuditLog(tx, { ...base, action: AUDIT_ACTIONS.WHATSAPP_PROVIDER_KEY_REPLACED });
    if (existing && existing.enabled !== input.enabled) await writeAuditLog(tx, { ...base, action: input.enabled ? AUDIT_ACTIONS.WHATSAPP_PROVIDER_ENABLED : AUDIT_ACTIONS.WHATSAPP_PROVIDER_DISABLED });
    if (existing && existing.deviceLimit !== input.deviceLimit) await writeAuditLog(tx, { ...base, action: AUDIT_ACTIONS.WHATSAPP_PROVIDER_DEVICE_LIMIT_CHANGED, afterValue: { tenantId, deviceLimit: input.deviceLimit } });
  });
}
