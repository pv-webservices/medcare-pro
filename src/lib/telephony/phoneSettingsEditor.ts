import {
  CLINIC_BUSINESS_WEEKDAYS,
  updateClinicBusinessHoursSchema,
  type ClinicBusinessHoursDay,
  type ClinicBusinessWeekday,
  type UpdateClinicBusinessHoursInput,
} from "@/lib/telephony/businessHoursContract";
import {
  clinicPhoneSettingsDraftSchema,
  type ClinicPhoneSettingsView,
  type UpdateClinicPhoneSettingsInput,
} from "@/lib/telephony/clinicPhoneSettingsContract";

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

export function validatePhoneCallSettingsDraft(
  draft: PhoneCallSettingsDraft,
): PhoneSettingsValidation {
  return validationResult(clinicPhoneSettingsDraftSchema.safeParse(draft));
}

export function phoneCallSettingsPayload(
  draft: PhoneCallSettingsDraft,
): UpdateClinicPhoneSettingsInput {
  return clinicPhoneSettingsDraftSchema.parse(draft);
}

export function isPhoneCallSettingsDirty(
  draft: PhoneCallSettingsDraft,
  settings: ClinicPhoneSettingsView,
): boolean {
  const parsed = clinicPhoneSettingsDraftSchema.safeParse(draft);
  if (!parsed.success) return true;
  return (
    JSON.stringify(parsed.data) !==
    JSON.stringify(phoneCallSettingsPayload(phoneSettingsToDraft(settings)))
  );
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

