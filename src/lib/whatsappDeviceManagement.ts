import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";
import { BadRequestError, ConflictError } from "@/lib/apiHandler";
import { prisma } from "@/lib/prisma";
import { requirePermission, type ActorContext } from "@/lib/rbac";
import { whatsappConfiguredDeviceCount, whatsappProviderHasCapacity } from "@/lib/whatsappDeviceCapacity";
import { probeWhatsappDeviceForProvider, syncWhatsappDeviceWithProvider, whatsappConfigForProviderDevice } from "@/lib/whatsappDeviceSync";
import { deleteDevice, generateDeviceQr, isWhatsappDeviceNotFoundMessage, logoutDevice } from "@/lib/whatsapp";

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
  z.object({ action: z.literal("refresh") }).strict(),
  z.object({ action: z.literal("reconnect") }).strict(),
  z.object({ action: z.literal("removeReferences") }).strict(),
  z.object({
    action: z.literal("remove"),
    routingAction: z.enum(["preserve", "clear", "reassign"]).default("preserve"),
    replacementDeviceId: z.string().min(1).optional(),
  }).strict(),
  z.object({ action: z.literal("disconnect") }).strict(),
  z.object({ action: z.literal("setEnabled"), enabled: z.boolean() }).strict(),
  z.object({ action: z.literal("setupWebhook") }).strict(),
  z.object({ action: z.literal("regenerateWebhook") }).strict(),
]);

export type WhatsappDeviceRoutingReferences = {
  organisationPrimary: boolean;
  organisationBackup: boolean;
  clinics: Array<{ id: string; name: string }>;
};

type RemoveRoutingPlan = {
  routingAction: "preserve" | "clear" | "reassign";
  replacementDeviceId?: string;
};

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

async function loadRoutingReferences(tenantId: string, deviceId: string): Promise<WhatsappDeviceRoutingReferences> {
  const [settings, clinics] = await Promise.all([
    prisma.tenantWhatsappSettings.findUnique({
      where: { tenantId },
      select: { defaultDeviceId: true, backupDeviceId: true },
    }),
    prisma.clinicWhatsappSettings.findMany({
      where: { tenantId, deviceId },
      orderBy: { clinic: { name: "asc" } },
      select: { clinic: { select: { id: true, name: true } } },
    }),
  ]);
  return {
    organisationPrimary: settings?.defaultDeviceId === deviceId,
    organisationBackup: settings?.backupDeviceId === deviceId,
    clinics: clinics.map((row) => row.clinic),
  };
}

function hasRoutingReferences(references: WhatsappDeviceRoutingReferences): boolean {
  return references.organisationPrimary || references.organisationBackup || references.clinics.length > 0;
}

export async function getWhatsappDeviceRoutingReferences(actor: ActorContext, deviceId: string) {
  await loadDevice(actor, deviceId);
  const [references, replacements] = await Promise.all([
    loadRoutingReferences(actor.tenantId, deviceId),
    prisma.whatsappDevice.findMany({
      where: {
        tenantId: actor.tenantId,
        id: { not: deviceId },
        enabled: true,
        providerAccount: { enabled: true },
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, phoneNumber: true, connectionStatus: true },
    }),
  ]);
  return { references, replacements };
}

