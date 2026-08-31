import type {
  ClinicTelephonyConfig,
  ClinicTelephonyRoutingMode,
} from "@prisma/client";
import { z } from "zod";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";
import { BadRequestError, ConflictError } from "@/lib/apiHandler";
import { prisma } from "@/lib/prisma";
import type { ActorContext } from "@/lib/rbac";
import { assertActorCanManageTelephony } from "@/lib/telephony/access";
import {
  ianaTimezoneSchema,
  normalizePlivoDestinationNumber,
  optionalConfiguredPhoneNumberSchema,
} from "@/lib/telephony/phoneNumber";

export const DEFAULT_CLINIC_TIMEZONE = "Asia/Kolkata";
export const DEFAULT_CLINIC_TELEPHONY_ROUTING_MODE = "AFTER_HOURS" as const;
export const CLINIC_TELEPHONY_ROUTING_MODES = [
  "AUTO",
  "OPEN",
  "AFTER_HOURS",
] as const satisfies readonly ClinicTelephonyRoutingMode[];

export const updateClinicTelephonyConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    plivoNumber: optionalConfiguredPhoneNumberSchema.optional(),
    publicPhoneNumber: optionalConfiguredPhoneNumberSchema.optional(),
    receptionPhoneNumber: optionalConfiguredPhoneNumberSchema.optional(),
    urgentPhoneNumber: optionalConfiguredPhoneNumberSchema.optional(),
    timezone: ianaTimezoneSchema.optional(),
    routingMode: z.enum(CLINIC_TELEPHONY_ROUTING_MODES).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "No changes submitted.",
  });

export type UpdateClinicTelephonyConfigInput = z.infer<
  typeof updateClinicTelephonyConfigSchema
>;

