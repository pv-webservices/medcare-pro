import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";
import { BadRequestError, ConflictError } from "@/lib/apiHandler";
import { prisma } from "@/lib/prisma";
import { requirePermission, type ActorContext } from "@/lib/rbac";
import { whatsappConfiguredDeviceCount, whatsappProviderHasCapacity } from "@/lib/whatsappDeviceCapacity";
import { probeWhatsappDeviceForProvider, syncWhatsappDeviceWithProvider, whatsappConfigForProviderDevice } from "@/lib/whatsappDeviceSync";
import { deleteDevice, generateDeviceQr, logoutDevice } from "@/lib/whatsapp";

const PHONE_MESSAGE = "Enter a full international WhatsApp number with country code.";

export function normalizeWhatsappDevicePhoneNumber(value: string): string {
  const digits = value.replace(/\D/g, "");
  const canonical = digits.length === 10 ? `91${digits}` : digits;
  if (!/^[1-9]\d{7,14}$/.test(canonical)) throw new Error(PHONE_MESSAGE);
  return canonical;
}

function canonicalWhatsappDeviceDigits(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length === 10 ? `91${digits}` : digits;
}

function phoneLookupCandidates(phoneNumber: string): string[] {
  return phoneNumber.startsWith("91") && phoneNumber.length === 12
    ? [phoneNumber, phoneNumber.slice(2)]
    : [phoneNumber];
}

const phone = z.string().trim()
  .transform(canonicalWhatsappDeviceDigits)
  .pipe(z.string().regex(/^[1-9]\d{7,14}$/, PHONE_MESSAGE));

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
  z.object({ action: z.literal("setupWebhook") }),
  z.object({ action: z.literal("regenerateWebhook") }),
]);

