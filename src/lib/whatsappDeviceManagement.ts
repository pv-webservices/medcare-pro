import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Prisma, type WhatsappDeviceConnectionStatus } from "@prisma/client";
import { z } from "zod";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";
import { BadRequestError, ConflictError } from "@/lib/apiHandler";
import { prisma } from "@/lib/prisma";
import { requirePermission, type ActorContext } from "@/lib/rbac";
import { decryptWhatsappApiKey } from "@/lib/whatsappCredentialCrypto";
import { deleteDevice, generateDeviceQr, getDeviceStatus, logoutDevice, type WhatsappConfig } from "@/lib/whatsapp";

const phone = z.string().trim().transform((value) => value.replace(/\D/g, "")).refine(
  (value) => value.length >= 10 && value.length <= 15,
  "Enter the WhatsApp number with country code.",
);

export const connectWhatsappDeviceSchema = z.object({
  phoneNumber: phone,
  name: z.string().trim().min(1).max(100).default("WhatsApp device"),
  providerAccountId: z.string().min(1).optional(),
}).strict();

export const deviceActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("refresh") }),
  z.object({ action: z.literal("disconnect") }),
  z.object({ action: z.literal("remove") }),
  z.object({ action: z.literal("setEnabled"), enabled: z.boolean() }),
  z.object({ action: z.literal("regenerateWebhook") }),
]);

export function hashWhatsappWebhookSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

function accountConfig(row: { id: string; tenantId: string; apiBaseUrl: string; encryptedApiKey: string }, sender: string): WhatsappConfig {
  return { sender, baseUrl: row.apiBaseUrl.replace(/\/+$/, ""), apiKey: decryptWhatsappApiKey(row.encryptedApiKey, row.tenantId, row.id) };
}

async function loadDevice(actor: ActorContext, deviceId: string) {
  await requirePermission(actor, "settings:manage");
  const row = await prisma.whatsappDevice.findFirst({
    where: { id: deviceId, tenantId: actor.tenantId },
    include: { providerAccount: true },
  });
  if (!row) throw new BadRequestError("WhatsApp device not found.");
  return row;
}

export async function connectWhatsappDevice(actor: ActorContext, input: z.infer<typeof connectWhatsappDeviceSchema>) {
  await requirePermission(actor, "settings:manage");
  const deviceId = randomUUID();
  const account = await prisma.$transaction(async (tx) => {
    if (await tx.whatsappDevice.findFirst({ where: { tenantId: actor.tenantId, phoneNumber: input.phoneNumber }, select: { id: true } })) {
      throw new ConflictError("That WhatsApp number is already configured for this organisation.");
    }
    const accounts = await tx.whatsappProviderAccount.findMany({
      where: { tenantId: actor.tenantId, enabled: true, ...(input.providerAccountId ? { id: input.providerAccountId } : {}) },
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { devices: { where: { enabled: true } } } } },
    });
    const selected = accounts.find((candidate) => candidate._count.devices < candidate.deviceLimit);
    if (!selected) {
      if (accounts.length > 0) throw new ConflictError("No WhatsApp device slots are available for this provider account.");
      throw new BadRequestError("No active WhatsApp provider account is configured.");
    }
    await tx.whatsappDevice.create({ data: { id: deviceId, tenantId: actor.tenantId, providerAccountId: selected.id, name: input.name, phoneNumber: input.phoneNumber, connectionStatus: "PENDING" } });
    await writeAuditLog(tx, { action: AUDIT_ACTIONS.WHATSAPP_DEVICE_CREATED, targetType: "WhatsappDevice", targetId: deviceId, actorUserId: actor.userId, actorTenantId: actor.tenantId, afterValue: { providerAccountId: selected.id } });
    return selected;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  const result = await generateDeviceQr(accountConfig(account, input.phoneNumber), input.phoneNumber);
  if (!result.ok) throw new BadRequestError(result.message);
  await writeAuditLog(prisma, { action: AUDIT_ACTIONS.WHATSAPP_DEVICE_QR_INITIATED, targetType: "WhatsappDevice", targetId: deviceId, actorUserId: actor.userId, actorTenantId: actor.tenantId });
  return { deviceId, qr: result.qr, phoneNumber: input.phoneNumber };
}

