import {
  CLINIC_BUSINESS_WEEKDAYS,
  updateClinicBusinessHoursSchema,
  type ClinicBusinessHoursDay,
  type ClinicBusinessWeekday,
  type UpdateClinicBusinessHoursInput,
} from "@/lib/telephony/businessHoursContract";
import type {
  ClinicPhoneSettingsView,
  UpdateClinicPhoneSettingsInput,
} from "@/lib/telephony/clinicPhoneSettingsContract";
import { ianaTimezoneSchema } from "@/lib/telephony/phoneNumber";

export interface PhoneCallSettingsDraft {
  publicPhoneNumber: string;
  receptionPhoneNumber: string;
  urgentPhoneNumber: string;
  timezone: string;
}

export interface BusinessHoursDraftDay {
  dayOfWeek: ClinicBusinessWeekday;
  isClosed: boolean;
  openTime: string;
  closeTime: string;
}

export interface PhoneSettingsValidation {
  valid: boolean;
  errors: Readonly<Record<string, string>>;
  formError: string | null;
}

function validationResult(result: {
  success: boolean;
  error?: { issues: readonly { path: PropertyKey[]; message: string }[] };
}): PhoneSettingsValidation {
  if (result.success) return { valid: true, errors: {}, formError: null };
  const errors: Record<string, string> = {};
  let formError: string | null = null;
  for (const issue of result.error?.issues ?? []) {
    const key = issue.path.map(String).join(".");
    if (key === "" || key === "hours") formError ??= issue.message;
    else errors[key] ??= issue.message;
  }
  return { valid: false, errors, formError };
}

export function phoneSettingsToDraft(
  settings: ClinicPhoneSettingsView,
): PhoneCallSettingsDraft {
  return {
    publicPhoneNumber: settings.publicPhoneNumber ?? "",
    receptionPhoneNumber: settings.receptionPhoneNumber ?? "",
    urgentPhoneNumber: settings.urgentPhoneNumber ?? "",
    timezone: settings.timezone,
  };
}

/**
 * Validates a single phone number input for Phone Settings.
 * - Trims accidental spaces before validation.
 * - Allows empty/whitespace (optional field, saved as null).
 * - Allows numbers only, with an optional single leading '+' for international format.
 * - Maximum 13 digits, excluding the '+' sign.
 * - Rejects letters, special characters, multiple '+' signs, decimal values, internal spaces, or malformed numbers.
 * - Returns a clear inline error message or null if valid.
 */
export function validatePhoneSettingValue(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }

  // Must only contain digits and an optional single leading '+'
  // Rejects letters, decimals, symbols, internal spaces, multiple '+' or misplaced '+'
  if (!/^\+?\d+$/.test(trimmed)) {
    return "Enter a valid phone number.";
  }

  const digits = trimmed.startsWith("+") ? trimmed.slice(1) : trimmed;

  if (digits.length > 13) {
    return "Phone number cannot exceed 13 digits.";
  }

  // Minimum digits check for a complete/valid phone number (e.g. 7 digits)
  // International format cannot start with country code '0' (+0...)
  if (digits.length < 7 || (trimmed.startsWith("+") && digits.startsWith("0"))) {
    return "Enter a valid phone number.";
  }

  return null;
}

export function normalizePhoneSettingPayload(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
}

export function validatePhoneCallSettingsDraft(
  draft: PhoneCallSettingsDraft,
): PhoneSettingsValidation {
  const errors: Record<string, string> = {};

  const publicError = validatePhoneSettingValue(draft.publicPhoneNumber);
  if (publicError) errors.publicPhoneNumber = publicError;

  const receptionError = validatePhoneSettingValue(draft.receptionPhoneNumber);
  if (receptionError) errors.receptionPhoneNumber = receptionError;

  const urgentError = validatePhoneSettingValue(draft.urgentPhoneNumber);
  if (urgentError) errors.urgentPhoneNumber = urgentError;

  const timezoneResult = ianaTimezoneSchema.safeParse(draft.timezone);
  if (!timezoneResult.success) {
    errors.timezone =
      timezoneResult.error.issues[0]?.message ?? "Use a valid IANA timezone.";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    formError: null,
  };
}