export function hashWhatsappWebhookSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
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
  const phoneNumber = normalizeWhatsappDevicePhoneNumber(input.phoneNumber);
  const candidates = phoneLookupCandidates(phoneNumber);
  const existing = await prisma.whatsappDevice.findFirst({
    where: { tenantId: actor.tenantId, phoneNumber: { in: candidates } },
    include: { providerAccount: true },
  });
  if (existing && input.providerAccountId && existing.providerAccountId !== input.providerAccountId) {
    throw new ConflictError("That WhatsApp number is already configured under another provider account.");
  }

  const accounts = existing
    ? []
    : await prisma.whatsappProviderAccount.findMany({
        where: { tenantId: actor.tenantId, enabled: true, ...(input.providerAccountId ? { id: input.providerAccountId } : {}) },
        orderBy: { createdAt: "asc" },
        include: whatsappConfiguredDeviceCount,
      });
  if ((!existing && accounts.length === 0) || (existing && !existing.providerAccount.enabled)) {
    throw new BadRequestError("No active WhatsApp provider account is configured.");
  }
  const account = existing
    ? existing.providerAccount
    : accounts.find(whatsappProviderHasCapacity);
  if (!account) {
    throw new ConflictError("No WhatsApp device slots are available for this provider account.");
  }

  const providerState = await probeWhatsappDeviceForProvider(account, phoneNumber);
  if (providerState.outcome === "UNKNOWN") {
    if (existing) {
      await prisma.whatsappDevice.updateMany({
        where: { id: existing.id, tenantId: actor.tenantId },
        data: { connectionStatus: "UNKNOWN", lastStatusCheckedAt: new Date() },
      });
    }
    throw new BadRequestError(`${providerState.message} Refresh status and retry; no new device was created.`);
  }

  if (existing) {
    const checkedAt = new Date();
    await prisma.whatsappDevice.updateMany({
      where: { id: existing.id, tenantId: actor.tenantId },
      data: {
        phoneNumber,
        connectionStatus: providerState.connectionStatus,
        lastStatusCheckedAt: checkedAt,
      },
    });
    if (providerState.connectionStatus === "CONNECTED") {
      return {
        deviceId: existing.id,
        qr: null,
        phoneNumber,
        alreadyConnected: true,
        message: "WhatsApp number is already connected.",
      };
    }
  }

  const deviceId = existing?.id ?? randomUUID();
  if (!existing) {
    await prisma.$transaction(async (tx) => {
      if (await tx.whatsappDevice.findFirst({ where: { tenantId: actor.tenantId, phoneNumber: { in: candidates } }, select: { id: true } })) {
        throw new ConflictError("That WhatsApp number is already configured for this organisation.");
      }
      const occupied = await tx.whatsappDevice.count({ where: { providerAccountId: account.id } });
      if (occupied >= account.deviceLimit) {
        throw new ConflictError("No WhatsApp device slots are available for this provider account.");
      }
      await tx.whatsappDevice.create({
        data: {
          id: deviceId,
          tenantId: actor.tenantId,
          providerAccountId: account.id,
          name: input.name,
          phoneNumber,
          connectionStatus: providerState.connectionStatus === "CONNECTED" ? "CONNECTED" : "PENDING",
          lastStatusCheckedAt: new Date(),
        },
      });
      await writeAuditLog(tx, { action: AUDIT_ACTIONS.WHATSAPP_DEVICE_CREATED, targetType: "WhatsappDevice", targetId: deviceId, actorUserId: actor.userId, actorTenantId: actor.tenantId, afterValue: { providerAccountId: account.id } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (providerState.connectionStatus === "CONNECTED") {
      await writeAuditLog(prisma, { action: AUDIT_ACTIONS.WHATSAPP_DEVICE_CONNECTED, targetType: "WhatsappDevice", targetId: deviceId, actorUserId: actor.userId, actorTenantId: actor.tenantId });
      return {
        deviceId,
        qr: null,
        phoneNumber,
        alreadyConnected: true,
        message: "WhatsApp number is already connected.",
      };
    }
  } else {
    await prisma.whatsappDevice.updateMany({
      where: { id: deviceId, tenantId: actor.tenantId },
      data: { connectionStatus: "PENDING" },
    });
  }

  const result = await generateDeviceQr(
    whatsappConfigForProviderDevice(account, phoneNumber),
    phoneNumber,
  );
  if (!result.ok) {
    if (result.definitive) {
      if (existing) {
        await prisma.whatsappDevice.updateMany({
          where: { id: deviceId, tenantId: actor.tenantId },
          data: { connectionStatus: providerState.connectionStatus },
        });
      } else {
        await prisma.whatsappDevice.deleteMany({
          where: { id: deviceId, tenantId: actor.tenantId },
        });
      }
      throw new BadRequestError(result.message);
    }
    throw new BadRequestError(`${result.message} The device was retained in a recoverable pending state; use Refresh status before retrying.`);
  }
  await writeAuditLog(prisma, { action: AUDIT_ACTIONS.WHATSAPP_DEVICE_QR_INITIATED, targetType: "WhatsappDevice", targetId: deviceId, actorUserId: actor.userId, actorTenantId: actor.tenantId });
  return { deviceId, qr: result.qr, phoneNumber, alreadyConnected: false, message: result.message };
}

export async function refreshWhatsappDeviceStatus(actor: ActorContext, deviceId: string) {
  const row = await loadDevice(actor, deviceId);
  const state = await syncWhatsappDeviceWithProvider(row);
  const status = state.connectionStatus;
  const previous = row.connectionStatus;
  await prisma.$transaction(async (tx) => {
    if (status !== previous && (status === "CONNECTED" || status === "DISCONNECTED")) {
      await writeAuditLog(tx, { action: status === "CONNECTED" ? AUDIT_ACTIONS.WHATSAPP_DEVICE_CONNECTED : AUDIT_ACTIONS.WHATSAPP_DEVICE_DISCONNECTED, targetType: "WhatsappDevice", targetId: row.id, actorUserId: actor.userId, actorTenantId: actor.tenantId });
    }
  });
  return { deviceId: row.id, connectionStatus: status, connected: status === "CONNECTED", present: state.outcome === "PRESENT", message: state.message };
}

async function referenceCount(tenantId: string, deviceId: string): Promise<number> {
  return prisma.whatsappDevice.count({ where: { id: deviceId, tenantId, OR: [{ tenantDefaults: { some: {} } }, { tenantBackups: { some: {} } }, { clinicOverrides: { some: {} } }] } });
}

export async function disconnectWhatsappDevice(actor: ActorContext, deviceId: string) {
  const row = await loadDevice(actor, deviceId);
  const result = await logoutDevice(whatsappConfigForProviderDevice(row.providerAccount, row.phoneNumber));
  if (!result.ok) throw new BadRequestError(result.message);
  await prisma.$transaction(async (tx) => {
    await tx.whatsappDevice.update({ where: { id: row.id }, data: { connectionStatus: "DISCONNECTED", lastStatusCheckedAt: new Date() } });
    await writeAuditLog(tx, { action: AUDIT_ACTIONS.WHATSAPP_DEVICE_DISCONNECTED, targetType: "WhatsappDevice", targetId: row.id, actorUserId: actor.userId, actorTenantId: actor.tenantId });
  });
}

export async function removeWhatsappDevice(actor: ActorContext, deviceId: string) {
  const row = await loadDevice(actor, deviceId);
  if (await referenceCount(actor.tenantId, deviceId)) throw new ConflictError("Reassign this device as primary, backup, or clinic sender before removing it.");
  const result = await deleteDevice(whatsappConfigForProviderDevice(row.providerAccount, row.phoneNumber));
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

async function createWhatsappWebhookCredential(actor: ActorContext, deviceId: string) {
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

export async function setupWhatsappWebhook(actor: ActorContext, deviceId: string) {
  const row = await loadDevice(actor, deviceId);
  if (row.webhookPublicId && row.webhookSecretHash) {
    return {
      webhookConfigured: true,
      webhookUrl: null,
      message: "Webhook is already configured. Regenerating creates a new URL and invalidates the previous one.",
    };
  }
  return createWhatsappWebhookCredential(actor, deviceId);
}

export async function regenerateWhatsappWebhook(actor: ActorContext, deviceId: string) {
  return createWhatsappWebhookCredential(actor, deviceId);
}
