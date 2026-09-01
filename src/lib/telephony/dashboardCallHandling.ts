import type { ClinicTelephonyRoutingMode } from "@prisma/client";
import { moduleLock, MODULE_FEATURES } from "@/lib/features";
import { prisma } from "@/lib/prisma";
import { PermissionError, type ActorContext } from "@/lib/rbac";
import { assertActorCanManageTelephony } from "@/lib/telephony/access";
import {
  getClinicBusinessHoursForTrustedClinic,
  resolveClinicBusinessState,
  type ClinicBusinessHoursDay,
  type ClinicNextOpening,
} from "@/lib/telephony/businessHours";
import {
  DEFAULT_CLINIC_TELEPHONY_ROUTING_MODE,
  DEFAULT_CLINIC_TIMEZONE,
} from "@/lib/telephony/clinicConfig";
import { resolveCallHandlingEffectiveState } from "@/lib/telephony/dashboardCallHandlingState";
import { isReceptionDestinationAvailable } from "@/lib/telephony/reception";
import type { EffectiveTelephonyRoute } from "@/lib/telephony/routing";

export interface DashboardCallHandlingModel {
  clinicId: string;
  enabled: boolean;
  routingMode: ClinicTelephonyRoutingMode;
  effectiveRoute: EffectiveTelephonyRoute | null;
  isOpen: boolean;
  hasRegularHours: boolean;
  todayHours: ClinicBusinessHoursDay;
  nextOpening: ClinicNextOpening | null;
  receptionAvailable: boolean;
  canManage: boolean;
  updatedAt: string | null;
}

/**
 * Narrow dashboard read model. Infrastructure numbers are used only to apply
 * the canonical live-call safety rule and never leave this server function.
 */
export async function getDashboardCallHandlingForActor(
  actor: ActorContext,
  clinicId: string,
  now: Date,
): Promise<DashboardCallHandlingModel> {
  let canManage = true;
  try {
    // This first proves tenant ownership and clinic:read reach. Only the final
    // clinic:edit refusal becomes a read-only dashboard capability.
    await assertActorCanManageTelephony(actor, clinicId);
  } catch (error: unknown) {
    if (!(error instanceof PermissionError)) throw error;
    canManage = false;
  }

  if (
    canManage &&
    (await moduleLock(actor, MODULE_FEATURES.clinics)) !== null
  ) {
    canManage = false;
  }

  const [stored, hours] = await Promise.all([
    prisma.clinicTelephonyConfig.findUnique({
      where: { clinicId },
      select: {
        enabled: true,
        plivoNumber: true,
        publicPhoneNumber: true,
        receptionPhoneNumber: true,
        timezone: true,
        routingMode: true,
        updatedAt: true,
      },
    }),
    getClinicBusinessHoursForTrustedClinic(clinicId),
  ]);

  const enabled = stored?.enabled ?? false;
  const routingMode =
    stored?.routingMode ?? DEFAULT_CLINIC_TELEPHONY_ROUTING_MODE;
  const businessState = resolveClinicBusinessState({
    now,
    timezone: stored?.timezone ?? DEFAULT_CLINIC_TIMEZONE,
    hours,
  });
  const receptionAvailable = isReceptionDestinationAvailable({
    providerNumber: stored?.plivoNumber ?? null,
    publicPhoneNumber: stored?.publicPhoneNumber ?? null,
    receptionPhoneNumber: stored?.receptionPhoneNumber ?? null,
  });
  const effective = resolveCallHandlingEffectiveState({
    enabled,
    routingMode,
    isOpen: businessState.isOpen,
    hasRegularHours: businessState.hasRegularHours,
    receptionAvailable,
  });

  return Object.freeze({
    clinicId,
    enabled,
    routingMode,
    effectiveRoute: effective.effectiveRoute,
    isOpen: businessState.isOpen,
    hasRegularHours: businessState.hasRegularHours,
    todayHours: businessState.todayHours,
    nextOpening: businessState.nextOpening,
    receptionAvailable,
    canManage,
    updatedAt: stored?.updatedAt.toISOString() ?? null,
  });
}