export async function connectWhatsappDevice(actor: ActorContext, input: z.infer<typeof connectWhatsappDeviceSchema>) {
  await requirePermission(actor, "settings:manage");
  const phoneNumber = normalizeWhatsappDevicePhoneNumber(input.phoneNumber);
  const candidates = phoneLookupCandidates(phoneNumber);
  const existing = await prisma.whatsappDevice.findFirst({
    where: { tenantId: actor.tenantId, phoneNumber: { in: candidates } },
    select: { id: true },
  });
  if (existing) {
    throw new ConflictError("That WhatsApp number is already configured. Use Reconnect on the existing device.");
  }

  const accounts = await prisma.whatsappProviderAccount.findMany({
    where: { tenantId: actor.tenantId, enabled: true, ...(input.providerAccountId ? { id: input.providerAccountId } : {}) },
    orderBy: { createdAt: "asc" },
    include: whatsappConfiguredDeviceCount,
  });
  if (accounts.length === 0) throw new BadRequestError("No active WhatsApp provider account is configured.");
  const account = accounts.find(whatsappProviderHasCapacity);
  if (!account) throw new ConflictError("No WhatsApp device slots are available for this provider account.");

  const providerState = await probeWhatsappDeviceForProvider(account, phoneNumber);
  if (providerState.outcome === "UNKNOWN") {
    throw new BadRequestError(`${providerState.message} No new device was created.`);
  }

  const deviceId = randomUUID();
  await prisma.$transaction(async (tx) => {
    if (await tx.whatsappDevice.findFirst({ where: { tenantId: actor.tenantId, phoneNumber: { in: candidates } }, select: { id: true } })) {
      throw new ConflictError("That WhatsApp number is already configured for this organisation.");
    }
    const occupied = await tx.whatsappDevice.count({ where: { providerAccountId: account.id } });
    if (occupied >= account.deviceLimit) throw new ConflictError("No WhatsApp device slots are available for this provider account.");
    await tx.whatsappDevice.create({
      data: {
        id: deviceId,
        tenantId: actor.tenantId,
        providerAccountId: account.id,
        name: input.name,
        phoneNumber,
        connectionStatus: providerState.connectionStatus,
        lastStatusCheckedAt: new Date(),
      },
    });
    await writeAuditLog(tx, { action: AUDIT_ACTIONS.WHATSAPP_DEVICE_CREATED, targetType: "WhatsappDevice", targetId: deviceId, actorUserId: actor.userId, actorTenantId: actor.tenantId, afterValue: { providerAccountId: account.id } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  if (providerState.connectionStatus === "CONNECTED") {
    await writeAuditLog(prisma, { action: AUDIT_ACTIONS.WHATSAPP_DEVICE_CONNECTED, targetType: "WhatsappDevice", targetId: deviceId, actorUserId: actor.userId, actorTenantId: actor.tenantId });
    return { deviceId, qr: null, phoneNumber, alreadyConnected: true, message: "WhatsApp number is already connected." };
  }

  const result = await generateDeviceQr(whatsappConfigForProviderDevice(account, phoneNumber), phoneNumber);
  if (!result.ok) {
    if (result.definitive) {
      await prisma.whatsappDevice.deleteMany({ where: { id: deviceId, tenantId: actor.tenantId } });
      throw new BadRequestError(result.message);
    }
    await prisma.whatsappDevice.updateMany({ where: { id: deviceId, tenantId: actor.tenantId }, data: { connectionStatus: "UNKNOWN" } });
    throw new BadRequestError(`${result.message} The device was not marked as connecting.`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.whatsappDevice.updateMany({ where: { id: deviceId, tenantId: actor.tenantId }, data: { connectionStatus: "PENDING", lastStatusCheckedAt: new Date() } });
    await writeAuditLog(tx, { action: AUDIT_ACTIONS.WHATSAPP_DEVICE_QR_INITIATED, targetType: "WhatsappDevice", targetId: deviceId, actorUserId: actor.userId, actorTenantId: actor.tenantId });
  });
  return { deviceId, qr: result.qr, phoneNumber, alreadyConnected: false, message: result.message };
}

export async function reconnectWhatsappDevice(actor: ActorContext, deviceId: string) {
  const row = await loadDevice(actor, deviceId);
  if (!row.providerAccount.enabled) throw new BadRequestError("The WhatsApp provider account is disabled.");

  const providerState = await probeWhatsappDeviceForProvider(row.providerAccount, row.phoneNumber);
  if (providerState.outcome === "UNKNOWN") {
    await prisma.whatsappDevice.updateMany({ where: { id: row.id, tenantId: actor.tenantId }, data: { connectionStatus: "UNKNOWN", lastStatusCheckedAt: new Date() } });
    throw new BadRequestError("RkvRobo could not confirm the device state. The device was not marked as connecting.");
  }
  if (providerState.connectionStatus === "CONNECTED") {
    await prisma.whatsappDevice.updateMany({ where: { id: row.id, tenantId: actor.tenantId }, data: { connectionStatus: "CONNECTED", lastStatusCheckedAt: new Date() } });
    return { deviceId: row.id, qr: null, alreadyConnected: true, message: "WhatsApp is already connected." };
  }

  const result = await generateDeviceQr(whatsappConfigForProviderDevice(row.providerAccount, row.phoneNumber), row.phoneNumber);
  if (!result.ok) {
    const status = result.definitive ? providerState.connectionStatus : "UNKNOWN";
    await prisma.whatsappDevice.updateMany({ where: { id: row.id, tenantId: actor.tenantId }, data: { connectionStatus: status, lastStatusCheckedAt: new Date() } });
    throw new BadRequestError(result.definitive
      ? result.message
      : `${result.message} The existing device was not marked as connecting.`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.whatsappDevice.updateMany({ where: { id: row.id, tenantId: actor.tenantId }, data: { connectionStatus: "PENDING", lastStatusCheckedAt: new Date() } });
    await writeAuditLog(tx, { action: AUDIT_ACTIONS.WHATSAPP_DEVICE_QR_INITIATED, targetType: "WhatsappDevice", targetId: row.id, actorUserId: actor.userId, actorTenantId: actor.tenantId, afterValue: { reconnect: true } });
  });
  return { deviceId: row.id, qr: result.qr, alreadyConnected: false, message: result.message };
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

export async function removeWhatsappDevice(actor: ActorContext, deviceId: string, plan: RemoveRoutingPlan = { routingAction: "preserve" }) {
  const row = await loadDevice(actor, deviceId);
  const references = await loadRoutingReferences(actor.tenantId, deviceId);
  if (hasRoutingReferences(references) && plan.routingAction === "preserve") {
    throw new ConflictError("Choose whether to reassign or clear this device's routing before removing it.");
  }
  if (plan.routingAction === "reassign" && !plan.replacementDeviceId) {
    throw new BadRequestError("Choose a replacement WhatsApp device.");
  }
  if (plan.replacementDeviceId === deviceId) throw new BadRequestError("Choose a different replacement device.");
  if (plan.routingAction === "reassign") {
    const replacement = await prisma.whatsappDevice.findFirst({
      where: { id: plan.replacementDeviceId, tenantId: actor.tenantId, enabled: true, providerAccount: { enabled: true } },
      select: { id: true },
    });
    if (!replacement) throw new BadRequestError("Choose an active replacement device from this organisation.");
  }

  const providerState = await probeWhatsappDeviceForProvider(row.providerAccount, row.phoneNumber);
  let providerAlreadyAbsent = providerState.outcome === "NOT_FOUND";
  if (providerState.outcome === "UNKNOWN") {
    throw new BadRequestError("RkvRobo could not confirm whether this device still exists. Refresh status and retry.");
  }
  if (providerState.outcome === "PRESENT") {
    const result = await deleteDevice(whatsappConfigForProviderDevice(row.providerAccount, row.phoneNumber));
    providerAlreadyAbsent = !result.ok && isWhatsappDeviceNotFoundMessage(result.message);
    if (!result.ok && !providerAlreadyAbsent) throw new BadRequestError(result.message);
  }

  await prisma.$transaction(async (tx) => {
    const current = await tx.whatsappDevice.findFirst({ where: { id: row.id, tenantId: actor.tenantId }, select: { id: true } });
    if (!current) return;
    const settings = await tx.tenantWhatsappSettings.findUnique({
      where: { tenantId: actor.tenantId },
      select: { defaultDeviceId: true, backupDeviceId: true, automaticFailover: true },
    });
    const clinicReferenceCount = await tx.clinicWhatsappSettings.count({ where: { tenantId: actor.tenantId, deviceId: row.id } });
    const isPrimary = settings?.defaultDeviceId === row.id;
    const isBackup = settings?.backupDeviceId === row.id;
    const stillReferenced = isPrimary || isBackup || clinicReferenceCount > 0;
    if (stillReferenced && plan.routingAction === "preserve") {
      throw new ConflictError("Choose whether to reassign or clear this device's routing before removing it.");
    }

    let replacementId: string | null = null;
    if (plan.routingAction === "reassign") {
      const replacement = await tx.whatsappDevice.findFirst({
        where: { id: plan.replacementDeviceId, tenantId: actor.tenantId, enabled: true, providerAccount: { enabled: true } },
        select: { id: true },
      });
      if (!replacement) throw new BadRequestError("Choose an active replacement device from this organisation.");
      replacementId = replacement.id;
    }

    if (settings && (isPrimary || isBackup)) {
      const defaultDeviceId = isPrimary ? replacementId : settings.defaultDeviceId;
      const backupDeviceId = isBackup ? replacementId : settings.backupDeviceId;
      if (defaultDeviceId && defaultDeviceId === backupDeviceId) {
        throw new BadRequestError("The replacement would make the organisation primary and backup the same device.");
      }
      await tx.tenantWhatsappSettings.update({
        where: { tenantId: actor.tenantId },
        data: {
          defaultDeviceId,
          backupDeviceId,
          automaticFailover: Boolean(defaultDeviceId && backupDeviceId) ? settings.automaticFailover : false,
        },
      });
    }
    if (clinicReferenceCount > 0) {
      if (replacementId) {
        await tx.clinicWhatsappSettings.updateMany({ where: { tenantId: actor.tenantId, deviceId: row.id }, data: { deviceId: replacementId } });
      } else {
        await tx.clinicWhatsappSettings.deleteMany({ where: { tenantId: actor.tenantId, deviceId: row.id } });
      }
    }
    await tx.whatsappDevice.deleteMany({ where: { id: row.id, tenantId: actor.tenantId } });
    if (stillReferenced) {
      await writeAuditLog(tx, { action: AUDIT_ACTIONS.WHATSAPP_ROUTING_UPDATED, targetType: "WhatsappDevice", targetId: row.id, actorUserId: actor.userId, actorTenantId: actor.tenantId, afterValue: { removalRoutingAction: plan.routingAction, clinicCount: clinicReferenceCount } });
    }
    await writeAuditLog(tx, { action: AUDIT_ACTIONS.WHATSAPP_DEVICE_REMOVED, targetType: "WhatsappDevice", targetId: row.id, actorUserId: actor.userId, actorTenantId: actor.tenantId, afterValue: { providerAlreadyAbsent, routingAction: plan.routingAction } });
  });
  return { deviceId: row.id, providerAlreadyAbsent };
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
    return { webhookConfigured: true, webhookUrl: null, message: "Webhook is already configured. Regenerating creates a new URL and invalidates the previous one." };
  }
  return createWhatsappWebhookCredential(actor, deviceId);
}

export async function regenerateWhatsappWebhook(actor: ActorContext, deviceId: string) {
  return createWhatsappWebhookCredential(actor, deviceId);
}
