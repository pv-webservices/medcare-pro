"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  Clock3,
  PhoneForwarded,
  PhoneIncoming,
  PhoneCall,
  Save,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { cx } from "@/components/ui/cx";
import type {
  ClinicBusinessHoursDay,
  ClinicBusinessWeekday,
} from "@/lib/telephony/businessHoursContract";
import type {
  ClinicPhoneSettingsView,
} from "@/lib/telephony/clinicPhoneSettingsContract";
import {
  businessHoursPayload,
  businessHoursToDraft,
  copyMondayToWeekdays,
  isBusinessHoursDirty,
  isPhoneCallSettingsDirty,
  phoneCallSettingsPayload,
  phoneSettingsToDraft,
  updateBusinessHoursDay,
  validateBusinessHoursDraft,
  validatePhoneCallSettingsDraft,
  type BusinessHoursDraftDay,
  type PhoneCallSettingsDraft,
} from "@/lib/telephony/phoneSettingsEditor";
import type { ApiResponse } from "@/lib/utils";

interface PhoneSettingsEditorProps {
  clinicId: string;
  clinicName: string;
  initialSettings: ClinicPhoneSettingsView;
  initialHours: readonly ClinicBusinessHoursDay[];
  timezoneOptions: readonly string[];
}

const DAY_LABELS: Record<ClinicBusinessWeekday, string> = {
  MONDAY: "Monday",
  TUESDAY: "Tuesday",
  WEDNESDAY: "Wednesday",
  THURSDAY: "Thursday",
  FRIDAY: "Friday",
  SATURDAY: "Saturday",
  SUNDAY: "Sunday",
};

function apiErrorMessage(status: number, fallback?: string): string {
  if (status === 400) {
    return fallback ?? "Check the highlighted phone settings.";
  }
  if (status === 403) {
    return "You don't have permission to change this clinic's phone settings.";
  }
  return fallback ?? "Phone settings could not be saved. Try again.";
}

async function readApiResponse<T>(response: Response): Promise<ApiResponse<T>> {
  return (await response.json()) as ApiResponse<T>;
}

