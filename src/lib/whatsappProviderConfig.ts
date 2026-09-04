import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";
import { BadRequestError, ConflictError } from "@/lib/apiHandler";
import { prisma } from "@/lib/prisma";
import {
  can,
  PermissionError,
  requirePermission,
  type ActorContext,
} from "@/lib/rbac";
import {
  decryptWhatsappApiKey,
  encryptWhatsappApiKey,
} from "@/lib/whatsappCredentialCrypto";
import type { WhatsappConfig } from "@/lib/whatsapp";

export interface ResolvedWhatsappConfig extends WhatsappConfig {
  deviceId: string;
  providerAccountId: string;
}

export const RKVROBO_DEFAULT_BASE_URL = "https://bot.rkvrobo.in/api";

const nameSchema = z.string().trim().min(1).max(100);
const baseUrlSchema = z
  .string()
  .trim()
  .url()
  .max(500)
  .transform((value) => value.replace(/\/+$/, ""))
  .refine((value) => new URL(value).protocol === "https:", {
    message: "The provider API URL must use HTTPS.",
  });
const phoneNumberSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[^\d]/g, ""))
  .refine((value) => value.length >= 10 && value.length <= 15, {
    message: "Enter the WhatsApp device number with country code.",
  });

export const saveWhatsappAccountSchema = z
  .object({
    accountId: z.string().min(1).optional(),
    name: nameSchema,
    apiBaseUrl: baseUrlSchema.default(RKVROBO_DEFAULT_BASE_URL),
    apiKey: z.string().trim().min(8).max(1000).optional(),
    enabled: z.boolean().default(true),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.accountId && !value.apiKey) {
      ctx.addIssue({
        code: "custom",
        path: ["apiKey"],
        message: "The RkvRobo API key is required for a new account.",
      });
    }
  });

export const saveWhatsappDeviceSchema = z
  .object({
    deviceId: z.string().min(1).optional(),
    providerAccountId: z.string().min(1),
    name: nameSchema,
    phoneNumber: phoneNumberSchema,
    enabled: z.boolean().default(true),
  })
  .strict();

export const saveWhatsappRoutingSchema = z
  .object({
    defaultDeviceId: z.string().min(1).nullable(),
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

export const whatsappConfigMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("saveAccount"), value: saveWhatsappAccountSchema }),
  z.object({ action: z.literal("saveDevice"), value: saveWhatsappDeviceSchema }),
  z.object({ action: z.literal("saveRouting"), value: saveWhatsappRoutingSchema }),
]);

export interface WhatsappConfigurationView {
  accounts: Array<{
    id: string;
    name: string;
    apiBaseUrl: string;
    enabled: boolean;
    hasApiKey: true;
    devices: Array<{
      id: string;
      name: string;
      phoneNumber: string;
      enabled: boolean;
    }>;
  }>;
  defaultDeviceId: string | null;
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
        apiBaseUrl: true,
        enabled: true,
        devices: {
          orderBy: [{ createdAt: "asc" }],
          select: {
            id: true,
            name: true,
            phoneNumber: true,
            enabled: true,
          },
        },
      },
    }),
    prisma.tenantWhatsappSettings.findUnique({
      where: { tenantId: actor.tenantId },
      select: { defaultDeviceId: true },
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
    accounts: accounts.map((account) => ({ ...account, hasApiKey: true as const })),
    defaultDeviceId: settings?.defaultDeviceId ?? null,
    clinics: clinics.map((clinic) => ({
      id: clinic.id,
      name: clinic.name,
      deviceId: clinic.whatsappSettings?.deviceId ?? null,
    })),
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2002",
  );
}

export async function saveWhatsappAccountForActor(
  actor: ActorContext,
  input: z.infer<typeof saveWhatsappAccountSchema>,
): Promise<void> {
  await requirePermission(actor, "settings:manage");
  const accountId = input.accountId ?? randomUUID();
  const existing = input.accountId
    ? await prisma.whatsappProviderAccount.findFirst({
        where: { id: input.accountId, tenantId: actor.tenantId },
        select: { id: true, encryptedApiKey: true, enabled: true },
      })
    : null;
  if (input.accountId && !existing) throw new BadRequestError("Provider account not found.");

  if (!input.enabled && existing?.enabled) {
    const selected = await prisma.whatsappDevice.count({
      where: {
        tenantId: actor.tenantId,
        providerAccountId: accountId,
        OR: [
          { tenantDefaults: { some: { tenantId: actor.tenantId } } },
          { clinicOverrides: { some: { tenantId: actor.tenantId } } },
        ],
      },
    });
    if (selected > 0) {
      throw new ConflictError("Choose replacement devices before disabling this account.");
    }
  }

  const encryptedApiKey = input.apiKey
    ? encryptWhatsappApiKey(input.apiKey, actor.tenantId, accountId)
    : existing!.encryptedApiKey;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.whatsappProviderAccount.upsert({
        where: { id: accountId },
        create: {
          id: accountId,
          tenantId: actor.tenantId,
          name: input.name,
          apiBaseUrl: input.apiBaseUrl,
          encryptedApiKey,
          enabled: input.enabled,
        },
        update: {
          name: input.name,
          apiBaseUrl: input.apiBaseUrl,
          encryptedApiKey,
          enabled: input.enabled,
        },
      });
      await writeAuditLog(tx, {
        action: input.accountId
          ? AUDIT_ACTIONS.WHATSAPP_PROVIDER_ACCOUNT_UPDATED
          : AUDIT_ACTIONS.WHATSAPP_PROVIDER_ACCOUNT_CREATED,
        targetType: "WhatsappProviderAccount",
        targetId: accountId,
        actorUserId: actor.userId,
        actorTenantId: actor.tenantId,
        afterValue: { enabled: input.enabled },
      });
    });
  } catch (error: unknown) {
    if (isUniqueConstraintError(error)) {
      throw new ConflictError("A provider account with that name already exists.");
    }
    throw error;
  }
}