export function phoneCallSettingsPayload(
  draft: PhoneCallSettingsDraft,
): UpdateClinicPhoneSettingsInput {
  const validation = validatePhoneCallSettingsDraft(draft);
  if (!validation.valid) {
    throw new Error("Cannot serialize invalid phone call settings draft.");
  }
  return {
    publicPhoneNumber: normalizePhoneSettingPayload(draft.publicPhoneNumber),
    receptionPhoneNumber: normalizePhoneSettingPayload(
      draft.receptionPhoneNumber,
    ),
    urgentPhoneNumber: normalizePhoneSettingPayload(draft.urgentPhoneNumber),
    timezone: draft.timezone.trim(),
  };
}

export function isPhoneCallSettingsDirty(
  draft: PhoneCallSettingsDraft,
  settings: ClinicPhoneSettingsView,
): boolean {
  const validation = validatePhoneCallSettingsDraft(draft);
  if (!validation.valid) return true;
  try {
    const currentPayload = phoneCallSettingsPayload(draft);
    const initialPayload = phoneCallSettingsPayload(
      phoneSettingsToDraft(settings),
    );
    return JSON.stringify(currentPayload) !== JSON.stringify(initialPayload);
  } catch {
    return true;
  }
}

export function businessHoursToDraft(
  hours: readonly ClinicBusinessHoursDay[],
): BusinessHoursDraftDay[] {
  const byDay = new Map(hours.map((day) => [day.dayOfWeek, day]));
  return CLINIC_BUSINESS_WEEKDAYS.map((dayOfWeek) => {
    const day = byDay.get(dayOfWeek);
    return {
      dayOfWeek,
      isClosed: day?.isClosed ?? true,
      openTime: day?.openTime ?? "09:00",
      closeTime: day?.closeTime ?? "17:00",
    };
  });
}

export function validateBusinessHoursDraft(
  hours: readonly BusinessHoursDraftDay[],
): PhoneSettingsValidation {
  return validationResult(updateClinicBusinessHoursSchema.safeParse({ hours }));
}

export function businessHoursPayload(
  hours: readonly BusinessHoursDraftDay[],
): UpdateClinicBusinessHoursInput {
  return updateClinicBusinessHoursSchema.parse({ hours });
}

export function isBusinessHoursDirty(
  draft: readonly BusinessHoursDraftDay[],
  canonical: readonly ClinicBusinessHoursDay[],
): boolean {
  const parsed = updateClinicBusinessHoursSchema.safeParse({ hours: draft });
  if (!parsed.success) return true;
  return (
    JSON.stringify(parsed.data.hours) !==
    JSON.stringify(
      businessHoursPayload(businessHoursToDraft(canonical)).hours,
    )
  );
}

export function updateBusinessHoursDay(
  hours: readonly BusinessHoursDraftDay[],
  dayOfWeek: ClinicBusinessWeekday,
  patch: Partial<Omit<BusinessHoursDraftDay, "dayOfWeek">>,
): BusinessHoursDraftDay[] {
  return hours.map((day) =>
    day.dayOfWeek === dayOfWeek ? { ...day, ...patch } : { ...day },
  );
}

export function copyMondayToWeekdays(
  hours: readonly BusinessHoursDraftDay[],
): BusinessHoursDraftDay[] {
  const monday = hours.find((day) => day.dayOfWeek === "MONDAY");
  if (!monday) return [...hours];
  const weekdays = new Set<ClinicBusinessWeekday>([
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
  ]);
  return hours.map((day) =>
    weekdays.has(day.dayOfWeek)
      ? {
          ...day,
          isClosed: monday.isClosed,
          openTime: monday.openTime,
          closeTime: monday.closeTime,
        }
      : { ...day },
  );
}