export default function PhoneSettingsEditor({
  clinicId,
  clinicName,
  initialSettings,
  initialHours,
  timezoneOptions,
}: PhoneSettingsEditorProps) {
  const router = useRouter();
  const showToast = useToast();
  const [settings, setSettings] = useState(initialSettings);
  const [callDraft, setCallDraft] = useState<PhoneCallSettingsDraft>(() =>
    phoneSettingsToDraft(initialSettings),
  );
  const [hours, setHours] = useState<readonly ClinicBusinessHoursDay[]>(
    initialHours,
  );
  const [hoursDraft, setHoursDraft] = useState<BusinessHoursDraftDay[]>(() =>
    businessHoursToDraft(initialHours),
  );
  const [pending, setPending] = useState<"call" | "hours" | null>(null);
  const callValidation = useMemo(
    () => validatePhoneCallSettingsDraft(callDraft),
    [callDraft],
  );
  const hoursValidation = useMemo(
    () => validateBusinessHoursDraft(hoursDraft),
    [hoursDraft],
  );
  const callDirty = isPhoneCallSettingsDirty(callDraft, settings);
  const hoursDirty = isBusinessHoursDirty(hoursDraft, hours);

  function changeCallField(field: keyof PhoneCallSettingsDraft, value: string) {
    setCallDraft((current) => ({ ...current, [field]: value }));
  }

  async function saveCallSettings() {
    if (pending !== null || !callDirty || !callValidation.valid) return;
    const payload = phoneCallSettingsPayload(callDraft);
    setPending("call");
    try {
      const response = await fetch(
        `/api/clinics/${encodeURIComponent(clinicId)}/telephony/settings`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            publicPhoneNumber: payload.publicPhoneNumber,
            receptionPhoneNumber: payload.receptionPhoneNumber,
            urgentPhoneNumber: payload.urgentPhoneNumber,
            timezone: payload.timezone,
          }),
        },
      );
      const body = await readApiResponse<ClinicPhoneSettingsView>(response);
      if (!response.ok || !body.success || !body.data) {
        showToast({
          tone: "alert",
          title: "Call settings not saved",
          detail: apiErrorMessage(response.status, body.error),
        });
        return;
      }
      setSettings(body.data);
      setCallDraft(phoneSettingsToDraft(body.data));
      showToast({ tone: "ok", title: "Call settings saved." });
      router.refresh();
    } catch {
      showToast({
        tone: "alert",
        title: "Call settings not saved",
        detail: "Check your connection and try again. Your changes are still here.",
      });
    } finally {
      setPending(null);
    }
  }

  async function refreshReadiness() {
    const response = await fetch(
      `/api/clinics/${encodeURIComponent(clinicId)}/telephony/settings`,
      { method: "GET" },
    );
    const body = await readApiResponse<ClinicPhoneSettingsView>(response);
    if (response.ok && body.success && body.data) setSettings(body.data);
  }

  async function saveBusinessHours() {
    if (pending !== null || !hoursDirty || !hoursValidation.valid) return;
    const payload = businessHoursPayload(hoursDraft);
    setPending("hours");
    try {
      const response = await fetch(
        `/api/clinics/${encodeURIComponent(clinicId)}/telephony/hours`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hours: payload.hours }),
        },
      );
      const body = await readApiResponse<{
        clinicId: string;
        hours: readonly ClinicBusinessHoursDay[];
      }>(response);
      if (!response.ok || !body.success || !body.data) {
        showToast({
          tone: "alert",
          title: "Business hours not saved",
          detail: apiErrorMessage(response.status, body.error),
        });
        return;
      }
      setHours(body.data.hours);
      setHoursDraft(businessHoursToDraft(body.data.hours));
      await refreshReadiness().catch(() => undefined);
      showToast({ tone: "ok", title: "Business hours saved." });
      router.refresh();
    } catch {
      showToast({
        tone: "alert",
        title: "Business hours not saved",
        detail: "Check your connection and try again. Your schedule is still here.",
      });
    } finally {
      setPending(null);
    }
  }

  return (
    <div aria-busy={pending !== null || undefined} className="space-y-5">
      {/* 1. Call destinations & Business hours (Two-Column Balanced Grid) */}
      <div className="grid min-w-0 gap-5 lg:grid-cols-12 lg:items-start">
        {/* Call Destinations Card (~45%, lg:col-span-5) */}
        <section className="rounded-2xl border border-slate-200/90 bg-white p-5 sm:p-6 shadow-card space-y-5 lg:col-span-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm sm:text-base font-bold text-slate-900 tracking-tight">
                Call destinations
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Operational contact numbers for {clinicName}.
              </p>
            </div>
            <span
              className={cx(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                callDirty
                  ? "border border-amber-200/80 bg-amber-50 text-amber-700"
                  : "border border-emerald-200/80 bg-emerald-50 text-emerald-700",
              )}
            >
              <span
                className={cx(
                  "h-1.5 w-1.5 rounded-full",
                  callDirty ? "bg-amber-500" : "bg-emerald-500",
                )}
              />
              {callDirty ? "Unsaved" : "Saved"}
            </span>
          </div>

          {/* Form Fields */}
          <div className="space-y-4">
            {/* Field 1: Clinic public phone */}
            <div className="space-y-1">
              <label
                htmlFor="clinic-public-phone"
                className="block text-xs font-semibold text-slate-700"
              >
                Clinic public phone
              </label>
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50/80 text-indigo-600">
                  <PhoneCall className="h-4 w-4" />
                </div>
                <input
                  id="clinic-public-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+919876543210"
                  maxLength={
                    callDraft.publicPhoneNumber.startsWith("+") ? 14 : 13
                  }
                  value={callDraft.publicPhoneNumber}
                  disabled={pending !== null}
                  aria-invalid={
                    callValidation.errors.publicPhoneNumber ? true : undefined
                  }
                  onChange={(event) =>
                    changeCallField("publicPhoneNumber", event.target.value)
                  }
                  className={cx(
                    "h-9 w-full rounded-xl border bg-white px-3 text-xs sm:text-sm text-slate-900 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/30",
                    callValidation.errors.publicPhoneNumber
                      ? "border-rose-400"
                      : "border-slate-200",
                  )}
                />
              </div>
              <p className="text-[11px] text-slate-500 pl-11.5">
                The clinic&apos;s normal public contact number. Use international format.
              </p>
              {callValidation.errors.publicPhoneNumber && (
                <p className="text-[11px] text-rose-600 pl-11.5">
                  {callValidation.errors.publicPhoneNumber}
                </p>
              )}
            </div>

            {/* Field 2: Reception phone */}
            <div className="space-y-1">
              <label
                htmlFor="clinic-reception-phone"
                className="block text-xs font-semibold text-slate-700"
              >
                Reception phone
              </label>
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50/80 text-indigo-600">
                  <Users className="h-4 w-4" />
                </div>
                <input
                  id="clinic-reception-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+919876543210"
                  maxLength={
                    callDraft.receptionPhoneNumber.startsWith("+") ? 14 : 13
                  }
                  value={callDraft.receptionPhoneNumber}
                  disabled={pending !== null}
                  aria-invalid={
                    callValidation.errors.receptionPhoneNumber ? true : undefined
                  }
                  onChange={(event) =>
                    changeCallField("receptionPhoneNumber", event.target.value)
                  }
                  className={cx(
                    "h-9 w-full rounded-xl border bg-white px-3 text-xs sm:text-sm text-slate-900 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/30",
                    callValidation.errors.receptionPhoneNumber
                      ? "border-rose-400"
                      : "border-slate-200",
                  )}
                />
              </div>
              <p className="text-[11px] text-slate-500 pl-11.5">
                Calls routed to Reception are connected here.
              </p>
              {callValidation.errors.receptionPhoneNumber && (
                <p className="text-[11px] text-rose-600 pl-11.5">
                  {callValidation.errors.receptionPhoneNumber}
                </p>
              )}
            </div>

            {/* Field 3: Urgent phone */}
            <div className="space-y-1">
              <label
                htmlFor="clinic-urgent-phone"
                className="block text-xs font-semibold text-slate-700"
              >
                Urgent phone
              </label>
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50/80 text-indigo-600">
                  <AlertTriangle className="h-4 w-4" />
                </div>
                <input
                  id="clinic-urgent-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+919876543210"
                  maxLength={
                    callDraft.urgentPhoneNumber.startsWith("+") ? 14 : 13
                  }
                  value={callDraft.urgentPhoneNumber}
                  disabled={pending !== null}
                  aria-invalid={
                    callValidation.errors.urgentPhoneNumber ? true : undefined
                  }
                  onChange={(event) =>
                    changeCallField("urgentPhoneNumber", event.target.value)
                  }
                  className={cx(
                    "h-9 w-full rounded-xl border bg-white px-3 text-xs sm:text-sm text-slate-900 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/30",
                    callValidation.errors.urgentPhoneNumber
                      ? "border-rose-400"
                      : "border-slate-200",
                  )}
                />
              </div>
              <p className="text-[11px] text-slate-500 pl-11.5">
                Confirmed urgent-assistance calls are connected here.
              </p>
              {callValidation.errors.urgentPhoneNumber && (
                <p className="text-[11px] text-rose-600 pl-11.5">
                  {callValidation.errors.urgentPhoneNumber}
                </p>
              )}
            </div>

            {/* Field 4: Timezone */}
            <div className="space-y-1">
              <label
                htmlFor="clinic-phone-timezone"
                className="block text-xs font-semibold text-slate-700"
              >
                Timezone
              </label>
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50/80 text-indigo-600">
                  <Clock3 className="h-4 w-4" />
                </div>
                <div className="relative w-full">
                  <input
                    id="clinic-phone-timezone"
                    list="clinic-phone-timezone-options"
                    value={callDraft.timezone}
                    disabled={pending !== null}
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={
                      callValidation.errors.timezone ? true : undefined
                    }
                    onChange={(event) =>
                      changeCallField("timezone", event.target.value)
                    }
                    className={cx(
                      "h-9 w-full rounded-xl border bg-white px-3 text-xs sm:text-sm text-slate-900 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/30",
                      callValidation.errors.timezone
                        ? "border-rose-400"
                        : "border-slate-200",
                    )}
                  />
                  <datalist id="clinic-phone-timezone-options">
                    {timezoneOptions.map((timezone) => (
                      <option key={timezone} value={timezone} />
                    ))}
                  </datalist>
                </div>
              </div>
              <p className="text-[11px] text-slate-500 pl-11.5">
                Automatic call routing evaluates business hours in this timezone.
              </p>
              {callValidation.errors.timezone && (
                <p className="text-[11px] text-rose-600 pl-11.5">
                  {callValidation.errors.timezone}
                </p>
              )}
            </div>
          </div>

          {/* Routing Summary */}
          <div className="rounded-xl border border-indigo-100/90 bg-gradient-to-br from-indigo-50/60 via-purple-50/30 to-slate-50/40 p-3.5 space-y-2">
            <div>
              <h3 className="text-xs font-bold text-slate-900">
                Routing summary
              </h3>
              <p className="text-[11px] text-slate-600 mt-0.5 leading-normal">
                {settings.effectiveRoute === "IVR"
                  ? "Phone menu is active. Calls are routed based on business hours and caller selection."
                  : "Reception is active. Calls are routed directly to reception during hours."}
              </p>
            </div>

            {/* 4-Step Flow Tile Diagram */}
            <div className="grid grid-cols-4 items-center gap-1 pt-1.5">
              {/* Step 1 */}
              <div className="flex flex-col items-center justify-center p-2 rounded-lg bg-white border border-indigo-100/80 shadow-2xs text-center min-h-[58px]">
                <PhoneIncoming className="h-3.5 w-3.5 text-indigo-600 mb-1" />
                <span className="text-[9px] text-slate-600 font-medium leading-tight">
                  Caller dials clinic number
                </span>
              </div>

              {/* Step 2 */}
              <div className="flex flex-col items-center justify-center p-2 rounded-lg bg-white border border-indigo-100/80 shadow-2xs text-center min-h-[58px]">
                <PhoneCall className="h-3.5 w-3.5 text-indigo-600 mb-1" />
                <span className="text-[9px] text-slate-600 font-medium leading-tight">
                  IVR / Phone menu
                </span>
              </div>

              {/* Step 3 */}
              <div className="flex flex-col items-center justify-center p-2 rounded-lg bg-white border border-indigo-100/80 shadow-2xs text-center min-h-[58px]">
                <Clock3 className="h-3.5 w-3.5 text-indigo-600 mb-1" />
                <span className="text-[9px] text-slate-600 font-medium leading-tight">
                  Business hours or selection
                </span>
              </div>

              {/* Step 4 */}
              <div className="flex flex-col items-center justify-center p-2 rounded-lg bg-white border border-indigo-100/80 shadow-2xs text-center min-h-[58px]">
                <PhoneForwarded className="h-3.5 w-3.5 text-indigo-600 mb-1" />
                <span className="text-[9px] text-slate-600 font-medium leading-tight">
                  Routed to target number
                </span>
              </div>
            </div>
          </div>

          {callValidation.formError && (
            <p
              role="alert"
              className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
            >
              {callValidation.formError}
            </p>
          )}

          {/* Action Row */}
          <div className="flex justify-end pt-2 border-t border-slate-100">
            <button
              type="button"
              disabled={!callDirty || !callValidation.valid || pending !== null}
              onClick={saveCallSettings}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:from-indigo-700 hover:to-purple-700 active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save className="h-3.5 w-3.5" />
              <span>{pending === "call" ? "Saving…" : "Save call settings"}</span>
            </button>
          </div>
        </section>

        {/* Business Hours Card (~55%, lg:col-span-7) */}
        <section className="rounded-2xl border border-slate-200/90 bg-white p-5 sm:p-6 shadow-card space-y-4 lg:col-span-7">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm sm:text-base font-bold text-slate-900 tracking-tight">
                Business hours
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                The regular weekly schedule used when call handling is Automatic.
              </p>
            </div>
            <span
              className={cx(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                hoursDirty
                  ? "border border-amber-200/80 bg-amber-50 text-amber-700"
                  : "border border-emerald-200/80 bg-emerald-50 text-emerald-700",
              )}
            >
              <span
                className={cx(
                  "h-1.5 w-1.5 rounded-full",
                  hoursDirty ? "bg-amber-500" : "bg-emerald-500",
                )}
              />
              {hoursDirty ? "Unsaved" : "Saved"}
            </span>
          </div>

          {/* Utility Row */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl bg-slate-50/80 border border-slate-100 p-2.5">
            <p className="text-[11px] text-slate-500 leading-normal">
              No overnight schedules. Closing time must be later than opening time.
            </p>
            <button
              type="button"
              disabled={pending !== null}
              onClick={() =>
                setHoursDraft((current) => copyMondayToWeekdays(current))
              }
              className="rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-[11px] font-semibold px-2.5 py-1 shadow-xs transition-colors shrink-0"
            >
              Copy Monday to weekdays
            </button>
          </div>

          {/* Schedule Table */}
          <div className="space-y-2">
            {/* Table Header */}
            <div className="grid grid-cols-12 gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-100 pb-2 px-1">
              <div className="col-span-3">Day</div>
              <div className="col-span-3">Status</div>
              <div className="col-span-3">Open time</div>
              <div className="col-span-3">Close time</div>
            </div>

            {/* Day Rows */}
            <div className="divide-y divide-slate-100">
              {hoursDraft.map((day, index) => {
                const openError =
                  hoursValidation.errors[`hours.${index}.openTime`];
                const closeError =
                  hoursValidation.errors[`hours.${index}.closeTime`];

                return (
                  <div
                    key={day.dayOfWeek}
                    className="grid grid-cols-12 gap-2 items-center py-2.5 px-1"
                  >
                    {/* Day Name */}
                    <div className="col-span-3">
                      <span className="text-xs font-semibold text-slate-800">
                        {DAY_LABELS[day.dayOfWeek]}
                      </span>
                    </div>

                    {/* Status Toggle label="Closed" */}
                    <div className="col-span-3 flex items-center gap-2">
                      <button
                        type="button"
                        role="switch"
                        id={`phone-hours-closed-${day.dayOfWeek}`}
                        aria-checked={!day.isClosed}
                        aria-label={day.isClosed ? "Closed" : "Open"}
                        disabled={pending !== null}
                        onClick={() =>
                          setHoursDraft((current) =>
                            updateBusinessHoursDay(current, day.dayOfWeek, {
                              isClosed: !day.isClosed,
                            }),
                          )
                        }
                        className={cx(
                          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:ring-offset-2",
                          !day.isClosed ? "bg-indigo-600" : "bg-slate-200",
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={cx(
                            "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                            !day.isClosed ? "translate-x-4" : "translate-x-0",
                          )}
                        />
                      </button>
                      <span
                        className={cx(
                          "text-xs font-medium",
                          !day.isClosed ? "text-slate-700" : "text-slate-400",
                        )}
                      >
                        {!day.isClosed ? "Open" : "Closed"}
                      </span>
                    </div>

                    {/* Open Time Input */}
                    <div className="col-span-3">
                      <input
                        type="time"
                        value={day.openTime}
                        disabled={day.isClosed || pending !== null}
                        aria-label={`${DAY_LABELS[day.dayOfWeek]} open time`}
                        onChange={(event) =>
                          setHoursDraft((current) =>
                            updateBusinessHoursDay(current, day.dayOfWeek, {
                              openTime: event.target.value,
                            }),
                          )
                        }
                        className={cx(
                          "w-full h-8 rounded-lg border px-2 text-xs transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/30",
                          openError
                            ? "border-rose-400 text-rose-700 bg-rose-50/50"
                            : day.isClosed
                              ? "border-slate-200/60 bg-slate-50 text-slate-400 opacity-60 cursor-not-allowed"
                              : "border-slate-200 bg-white text-slate-800",
                        )}
                      />
                    </div>

                    {/* Close Time Input */}
                    <div className="col-span-3">
                      <input
                        type="time"
                        value={day.closeTime}
                        disabled={day.isClosed || pending !== null}
                        aria-label={`${DAY_LABELS[day.dayOfWeek]} close time`}
                        onChange={(event) =>
                          setHoursDraft((current) =>
                            updateBusinessHoursDay(current, day.dayOfWeek, {
                              closeTime: event.target.value,
                            }),
                          )
                        }
                        className={cx(
                          "w-full h-8 rounded-lg border px-2 text-xs transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/30",
                          closeError
                            ? "border-rose-400 text-rose-700 bg-rose-50/50"
                            : day.isClosed
                              ? "border-slate-200/60 bg-slate-50 text-slate-400 opacity-60 cursor-not-allowed"
                              : "border-slate-200 bg-white text-slate-800",
                        )}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {hoursValidation.formError && (
            <p
              role="alert"
              className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
            >
              {hoursValidation.formError}
            </p>
          )}

          {/* Action Row */}
          <div className="flex justify-end pt-2 border-t border-slate-100">
            <button
              type="button"
              disabled={!hoursDirty || !hoursValidation.valid || pending !== null}
              onClick={saveBusinessHours}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:from-indigo-700 hover:to-purple-700 active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <CalendarDays className="h-3.5 w-3.5" />
              <span>
                {pending === "hours" ? "Saving…" : "Save business hours"}
              </span>
            </button>
          </div>
        </section>
      </div>

      {/* 2. Related Controls Card */}
      <section className="rounded-2xl border border-slate-200/90 bg-white p-5 sm:p-6 shadow-card space-y-4">
        <div>
          <h2 className="text-sm sm:text-base font-bold text-slate-900 tracking-tight">
            Related controls
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Phone content and live routing stay in their dedicated screens.
          </p>
        </div>

        {/* 2 Equal Action Tiles */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Tile 1: Configure phone menu */}
          <Link
            href="/settings/phone-menu"
            className="group flex items-center justify-between gap-3 p-4 rounded-xl border border-slate-200/80 bg-slate-50/50 hover:bg-white hover:border-indigo-300 hover:shadow-md transition-all"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50/80 text-indigo-600">
                <PhoneCall className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0">
                <span className="block text-xs sm:text-sm font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">
                  Configure phone menu
                </span>
                <span className="block text-xs text-slate-500 mt-0.5">
                  Edit IVR prompts, options, and destination mapping.
                </span>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-indigo-600 group-hover:translate-x-0.5 transition-all shrink-0" />
          </Link>

          {/* Tile 2: IVR workspace */}
          <Link
            href="/ivr"
            className="group flex items-center justify-between gap-3 p-4 rounded-xl border border-slate-200/80 bg-slate-50/50 hover:bg-white hover:border-indigo-300 hover:shadow-md transition-all"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50/80 text-indigo-600">
                <Clock3 className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0">
                <span className="block text-xs sm:text-sm font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">
                  Open IVR workspace
                </span>
                <span className="block text-xs text-slate-500 mt-0.5">
                  Monitor calls, readiness, follow-ups and diagnostics.
                </span>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-indigo-600 group-hover:translate-x-0.5 transition-all shrink-0" />
          </Link>
        </div>

        {/* Informational QA Note */}
        <div className="flex items-start gap-2 text-xs text-slate-500 pt-1">
          <ShieldCheck className="h-4 w-4 text-indigo-600 shrink-0 mt-0.5" />
          <span>
            Controlled menu tests use only the deployment-approved QA number and
            never book appointments or transfer callers.
          </span>
        </div>
      </section>

    </div>
  );
}
