import { BadRequestError } from "@/lib/apiHandler";
import type { ActorContext } from "@/lib/rbac";
import { getClinicBusinessHoursForActor } from "@/lib/telephony/businessHours";
import {
  type ClinicPhoneSettingsView,
  type UpdateClinicPhoneSettingsInput,
} from "@/lib/telephony/clinicPhoneSettingsContract";
import {
  type ClinicTelephonyConfigView,
  getClinicTelephonyConfigForActor,
  updateClinicTelephonyConfigForActor,
} from "@/lib/telephony/clinicConfig";
import {
  getClinicIvrProfileForActor,
  type ClinicIvrProfileView,
} from "@/lib/telephony/ivrProfile";
import {
  DEFAULT_CLINIC_IVR_ITEMS,
  replaceClinicIvrProfileSchema,
} from "@/lib/telephony/ivrProfileContract";
import { deriveClinicPhoneReadiness } from "@/lib/telephony/phoneReadiness";
import type { ClinicBusinessHoursView } from "@/lib/telephony/businessHours";

function assertNoTransferLoop(input: {
  label: "Reception" | "Urgent";
  destination: string | null;
  publicPhoneNumber: string | null;
  providerNumber: string | null;
}): void {
  if (
    input.destination !== null &&
    (input.destination === input.publicPhoneNumber ||
      input.destination === input.providerNumber)
  ) {
    throw new BadRequestError(
      `${input.label} cannot use this number because it conflicts with the clinic's phone routing setup.`,
    );
  }
}

function toClinicPhoneSettingsView(input: {
  config: ClinicTelephonyConfigView;
  businessHours: ClinicBusinessHoursView;
  profile: ClinicIvrProfileView;
  now: Date;
}): ClinicPhoneSettingsView {
  const { config, businessHours, profile } = input;
  const validatedCustom =
    profile.source === "custom"
      ? replaceClinicIvrProfileSchema.safeParse({
          greetingTemplate: profile.greetingTemplate,
          language: profile.language,
          voice: profile.voice,
          items: profile.items,
        })
      : null;
  // Match the runtime's deterministic fallback: malformed custom data behaves
  // as the default menu for readiness instead of hiding a live default action.
  const effectiveItems =
    validatedCustom?.success === true
      ? validatedCustom.data.items
      : DEFAULT_CLINIC_IVR_ITEMS;
  const phoneMenuSource =
    validatedCustom?.success === true ? "custom" : "default";
  const urgentActionEnabled = effectiveItems.some(
    (item) => item.enabled && item.action === "URGENT_ASSISTANCE",
  );
  const derived = deriveClinicPhoneReadiness({
    enabled: config.enabled,
    providerNumber: config.plivoNumber,
    routingMode: config.routingMode,
    publicPhoneNumber: config.publicPhoneNumber,
    receptionPhoneNumber: config.receptionPhoneNumber,
    urgentPhoneNumber: config.urgentPhoneNumber,
    timezone: config.timezone,
    hours: businessHours.hours,
    phoneMenuSource,
    urgentActionEnabled,
    now: input.now,
  });

  return Object.freeze({
    clinicId: config.clinicId,
    serviceStatus: derived.serviceStatus,
    routingMode: config.routingMode,
    effectiveRoute: derived.effectiveRoute,
    publicPhoneNumber: config.publicPhoneNumber,
    receptionPhoneNumber: config.receptionPhoneNumber,
    urgentPhoneNumber: config.urgentPhoneNumber,
    timezone: config.timezone,
    phoneMenuSource,
    readiness: derived.readiness,
  });
}

/** Sanitizes the infrastructure-aware server state into the clinic-facing model. */
export async function getClinicPhoneSettingsForActor(
  actor: ActorContext,
  clinicId: string,
  now = new Date(),
): Promise<ClinicPhoneSettingsView> {
  const [config, businessHours, profile] = await Promise.all([
    getClinicTelephonyConfigForActor(actor, clinicId),
    getClinicBusinessHoursForActor(actor, clinicId),
    getClinicIvrProfileForActor(actor, clinicId),
  ]);
  return toClinicPhoneSettingsView({ config, businessHours, profile, now });
}

export async function updateClinicPhoneSettingsForActor(
  actor: ActorContext,
  clinicId: string,
  input: UpdateClinicPhoneSettingsInput,
): Promise<ClinicPhoneSettingsView> {
  // The raw provider value stays inside this server service and exists only to
  // enforce the same anti-loop rules as live transfer routing.
  const [current, businessHours, profile] = await Promise.all([
    getClinicTelephonyConfigForActor(actor, clinicId),
    getClinicBusinessHoursForActor(actor, clinicId),
    getClinicIvrProfileForActor(actor, clinicId),
  ]);
  const publicPhoneNumber =
    input.publicPhoneNumber === undefined
      ? current.publicPhoneNumber
      : input.publicPhoneNumber;
  const receptionPhoneNumber =
    input.receptionPhoneNumber === undefined
      ? current.receptionPhoneNumber
      : input.receptionPhoneNumber;
  const urgentPhoneNumber =
    input.urgentPhoneNumber === undefined
      ? current.urgentPhoneNumber
      : input.urgentPhoneNumber;

  assertNoTransferLoop({
    label: "Reception",
    destination: receptionPhoneNumber,
    publicPhoneNumber,
    providerNumber: current.plivoNumber,
  });
  assertNoTransferLoop({
    label: "Urgent",
    destination: urgentPhoneNumber,
    publicPhoneNumber,
    providerNumber: current.plivoNumber,
  });

  let config: ClinicTelephonyConfigView;
  try {
    config = await updateClinicTelephonyConfigForActor(actor, clinicId, input);
  } catch (error: unknown) {
    if (error instanceof BadRequestError) {
      throw new BadRequestError(
        "A call destination conflicts with the clinic's phone routing setup.",
      );
    }
    throw error;
  }
  return toClinicPhoneSettingsView({
    config,
    businessHours,
    profile,
    now: new Date(),
  });
}