export async function refreshWhatsappDeviceStatus(actor: ActorContext, deviceId: string) {
  const row = await loadDevice(actor, deviceId);
  const probe = await getDeviceStatus(accountConfig(row.providerAccount, row.phoneNumber));
  const status: WhatsappDeviceConnectionStatus = probe.ok
    ? probe.device.connected ? "CONNECTED" : "DISCONNECTED"
    : "UNKNOWN";
  const previous = row.connectionStatus;
  await prisma.$transaction(async (tx) => {
    await tx.whatsappDevice.update({ where: { id: row.id }, data: { connectionStatus: status, lastStatusCheckedAt: new Date() } });
    if (status !== previous && (status === "CONNECTED" || status === "DISCONNECTED")) {
      await writeAuditLog(tx, { action: status === "CONNECTED" ? AUDIT_ACTIONS.WHATSAPP_DEVICE_CONNECTED : AUDIT_ACTIONS.WHATSAPP_DEVICE_DISCONNECTED, targetType: "WhatsappDevice", targetId: row.id, actorUserId: actor.userId, actorTenantId: actor.tenantId });
    }
  });
  return { deviceId: row.id, connectionStatus: status, connected: status === "CONNECTED", message: probe.ok ? probe.device.status : probe.message };
}

async function referenceCount(tenantId: string, deviceId: string): Promise<number> {
  return prisma.whatsappDevice.count({ where: { id: deviceId, tenantId, OR: [{ tenantDefaults: { some: {} } }, { tenantBackups: { some: {} } }, { clinicOverrides: { some: {} } }] } });
}

export async function disconnectWhatsappDevice(actor: ActorContext, deviceId: string) {
  const row = await loadDevice(actor, deviceId);
  const result = await logoutDevice(accountConfig(row.providerAccount, row.phoneNumber));
  if (!result.ok) throw new BadRequestError(result.message);
  await prisma.$transaction(async (tx) => {
    await tx.whatsappDevice.update({ where: { id: row.id }, data: { connectionStatus: "DISCONNECTED", lastStatusCheckedAt: new Date() } });
    await writeAuditLog(tx, { action: AUDIT_ACTIONS.WHATSAPP_DEVICE_DISCONNECTED, targetType: "WhatsappDevice", targetId: row.id, actorUserId: actor.userId, actorTenantId: actor.tenantId });
  });
}

export async function removeWhatsappDevice(actor: ActorContext, deviceId: string) {
  const row = await loadDevice(actor, deviceId);
  if (await referenceCount(actor.tenantId, deviceId)) throw new ConflictError("Reassign this device as primary, backup, or clinic sender before removing it.");
  const result = await deleteDevice(accountConfig(row.providerAccount, row.phoneNumber));
  if (!result.ok) throw new BadRequestError(result.message);
  await prisma.$transaction(async (tx) => {
    await tx.whatsappDevice.deleteMany({ where: { id: row.id, tenantId: actor.tenantId } });
    await writeAuditLog(tx, { action: AUDIT_ACTIONS.WHATSAPP_DEVICE_REMOVED, targetType: "WhatsappDevice", targetId: row.id, actorUserId: actor.userId, actorTenantId: actor.tenantId });
  });
}

export async function setWhatsappDeviceEnabled(actor: ActorContext, deviceId: string, enabled: boolean) {
  const row = await loadDevice(actor, deviceId);
  if (!enabled && await referenceCount(actor.tenantId, deviceId)) throw new ConflictError("Reassign this device before disabling it.");
  await prisma.whatsappDevice.updateMany({ where: { id: row.id, tenantId: actor.tenantId }, data: { enabled } });
}

export async function regenerateWhatsappWebhook(actor: ActorContext, deviceId: string) {
  const row = await loadDevice(actor, deviceId);
  const origin = (process.env.NEXTAUTH_URL ?? "").trim().replace(/\/+$/, "");
  if (!origin) throw new BadRequestError("Public application URL is not configured.");
  const publicId = randomUUID();
  const secret = randomBytes(32).toString("base64url");
  await prisma.$transaction(async (tx) => {
    await tx.whatsappDevice.update({ where: { id: row.id }, data: { webhookPublicId: publicId, webhookSecretHash: hashWhatsappWebhookSecret(secret) } });
    await writeAuditLog(tx, { action: AUDIT_ACTIONS.WHATSAPP_WEBHOOK_REGENERATED, targetType: "WhatsappDevice", targetId: row.id, actorUserId: actor.userId, actorTenantId: actor.tenantId });
  });
  return { webhookUrl: `${origin}/api/whatsapp/webhook/${publicId}?token=${encodeURIComponent(secret)}` };
}
