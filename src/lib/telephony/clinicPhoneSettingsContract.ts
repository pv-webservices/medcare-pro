import { z } from "zod";
import {
  ianaTimezoneSchema,
  optionalConfiguredPhoneNumberSchema,
} from "@/lib/telephony/phoneNumber";

export const CLINIC_PHONE_ROUTING_MODES = [
  "AUTO",
  "OPEN",
  "AFTER_HOURS",
] as const;
export type ClinicPhoneRoutingMode =
  (typeof CLINIC_PHONE_ROUTING_MODES)[number];

const clinicPhoneSettingsFields = {
  publicPhoneNumber: optionalConfiguredPhoneNumberSchema,
  receptionPhoneNumber: optionalConfiguredPhoneNumberSchema,
  urgentPhoneNumber: optionalConfiguredPhoneNumberSchema,
  timezone: ianaTimezoneSchema,
};

/** The complete editable call-settings form. */
export const clinicPhoneSettingsDraftSchema = z
  .object(clinicPhoneSettingsFields)
  .strict();

/** Strict clinic-facing PATCH contract: no infrastructure or routing fields. */
export const updateClinicPhoneSettingsSchema = z
  .object(clinicPhoneSettingsFields)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "No changes submitted.",
  });

export type ClinicPhoneSettingsDraftInput = z.input<
  typeof clinicPhoneSettingsDraftSchema
>;
export type ClinicPhoneSettingsDraft = z.output<
  typeof clinicPhoneSettingsDraftSchema
>;
export type UpdateClinicPhoneSettingsInput = z.output<
  typeof updateClinicPhoneSettingsSchema
>;

export type PhoneServiceStatus = "active" | "not-provisioned" | "disabled";
export type PhoneReadinessStatus = "ready" | "attention" | "inactive";

export interface PhoneReadinessCheck {
  status: PhoneReadinessStatus;
  label: string;
  detail: string;
}

export interface ClinicPhoneReadiness {
  status: PhoneReadinessStatus;
  phoneService: PhoneReadinessCheck;
  automaticHours: PhoneReadinessCheck;
  reception: PhoneReadinessCheck;
  urgentTransfer: PhoneReadinessCheck;
  phoneMenu: PhoneReadinessCheck;
}

export interface ClinicPhoneSettingsView {
  clinicId: string;
  serviceStatus: PhoneServiceStatus;
  routingMode: ClinicPhoneRoutingMode;
  effectiveRoute: "RECEPTION" | "IVR" | null;
  publicPhoneNumber: string | null;
  receptionPhoneNumber: string | null;
  urgentPhoneNumber: string | null;
  timezone: string;
  phoneMenuSource: "default" | "custom";
  readiness: ClinicPhoneReadiness;
}

