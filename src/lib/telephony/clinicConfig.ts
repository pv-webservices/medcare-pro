import type { ClinicTelephonyConfig } from "@prisma/client";
import { z } from "zod";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";
import { BadRequestError, ConflictError } from "@/lib/apiHandler";
import { prisma } from "@/lib/prisma";
import {
  assertClinicInTenant,
  can,
  requirePermission,
  ScopeError,
  type ActorContext,
} from "@/lib/rbac";
import {
  ianaTimezoneSchema,
  normalizePlivoDestinationNumber,
  optionalConfiguredPhoneNumberSchema,
} from "@/lib/telephony/phoneNumber";

export const DEFAULT_CLINIC_TIMEZONE = "Asia/Kolkata";

export const updateClinicTelephonyConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    plivoNumber: optionalConfiguredPhoneNumberSchema.optional(),
    publicPhoneNumber: optionalConfiguredPhoneNumberSchema.optional(),
    receptionPhoneNumber: optionalConfiguredPhoneNumberSchema.optional(),
    urgentPhoneNumber: optionalConfiguredPhoneNumberSchema.optional(),
    timezone: ianaTimezoneSchema.optional(),
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
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface InboundClinicContext {
  readonly clinicId: string;
  readonly tenantId: string;
  readonly clinicName: string;
  readonly timezone: string;
  readonly publicPhoneNumber: string | null;
  readonly receptionPhoneNumber: string | null;
  readonly urgentPhoneNumber: string | null;
}

interface InboundConfigRow {
  enabled: boolean;
  timezone: string;
  publicPhoneNumber: string | null;
  receptionPhoneNumber: string | null;
  urgentPhoneNumber: string | null;
  clinic: { id: string; tenantId: string; name: string };
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
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}

async function assertActorCanManage(
  actor: ActorContext,
  clinicId: string,
): Promise<void> {
  await assertClinicInTenant(actor.tenantId, clinicId);
  if (!(await can(actor, "clinic:read", clinicId))) {
    throw new ScopeError();
  }
  await requirePermission(actor, "clinic:edit", clinicId);
}

type ConfigState = Pick<
  ClinicTelephonyConfigView,
  | "enabled"
  | "plivoNumber"
  | "publicPhoneNumber"
  | "receptionPhoneNumber"
  | "urgentPhoneNumber"
  | "timezone"
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
  await assertActorCanManage(actor, clinicId);
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
  await assertActorCanManage(actor, clinicId);
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
      publicPhoneNumber: true,
      receptionPhoneNumber: true,
      urgentPhoneNumber: true,
      clinic: { select: { id: true, tenantId: true, name: true } },
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
    timezone: config.timezone,
    publicPhoneNumber: config.publicPhoneNumber,
    receptionPhoneNumber: config.receptionPhoneNumber,
    urgentPhoneNumber: config.urgentPhoneNumber,
  });
}