export async function saveWhatsappDeviceForActor(
  actor: ActorContext,
  input: z.infer<typeof saveWhatsappDeviceSchema>,
): Promise<void> {
  await requirePermission(actor, "settings:manage");
  const account = await prisma.whatsappProviderAccount.findFirst({
    where: { id: input.providerAccountId, tenantId: actor.tenantId },
    select: { id: true, enabled: true },
  });
  if (!account) throw new BadRequestError("Provider account not found.");

  const existing = input.deviceId
    ? await prisma.whatsappDevice.findFirst({
        where: { id: input.deviceId, tenantId: actor.tenantId },
        select: { id: true, enabled: true },
      })
    : null;
  if (input.deviceId && !existing) throw new BadRequestError("WhatsApp device not found.");

  if ((!input.enabled || !account.enabled) && existing?.enabled) {
    const selected = await prisma.whatsappDevice.count({
      where: {
        id: input.deviceId,
        tenantId: actor.tenantId,
        OR: [
          { tenantDefaults: { some: { tenantId: actor.tenantId } } },
          { clinicOverrides: { some: { tenantId: actor.tenantId } } },
        ],
      },
    });
    if (selected > 0) {
      throw new ConflictError(
        "Choose a replacement before making this routed device unavailable.",
      );
    }
  }

  const deviceId = input.deviceId ?? randomUUID();
  try {
    await prisma.$transaction(async (tx) => {
      if (input.deviceId) {
        await tx.whatsappDevice.update({
          where: { id: deviceId },
          data: {
            providerAccountId: input.providerAccountId,
            name: input.name,
            phoneNumber: input.phoneNumber,
            enabled: input.enabled,
          },
        });
      } else {
        await tx.whatsappDevice.create({
          data: {
            id: deviceId,
            tenantId: actor.tenantId,
            providerAccountId: input.providerAccountId,
            name: input.name,
            phoneNumber: input.phoneNumber,
            enabled: input.enabled,
          },
        });
      }
      await writeAuditLog(tx, {
        action: input.deviceId
          ? AUDIT_ACTIONS.WHATSAPP_DEVICE_UPDATED
          : AUDIT_ACTIONS.WHATSAPP_DEVICE_CREATED,
        targetType: "WhatsappDevice",
        targetId: deviceId,
        actorUserId: actor.userId,
        actorTenantId: actor.tenantId,
        afterValue: { enabled: input.enabled, providerAccountId: input.providerAccountId },
      });
    });
  } catch (error: unknown) {
    if (isUniqueConstraintError(error)) {
      throw new ConflictError("That device number already exists on this provider account.");
    }
    throw error;
  }
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
        ...input.clinicOverrides.flatMap((row) => row.deviceId ? [row.deviceId] : []),
      ],
    );

    await tx.tenantWhatsappSettings.upsert({
      where: { tenantId: actor.tenantId },
      create: { tenantId: actor.tenantId, defaultDeviceId: input.defaultDeviceId },
      update: { defaultDeviceId: input.defaultDeviceId },
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
        clinicOverrideCount: input.clinicOverrides.filter((row) => row.deviceId).length,
      },
    });
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
              defaultDevice: {
                select: {
                  id: true,
                  tenantId: true,
                  phoneNumber: true,
                  enabled: true,
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

  const device =
    clinic.whatsappSettings?.device ??
    clinic.tenant.whatsappSettings?.defaultDevice ??
    null;
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
    sender: device.phoneNumber,
    baseUrl: device.providerAccount.apiBaseUrl.replace(/\/+$/, ""),
    apiKey: decryptWhatsappApiKey(
      device.providerAccount.encryptedApiKey,
      tenantId,
      device.providerAccount.id,
    ),
  };
}
