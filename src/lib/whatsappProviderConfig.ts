import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";
import { BadRequestError } from "@/lib/apiHandler";
import { prisma } from "@/lib/prisma";
import {
  can,
  PermissionError,
  requirePermission,
  type ActorContext,
} from "@/lib/rbac";
import { decryptWhatsappApiKey } from "@/lib/whatsappCredentialCrypto";
import type { WhatsappConfig } from "@/lib/whatsapp";

export interface ResolvedWhatsappConfig extends WhatsappConfig {
  deviceId: string;
  providerAccountId: string;
  usedFallback: boolean;
}

export const saveWhatsappRoutingSchema = z
  .object({
    defaultDeviceId: z.string().min(1).nullable(),
    backupDeviceId: z.string().min(1).nullable(),
    automaticFailover: z.boolean(),
    clinicOverrides: z
      .array(
        z.object({
          clinicId: z.string().min(1),
          deviceId: z.string().min(1).nullable(),
        }).strict(),
      )
      .max(250),
  })
  .strict();

export const whatsappConfigMutationSchema = z.object({
  action: z.literal("saveRouting"),
  value: saveWhatsappRoutingSchema,
});

export interface WhatsappConfigurationView {
  accounts: Array<{
    id: string;
    name: string;
    enabled: boolean;
    deviceLimit: number;
    devices: Array<{
      id: string;
      name: string;
      phoneNumber: string;
      enabled: boolean;
      connectionStatus: "PENDING" | "CONNECTED" | "DISCONNECTED" | "UNKNOWN";
      lastStatusCheckedAt: string | null;
      webhookConfigured: boolean;
    }>;
  }>;
  defaultDeviceId: string | null;
  backupDeviceId: string | null;
  automaticFailover: boolean;
  clinics: Array<{ id: string; name: string; deviceId: string | null }>;
}

async function requireSettingsView(actor: ActorContext): Promise<void> {
  if (
    !(await can(actor, "settings:view")) &&
    !(await can(actor, "settings:manage"))
  ) {
    throw new PermissionError("settings:view");
  }
}

export async function getWhatsappConfigurationForActor(
  actor: ActorContext,
): Promise<WhatsappConfigurationView> {
  await requireSettingsView(actor);
  const [accounts, settings, clinics] = await Promise.all([
    prisma.whatsappProviderAccount.findMany({
      where: { tenantId: actor.tenantId },
      orderBy: [{ createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        enabled: true,
        deviceLimit: true,
        devices: {
          orderBy: [{ createdAt: "asc" }],
          select: {
            id: true,
            name: true,
            phoneNumber: true,
            enabled: true,
            connectionStatus: true,
            lastStatusCheckedAt: true,
            webhookPublicId: true,
            webhookSecretHash: true,
          },
        },
      },
    }),
    prisma.tenantWhatsappSettings.findUnique({
      where: { tenantId: actor.tenantId },
      select: { defaultDeviceId: true, backupDeviceId: true, automaticFailover: true },
    }),
    prisma.clinic.findMany({
      where: { tenantId: actor.tenantId },
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        name: true,
        whatsappSettings: { select: { deviceId: true } },
      },
    }),
  ]);

  return {
    accounts: accounts.map((account) => ({
      ...account,
      devices: account.devices.map((device) => ({
        id: device.id,
        name: device.name,
        phoneNumber: device.phoneNumber,
        enabled: device.enabled,
        connectionStatus: device.connectionStatus,
        lastStatusCheckedAt: device.lastStatusCheckedAt?.toISOString() ?? null,
        webhookConfigured: Boolean(device.webhookPublicId && device.webhookSecretHash),
      })),
    })),
    defaultDeviceId: settings?.defaultDeviceId ?? null,
    backupDeviceId: settings?.backupDeviceId ?? null,
    automaticFailover: settings?.automaticFailover ?? false,
    clinics: clinics.map((clinic) => ({
      id: clinic.id,
      name: clinic.name,
      deviceId: clinic.whatsappSettings?.deviceId ?? null,
    })),
  };
}