export interface ClinicTelephonyConfigView {
  clinicId: string;
  enabled: boolean;
  plivoNumber: string | null;
  publicPhoneNumber: string | null;
  receptionPhoneNumber: string | null;
  urgentPhoneNumber: string | null;
  timezone: string;
  routingMode: ClinicTelephonyRoutingMode;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface InboundClinicContext {
  readonly clinicId: string;
  readonly tenantId: string;
  readonly clinicName: string;
  readonly clinicAddress?: string | null;
  readonly clinicCity?: string | null;
  readonly timezone: string;
  readonly routingMode?: ClinicTelephonyRoutingMode;
  readonly publicPhoneNumber: string | null;
  readonly receptionPhoneNumber: string | null;
  readonly urgentPhoneNumber: string | null;
}

interface InboundConfigRow {
  enabled: boolean;
  timezone: string;
  routingMode?: ClinicTelephonyRoutingMode;
  publicPhoneNumber: string | null;
  receptionPhoneNumber: string | null;
  urgentPhoneNumber: string | null;
  clinic: {
    id: string;
    tenantId: string;
    name: string;
    address?: string | null;
    city?: string | null;
  };
}

export type InboundClinicLookup = (
  canonicalPlivoNumber: string,
) => Promise<InboundConfigRow | null>;

function defaultView(clinicId: string): ClinicTelephonyConfigView {
  return {
    clinicId,
    enabled: false,
    plivoNumber: null,
    publicPhoneNumber: null,
    receptionPhoneNumber: null,
    urgentPhoneNumber: null,
    timezone: DEFAULT_CLINIC_TIMEZONE,
    routingMode: DEFAULT_CLINIC_TELEPHONY_ROUTING_MODE,
    createdAt: null,
    updatedAt: null,
  };
}

function toView(config: ClinicTelephonyConfig): ClinicTelephonyConfigView {
  return {
    clinicId: config.clinicId,
    enabled: config.enabled,
    plivoNumber: config.plivoNumber,
    publicPhoneNumber: config.publicPhoneNumber,
    receptionPhoneNumber: config.receptionPhoneNumber,
    urgentPhoneNumber: config.urgentPhoneNumber,
    timezone: config.timezone,
    routingMode:
      config.routingMode ?? DEFAULT_CLINIC_TELEPHONY_ROUTING_MODE,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}

type ConfigState = Pick<
  ClinicTelephonyConfigView,
  | "enabled"
  | "plivoNumber"
  | "publicPhoneNumber"
  | "receptionPhoneNumber"
  | "urgentPhoneNumber"
  | "timezone"
  | "routingMode"
>;

export function validateClinicTelephonyConfigState(state: ConfigState): void {
  if (state.enabled && state.plivoNumber === null) {
    throw new BadRequestError(
      "A provider number is required before telephony can be enabled.",
    );
  }

  for (const [label, value] of [
    ["Reception", state.receptionPhoneNumber],
    ["Urgent", state.urgentPhoneNumber],
  ] as const) {
    if (value !== null && value === state.publicPhoneNumber) {
      throw new BadRequestError(
        `${label} number must not match the public clinic number.`,
      );
    }
    if (value !== null && value === state.plivoNumber) {
      throw new BadRequestError(
        `${label} number must not match the provider number.`,
      );
    }
  }
}

export async function getClinicTelephonyConfigForActor(
  actor: ActorContext,
  clinicId: string,
): Promise<ClinicTelephonyConfigView> {
  await assertActorCanManageTelephony(actor, clinicId);
  const config = await prisma.clinicTelephonyConfig.findUnique({
    where: { clinicId },
  });
  return config ? toView(config) : defaultView(clinicId);
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export async function updateClinicTelephonyConfigForActor(
  actor: ActorContext,
  clinicId: string,
  input: UpdateClinicTelephonyConfigInput,
): Promise<ClinicTelephonyConfigView> {
  await assertActorCanManageTelephony(actor, clinicId);
  const existing = await prisma.clinicTelephonyConfig.findUnique({
    where: { clinicId },
  });
  const current = existing ? toView(existing) : defaultView(clinicId);
  const next: ConfigState = {
    enabled: input.enabled ?? current.enabled,
    plivoNumber:
      input.plivoNumber === undefined ? current.plivoNumber : input.plivoNumber,
    publicPhoneNumber:
      input.publicPhoneNumber === undefined
        ? current.publicPhoneNumber
        : input.publicPhoneNumber,
    receptionPhoneNumber:
      input.receptionPhoneNumber === undefined
        ? current.receptionPhoneNumber
        : input.receptionPhoneNumber,
    urgentPhoneNumber:
      input.urgentPhoneNumber === undefined
        ? current.urgentPhoneNumber
        : input.urgentPhoneNumber,
    timezone: input.timezone ?? current.timezone,
    routingMode: input.routingMode ?? current.routingMode,
  };
  validateClinicTelephonyConfigState(next);

  const changedFields = Object.keys(input).filter(
    (field) =>
      current[field as keyof ConfigState] !== next[field as keyof ConfigState],
  );
  if (existing && changedFields.length === 0) {
    return current;
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const config = await tx.clinicTelephonyConfig.upsert({
        where: { clinicId },
        create: { clinicId, ...next },
        update: next,
      });
      await writeAuditLog(tx, {
        action: AUDIT_ACTIONS.CLINIC_TELEPHONY_CONFIG_UPDATED,
        targetType: "ClinicTelephonyConfig",
        targetId: config.id,
        actorUserId: actor.userId,
        actorTenantId: actor.tenantId,
        afterValue: { clinicId, changedFields, enabled: next.enabled },
      });
      return config;
    });
    return toView(updated);
  } catch (error: unknown) {
    if (isUniqueConstraintError(error)) {
      throw new ConflictError("That provider number is already assigned.");
    }
    throw error;
  }
}

const lookupInboundClinic: InboundClinicLookup = async (plivoNumber) =>
  prisma.clinicTelephonyConfig.findUnique({
    where: { plivoNumber },
    select: {
      enabled: true,
      timezone: true,
      routingMode: true,
      publicPhoneNumber: true,
      receptionPhoneNumber: true,
      urgentPhoneNumber: true,
      clinic: {
        select: {
          id: true,
          tenantId: true,
          name: true,
          address: true,
          city: true,
        },
      },
    },
  });

/** Call only with `To` read from a successfully validated Plivo request. */
export async function resolveInboundClinicByPlivoNumber(
  to: unknown,
  lookup: InboundClinicLookup = lookupInboundClinic,
): Promise<InboundClinicContext | null> {
  if (typeof to !== "string") {
    return null;
  }

  let canonical: string;
  try {
    canonical = normalizePlivoDestinationNumber(to);
  } catch {
    return null;
  }

  const config = await lookup(canonical);
  if (!config?.enabled) {
    return null;
  }

  return Object.freeze({
    clinicId: config.clinic.id,
    tenantId: config.clinic.tenantId,
    clinicName: config.clinic.name,
    clinicAddress: config.clinic.address ?? null,
    clinicCity: config.clinic.city ?? null,
    timezone: config.timezone,
    routingMode:
      config.routingMode ?? DEFAULT_CLINIC_TELEPHONY_ROUTING_MODE,
    publicPhoneNumber: config.publicPhoneNumber,
    receptionPhoneNumber: config.receptionPhoneNumber,
    urgentPhoneNumber: config.urgentPhoneNumber,
  });
}
