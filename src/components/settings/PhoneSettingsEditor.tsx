"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  CalendarDays,
  CheckCircle2,
  Clock3,
  PhoneForwarded,
  PhoneCall,
  Save,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import Button, { buttonClasses } from "@/components/ui/Button";
import Input, { controlClasses, FieldShell } from "@/components/ui/Input";
import Panel from "@/components/ui/Panel";
import { ConfirmDialog } from "@/components/ui/Modal";
import StatusPill, { type StatusTone } from "@/components/ui/StatusPill";
import Toggle from "@/components/ui/Toggle";
import { useToast } from "@/components/ui/Toast";
import { cx } from "@/components/ui/cx";
import type {
  ClinicBusinessHoursDay,
  ClinicBusinessWeekday,
} from "@/lib/telephony/businessHoursContract";
import type {
  ClinicPhoneReadiness,
  ClinicPhoneSettingsView,
  PhoneReadinessCheck,
  PhoneReadinessStatus,
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
import {
  isActiveTelephonyTestCallStatus,
  type TelephonyTestCallPanelView,
  type TelephonyTestCallStatus,
  type TelephonyTestCallView,
} from "@/lib/telephony/testCallContract";

interface PhoneSettingsEditorProps {
  clinicId: string;
  clinicName: string;
  initialSettings: ClinicPhoneSettingsView;
  initialHours: readonly ClinicBusinessHoursDay[];
  initialTestCall: TelephonyTestCallPanelView;
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

const ROUTING_LABELS = {
  AUTO: "Automatic",
  OPEN: "Reception",
  AFTER_HOURS: "Phone menu",
} as const;

const TEST_STATUS_LABELS: Record<TelephonyTestCallStatus, string> = {
  REQUESTED: "Starting…",
  RINGING: "Ringing…",
  ANSWERED: "Answered…",
  COMPLETED: "Completed",
  FAILED: "Failed",
};

function testStatusTone(status: TelephonyTestCallStatus): StatusTone {
  if (status === "COMPLETED") return "ok";
  if (status === "FAILED") return "alert";
  return "warn";
}

function statusPresentation(status: PhoneReadinessStatus): {
  label: string;
  tone: StatusTone;
  icon: typeof CheckCircle2;
} {
  if (status === "ready") {
    return { label: "Ready", tone: "ok", icon: CheckCircle2 };
  }
  if (status === "attention") {
    return { label: "Needs attention", tone: "warn", icon: AlertTriangle };
  }
  return { label: "Inactive", tone: "neutral", icon: Ban };
}

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

function ReadinessItem({ check }: { check: PhoneReadinessCheck }) {
  const presentation = statusPresentation(check.status);
  const Icon = presentation.icon;
  return (
    <li className="flex min-w-0 items-start gap-3 rounded-2xl border border-line bg-canvas px-4 py-3.5">
      <span
        aria-hidden="true"
        className={cx(
          "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
          check.status === "ready"
            ? "bg-ok-bg text-ok-mark"
            : check.status === "attention"
              ? "bg-warn-bg text-warn-mark"
              : "bg-canvas-deep text-muted",
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-label font-semibold text-ink">{check.label}</p>
          <StatusPill tone={presentation.tone}>{presentation.label}</StatusPill>
        </div>
        <p className="mt-1 text-meta leading-relaxed text-muted">{check.detail}</p>
      </div>
    </li>
  );
}

function ReadinessOverview({
  readiness,
  routingMode,
  effectiveRoute,
}: {
  readiness: ClinicPhoneReadiness;
  routingMode: ClinicPhoneSettingsView["routingMode"];
  effectiveRoute: ClinicPhoneSettingsView["effectiveRoute"];
}) {
  const presentation = statusPresentation(readiness.status);
  const checks = [
    readiness.phoneService,
    readiness.automaticHours,
    readiness.reception,
    readiness.urgentTransfer,
    readiness.phoneMenu,
  ];
  return (
    <Panel
      title="Phone readiness"
      description="A server-checked view of the details that affect incoming call routing."
      actions={
        <StatusPill tone={presentation.tone}>{presentation.label}</StatusPill>
      }
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-line bg-canvas-deep px-4 py-3">
          <p className="text-meta font-medium text-muted">Call handling</p>
          <p className="mt-1 text-body font-semibold text-ink">
            {ROUTING_LABELS[routingMode]}
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-canvas-deep px-4 py-3">
          <p className="text-meta font-medium text-muted">Current destination</p>
          <p className="mt-1 text-body font-semibold text-ink">
            {effectiveRoute === "RECEPTION"
              ? "Reception"
              : effectiveRoute === "IVR"
                ? "Phone menu"
                : "Inactive"}
          </p>
        </div>
      </div>
      <ul className="grid gap-3 lg:grid-cols-2">{checks.map((check) => <ReadinessItem key={check.label} check={check} />)}</ul>
    </Panel>
  );
}

export default function PhoneSettingsEditor({
  clinicId,
  clinicName,
  initialSettings,
  initialHours,
  initialTestCall,
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
  const [testCall, setTestCall] = useState(initialTestCall);
  const [testPending, setTestPending] = useState(false);
  const [confirmTestCall, setConfirmTestCall] = useState(false);

  useEffect(() => {
    const attempt = testCall.latestAttempt;
    if (!attempt || !isActiveTelephonyTestCallStatus(attempt.status)) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const response = await fetch(
          `/api/clinics/${encodeURIComponent(clinicId)}/telephony/test-call/${encodeURIComponent(attempt.id)}`,
          { method: "GET", cache: "no-store" },
        );
        const body = await readApiResponse<TelephonyTestCallView>(response);
        if (cancelled || !response.ok || !body.success || !body.data) return;
        setTestCall((current) => ({ ...current, latestAttempt: body.data! }));
        if (isActiveTelephonyTestCallStatus(body.data.status)) {
          timer = setTimeout(poll, 2_000);
        } else {
          const panelResponse = await fetch(
            `/api/clinics/${encodeURIComponent(clinicId)}/telephony/test-call`,
            { method: "GET", cache: "no-store" },
          );
          const panelBody = await readApiResponse<TelephonyTestCallPanelView>(
            panelResponse,
          );
          if (
            !cancelled &&
            panelResponse.ok &&
            panelBody.success &&
            panelBody.data
          ) {
            setTestCall(panelBody.data);
          }
        }
      } catch {
        if (!cancelled) timer = setTimeout(poll, 4_000);
      }
    };
    timer = setTimeout(poll, 2_000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [clinicId, testCall.latestAttempt]);

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

  async function startTestCall() {
    if (testPending || pending !== null || !testCall.available) return;
    setTestPending(true);
    try {
      const response = await fetch(
        `/api/clinics/${encodeURIComponent(clinicId)}/telephony/test-call`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      const body = await readApiResponse<TelephonyTestCallView>(response);
      if (!response.ok || !body.success || !body.data) {
        showToast({
          tone: "alert",
          title: "Test call not started",
          detail:
            response.status === 403
              ? "You don't have permission to test this clinic's phone menu."
              : body.error ?? "The test call could not be started. Try again later.",
        });
        return;
      }
      setTestCall((current) => ({
        ...current,
        available: false,
        unavailableReason: "A test call is already in progress for this clinic.",
        latestAttempt: body.data!,
      }));
      setConfirmTestCall(false);
      showToast({ tone: "ok", title: "Controlled test call started." });
    } catch {
      showToast({
        tone: "alert",
        title: "Test call not started",
        detail: "Check your connection and try again.",
      });
    } finally {
      setTestPending(false);
    }
  }

  return (
    <div
      aria-busy={pending !== null || testPending || undefined}
      className="space-y-5"
    >
      <ReadinessOverview
        readiness={settings.readiness}
        routingMode={settings.routingMode}
        effectiveRoute={settings.effectiveRoute}
      />

      <Panel
        title="Test phone menu"
        description="Place a controlled test call to the configured QA number and hear this clinic's current phone menu."
        actions={
          <StatusPill tone={testCall.available ? "ok" : "neutral"}>
            {testCall.available ? "Test calls available" : "Test calls unavailable"}
          </StatusPill>
        }
      >
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="min-w-0 rounded-2xl border border-line bg-canvas-deep px-4 py-4">
            <div className="flex min-w-0 items-start gap-3">
              <span
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent"
              >
                <PhoneForwarded className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-label font-semibold text-ink">
                  {testCall.destinationLabel ?? "QA destination not configured"}
                </p>
                <p className="mt-1 text-meta leading-relaxed text-muted">
                  {testCall.unavailableReason ??
                    "The call is limited to two minutes and cannot perform clinic actions."}
                </p>
              </div>
            </div>
          </div>
          <Button
            variant="primary"
            disabled={
              !testCall.available || pending !== null || testPending
            }
            onClick={() => setConfirmTestCall(true)}
          >
            <PhoneCall aria-hidden="true" className="h-4 w-4" />
            Start test call
          </Button>
        </div>

        {testCall.latestAttempt && (
          <div
            aria-live="polite"
            className="mt-4 flex min-w-0 flex-wrap items-start justify-between gap-3 rounded-2xl border border-line bg-canvas px-4 py-3.5"
          >
            <div className="min-w-0">
              <p className="text-label font-semibold text-ink">Latest test</p>
              <p className="mt-1 text-meta leading-relaxed text-muted">
                {testCall.latestAttempt.message}
              </p>
            </div>
            <StatusPill tone={testStatusTone(testCall.latestAttempt.status)}>
              {TEST_STATUS_LABELS[testCall.latestAttempt.status]}
            </StatusPill>
          </div>
        )}
      </Panel>

      <div className="grid min-w-0 gap-5 lg:grid-cols-2 lg:items-start">
        <Panel
          title="Call destinations"
          description={`Operational contact numbers for ${clinicName}.`}
          actions={
            <StatusPill tone={callDirty ? "warn" : "neutral"}>
              {callDirty ? "Unsaved" : "Saved"}
            </StatusPill>
          }
        >
          <div className="space-y-4">
            <Input
              id="clinic-public-phone"
              label="Clinic public phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+919876543210"
              value={callDraft.publicPhoneNumber}
              disabled={pending !== null}
              error={callValidation.errors.publicPhoneNumber}
              hint="The clinic's normal public contact number. Use international format."
              onChange={(event) =>
                changeCallField("publicPhoneNumber", event.target.value)
              }
            />
            <Input
              id="clinic-reception-phone"
              label="Reception phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+919876543210"
              value={callDraft.receptionPhoneNumber}
              disabled={pending !== null}
              error={callValidation.errors.receptionPhoneNumber}
              hint="Calls routed to Reception are connected here."
              onChange={(event) =>
                changeCallField("receptionPhoneNumber", event.target.value)
              }
            />
            <Input
              id="clinic-urgent-phone"
              label="Urgent phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+919876543210"
              value={callDraft.urgentPhoneNumber}
              disabled={pending !== null}
              error={callValidation.errors.urgentPhoneNumber}
              hint="Confirmed urgent-assistance calls are connected here."
              onChange={(event) =>
                changeCallField("urgentPhoneNumber", event.target.value)
              }
            />
            <FieldShell
              id="clinic-phone-timezone"
              label="Timezone"
              error={callValidation.errors.timezone}
              hint="Automatic call routing evaluates business hours in this timezone."
            >
              <input
                id="clinic-phone-timezone"
                list="clinic-phone-timezone-options"
                value={callDraft.timezone}
                disabled={pending !== null}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={callValidation.errors.timezone ? true : undefined}
                aria-describedby="clinic-phone-timezone-message"
                onChange={(event) => changeCallField("timezone", event.target.value)}
                className={controlClasses(
                  Boolean(callValidation.errors.timezone),
                  "min-h-11 px-3.5",
                )}
              />
              <datalist id="clinic-phone-timezone-options">
                {timezoneOptions.map((timezone) => <option key={timezone} value={timezone} />)}
              </datalist>
            </FieldShell>
          </div>

          {callValidation.formError && (
            <p role="alert" className="mt-4 rounded-xl border border-alert-line bg-alert-bg px-4 py-3 text-label text-alert-ink">
              {callValidation.formError}
            </p>
          )}
          <div className="mt-5 flex justify-end border-t border-line pt-4">
            <Button
              variant="primary"
              isBusy={pending === "call"}
              busyLabel="Saving call settings"
              disabled={!callDirty || !callValidation.valid || pending !== null}
              onClick={saveCallSettings}
            >
              <Save aria-hidden="true" className="h-4 w-4" />
              Save call settings
            </Button>
          </div>
        </Panel>

        <Panel
          title="Business hours"
          description="The regular weekly schedule used when call handling is Automatic."
          actions={
            <StatusPill tone={hoursDirty ? "warn" : "neutral"}>
              {hoursDirty ? "Unsaved" : "Saved"}
            </StatusPill>
          }
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-canvas-deep px-4 py-3">
            <p className="text-label text-muted">No overnight schedules. Closing time must be later than opening time.</p>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending !== null}
              onClick={() => setHoursDraft((current) => copyMondayToWeekdays(current))}
            >
              Copy Monday to weekdays
            </Button>
          </div>

          <div className="space-y-3">
            {hoursDraft.map((day, index) => {
              const openError = hoursValidation.errors[`hours.${index}.openTime`];
              const closeError = hoursValidation.errors[`hours.${index}.closeTime`];
              return (
                <article key={day.dayOfWeek} className="rounded-2xl border border-line bg-canvas px-4 py-3.5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-body font-semibold text-ink">{DAY_LABELS[day.dayOfWeek]}</h3>
                      <p className="mt-0.5 text-meta text-muted">{day.isClosed ? "Closed all day" : `${day.openTime}–${day.closeTime}`}</p>
                    </div>
                    <Toggle
                      id={`phone-hours-closed-${day.dayOfWeek}`}
                      label="Closed"
                      checked={day.isClosed}
                      disabled={pending !== null}
                      onChange={(isClosed) =>
                        setHoursDraft((current) =>
                          updateBusinessHoursDay(current, day.dayOfWeek, { isClosed }),
                        )
                      }
                    />
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Input
                      id={`phone-hours-open-${day.dayOfWeek}`}
                      label="Open time"
                      type="time"
                      value={day.openTime}
                      disabled={day.isClosed || pending !== null}
                      error={openError}
                      onChange={(event) =>
                        setHoursDraft((current) =>
                          updateBusinessHoursDay(current, day.dayOfWeek, {
                            openTime: event.target.value,
                          }),
                        )
                      }
                    />
                    <Input
                      id={`phone-hours-close-${day.dayOfWeek}`}
                      label="Close time"
                      type="time"
                      value={day.closeTime}
                      disabled={day.isClosed || pending !== null}
                      error={closeError}
                      onChange={(event) =>
                        setHoursDraft((current) =>
                          updateBusinessHoursDay(current, day.dayOfWeek, {
                            closeTime: event.target.value,
                          }),
                        )
                      }
                    />
                  </div>
                </article>
              );
            })}
          </div>

          {hoursValidation.formError && (
            <p role="alert" className="mt-4 rounded-xl border border-alert-line bg-alert-bg px-4 py-3 text-label text-alert-ink">
              {hoursValidation.formError}
            </p>
          )}
          <div className="mt-5 flex justify-end border-t border-line pt-4">
            <Button
              variant="secondary"
              isBusy={pending === "hours"}
              busyLabel="Saving business hours"
              disabled={!hoursDirty || !hoursValidation.valid || pending !== null}
              onClick={saveBusinessHours}
            >
              <CalendarDays aria-hidden="true" className="h-4 w-4" />
              Save business hours
            </Button>
          </div>
        </Panel>
      </div>

      <Panel
        title="Related controls"
        description="Phone content and live routing stay in their dedicated screens."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Link href="/settings/phone-menu" className={buttonClasses("secondary", "md", "min-w-0 justify-between whitespace-normal text-left") }>
            <span className="flex min-w-0 items-center gap-3">
              <PhoneCall aria-hidden="true" className="h-4 w-4 shrink-0 text-accent" />
              Configure phone menu
            </span>
            <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0" />
          </Link>
          <Link href="/dashboard" className={buttonClasses("secondary", "md", "min-w-0 justify-between whitespace-normal text-left") }>
            <span className="flex min-w-0 items-center gap-3">
              <Clock3 aria-hidden="true" className="h-4 w-4 shrink-0 text-accent" />
              Dashboard Call Handling
            </span>
            <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0" />
          </Link>
        </div>
        <p className="mt-4 flex items-start gap-2 text-meta leading-relaxed text-muted">
          <ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          Controlled menu tests use only the deployment-approved QA number and never book appointments or transfer callers.
        </p>
      </Panel>

      <ConfirmDialog
        isOpen={confirmTestCall}
        onCancel={() => setConfirmTestCall(false)}
        onConfirm={startTestCall}
        title="Start phone menu test?"
        body={`Start a test call to ${testCall.destinationLabel ?? "the configured QA number"}? The call will play this clinic's current phone menu but will not book appointments or transfer callers.`}
        confirmLabel="Start test call"
        tone="primary"
        isBusy={testPending}
        busyLabel="Starting test call"
      />
    </div>
  );
}