async function assertSelectableDevices(
  tx: Prisma.TransactionClient,
  tenantId: string,
  deviceIds: readonly string[],
): Promise<void> {
  if (deviceIds.length === 0) return;
  const count = await tx.whatsappDevice.count({
    where: {
      id: { in: [...new Set(deviceIds)] },
      tenantId,
      enabled: true,
      providerAccount: { enabled: true },
    },
  });
  if (count !== new Set(deviceIds).size) {
    throw new BadRequestError("Choose only active devices from this organisation.");
  }
}

export async function saveWhatsappRoutingForActor(
  actor: ActorContext,
  input: z.infer<typeof saveWhatsappRoutingSchema>,
): Promise<void> {
  await requirePermission(actor, "settings:manage");
  const uniqueClinicIds = new Set(input.clinicOverrides.map((row) => row.clinicId));
  if (uniqueClinicIds.size !== input.clinicOverrides.length) {
    throw new BadRequestError("Each clinic may be configured only once.");
  }

  await prisma.$transaction(async (tx) => {
    const previousSettings = await tx.tenantWhatsappSettings.findUnique({
      where: { tenantId: actor.tenantId },
      select: { defaultDeviceId: true, backupDeviceId: true, automaticFailover: true },
    });
    const clinicCount = await tx.clinic.count({
      where: { id: { in: [...uniqueClinicIds] }, tenantId: actor.tenantId },
    });
    if (clinicCount !== uniqueClinicIds.size) {
      throw new BadRequestError("One or more clinics were not found.");
    }
    await assertSelectableDevices(
      tx,
      actor.tenantId,
      [
        ...(input.defaultDeviceId ? [input.defaultDeviceId] : []),
        ...(input.backupDeviceId ? [input.backupDeviceId] : []),
        ...input.clinicOverrides.flatMap((row) => row.deviceId ? [row.deviceId] : []),
      ],
    );
    if (input.defaultDeviceId && input.defaultDeviceId === input.backupDeviceId) {
      throw new BadRequestError("Primary and backup WhatsApp devices must be different.");
    }

    await tx.tenantWhatsappSettings.upsert({
      where: { tenantId: actor.tenantId },
      create: {
        tenantId: actor.tenantId,
        defaultDeviceId: input.defaultDeviceId,
        backupDeviceId: input.backupDeviceId,
        automaticFailover: input.automaticFailover,
      },
      update: {
        defaultDeviceId: input.defaultDeviceId,
        backupDeviceId: input.backupDeviceId,
        automaticFailover: input.automaticFailover,
      },
    });
    for (const row of input.clinicOverrides) {
      if (row.deviceId) {
        await tx.clinicWhatsappSettings.upsert({
          where: { clinicId: row.clinicId },
          create: { tenantId: actor.tenantId, clinicId: row.clinicId, deviceId: row.deviceId },
          update: { deviceId: row.deviceId },
        });
      } else {
        await tx.clinicWhatsappSettings.deleteMany({
          where: { tenantId: actor.tenantId, clinicId: row.clinicId },
        });
      }
    }
    await writeAuditLog(tx, {
      action: AUDIT_ACTIONS.WHATSAPP_ROUTING_UPDATED,
      targetType: "TenantWhatsappSettings",
      targetId: actor.tenantId,
      actorUserId: actor.userId,
      actorTenantId: actor.tenantId,
      afterValue: {
        hasDefault: input.defaultDeviceId !== null,
        hasBackup: input.backupDeviceId !== null,
        automaticFailover: input.automaticFailover,
        clinicOverrideCount: input.clinicOverrides.filter((row) => row.deviceId).length,
      },
    });
    const auditBase = { targetType: "TenantWhatsappSettings", targetId: actor.tenantId, actorUserId: actor.userId, actorTenantId: actor.tenantId } as const;
    if ((previousSettings?.defaultDeviceId ?? null) !== input.defaultDeviceId) await writeAuditLog(tx, { ...auditBase, action: AUDIT_ACTIONS.WHATSAPP_PRIMARY_CHANGED });
    if ((previousSettings?.backupDeviceId ?? null) !== input.backupDeviceId) await writeAuditLog(tx, { ...auditBase, action: AUDIT_ACTIONS.WHATSAPP_BACKUP_CHANGED });
    if ((previousSettings?.automaticFailover ?? false) !== input.automaticFailover) await writeAuditLog(tx, { ...auditBase, action: AUDIT_ACTIONS.WHATSAPP_FAILOVER_CHANGED, afterValue: { enabled: input.automaticFailover } });
    if (input.clinicOverrides.length > 0) await writeAuditLog(tx, { ...auditBase, action: AUDIT_ACTIONS.WHATSAPP_CLINIC_ASSIGNMENT_CHANGED, afterValue: { clinicCount: input.clinicOverrides.length } });
  });
}

/** Resolves clinic override first, then the organisation default. Fails closed. */
export async function resolveWhatsappConfigForClinic(
  tenantId: string,
  clinicId: string,
): Promise<ResolvedWhatsappConfig | null> {
  const clinic = await prisma.clinic.findFirst({
    where: { id: clinicId, tenantId },
    select: {
      whatsappSettings: {
        select: {
          device: {
            select: {
              id: true,
              tenantId: true,
              phoneNumber: true,
              enabled: true,
              connectionStatus: true,
              providerAccount: {
                select: {
                  id: true,
                  enabled: true,
                  apiBaseUrl: true,
                  encryptedApiKey: true,
                },
              },
            },
          },
        },
      },
      tenant: {
        select: {
          whatsappSettings: {
            select: {
              automaticFailover: true,
              defaultDevice: {
                select: {
                  id: true,
                  tenantId: true,
                  phoneNumber: true,
                  enabled: true,
                  connectionStatus: true,
                  providerAccount: {
                    select: {
                      id: true,
                      enabled: true,
                      apiBaseUrl: true,
                      encryptedApiKey: true,
                    },
                  },
                },
              },
              backupDevice: {
                select: {
                  id: true,
                  tenantId: true,
                  phoneNumber: true,
                  enabled: true,
                  connectionStatus: true,
                  providerAccount: {
                    select: {
                      id: true,
                      enabled: true,
                      apiBaseUrl: true,
                      encryptedApiKey: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!clinic) return null;

  const explicitClinicDevice = clinic.whatsappSettings?.device ?? null;
  const tenantSettings = clinic.tenant.whatsappSettings;
  const primary = tenantSettings?.defaultDevice ?? null;
  const backup = tenantSettings?.backupDevice ?? null;
  let device = explicitClinicDevice ?? primary;
  let usedFallback = false;

  // Clinic overrides never inherit an organisation backup: switching to an
  // unrelated number would violate the clinic's explicit routing choice.
  if (
    !explicitClinicDevice &&
    tenantSettings?.automaticFailover &&
    primary?.connectionStatus === "DISCONNECTED"
  ) {
    if (backup?.connectionStatus !== "CONNECTED") return null;
    device = backup;
    usedFallback = true;
  }
  if (
    !device ||
    device.tenantId !== tenantId ||
    !device.enabled ||
    !device.providerAccount.enabled
  ) {
    return null;
  }

  return {
    deviceId: device.id,
    providerAccountId: device.providerAccount.id,
    usedFallback,
    sender: device.phoneNumber,
    baseUrl: device.providerAccount.apiBaseUrl.replace(/\/+$/, ""),
    apiKey: decryptWhatsappApiKey(
      device.providerAccount.encryptedApiKey,
      tenantId,
      device.providerAccount.id,
    ),
  };
}
