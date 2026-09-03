"use client";

import type { ClinicTelephonyRoutingMode } from "@prisma/client";
import { Clock3, LoaderCircle, PhoneCall } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useReducer, useRef, useState, type KeyboardEvent } from "react";
import { ConfirmDialog, StatusPill, cx, useToast } from "@/components/ui";
import type { DashboardCallHandlingModel } from "@/lib/telephony/dashboardCallHandling";
import {
  CALL_HANDLING_SUCCESS_MESSAGES,
  DASHBOARD_CALL_HANDLING_OPTIONS,
  resolveCallHandlingEffectiveState,
} from "@/lib/telephony/dashboardCallHandlingState";
import type { ApiResponse } from "@/lib/utils";

export interface CallHandlingMutationState {
  confirmedMode: ClinicTelephonyRoutingMode;
  pendingMode: ClinicTelephonyRoutingMode | null;
}

export type CallHandlingMutationAction =
  | { type: "begin"; routingMode: ClinicTelephonyRoutingMode }
  | { type: "success"; routingMode: ClinicTelephonyRoutingMode }
  | { type: "failure" }
  | { type: "reset"; routingMode: ClinicTelephonyRoutingMode };

export function callHandlingMutationReducer(
  state: CallHandlingMutationState,
  action: CallHandlingMutationAction,
): CallHandlingMutationState {
  switch (action.type) {
    case "begin":
      return { ...state, pendingMode: action.routingMode };
    case "success":
      return { confirmedMode: action.routingMode, pendingMode: null };
    case "failure":
      return { ...state, pendingMode: null };
    case "reset":
      return { confirmedMode: action.routingMode, pendingMode: null };
  }
}

function formatClockTime(value: string): string {
  const [hour, minute] = value.split(":").map(Number);
  const date = new Date(Date.UTC(2000, 0, 1, hour, minute));
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

export function formatTodayHours(model: DashboardCallHandlingModel): string {
  if (!model.hasRegularHours) return "Not configured";
  if (
    model.todayHours.isClosed ||
    model.todayHours.openTime === null ||
    model.todayHours.closeTime === null
  ) {
    return "Closed today";
  }
  return `${formatClockTime(model.todayHours.openTime)} – ${formatClockTime(model.todayHours.closeTime)}`;
}

function formatNextOpening(model: DashboardCallHandlingModel): string | null {
  const next = model.nextOpening;
  if (!next) return null;
  const day =
    next.dayOffset === 0
      ? "Today"
      : next.dayOffset === 1
        ? "Tomorrow"
        : next.dayOfWeek.charAt(0) + next.dayOfWeek.slice(1).toLowerCase();
  return `${day} at ${formatClockTime(next.openTime)}`;
}

function AllClinicsCallHandling() {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-canvas px-4 py-3 text-label text-muted shadow-card">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-canvas-deep text-muted">
          <PhoneCall aria-hidden="true" className="h-3.5 w-3.5" />
        </span>
        <span className="truncate text-label text-muted">
          Select a clinic to manage call handling.
        </span>
      </div>
      <StatusPill tone="neutral">Per clinic</StatusPill>
    </div>
  );
}

class CallHandlingPermissionError extends Error {}

function ClinicCallHandling({
  model,
  clinicName,
}: {
  model: DashboardCallHandlingModel;
  clinicName: string;
}) {
  const router = useRouter();
  const showToast = useToast();
  const request = useRef<AbortController | null>(null);
  const routingButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const [pendingTargetMode, setPendingTargetMode] =
    useState<ClinicTelephonyRoutingMode | null>(null);
  const [mutation, dispatch] = useReducer(callHandlingMutationReducer, {
    confirmedMode: model.routingMode,
    pendingMode: null,
  });

  function requestRoutingModeChange(routingMode: ClinicTelephonyRoutingMode) {
    if (
      !model.enabled ||
      !model.canManage ||
      mutation.pendingMode !== null ||
      routingMode === mutation.confirmedMode
    ) {
      return;
    }
    setPendingTargetMode(routingMode);
  }

  useEffect(() => {
    dispatch({ type: "reset", routingMode: model.routingMode });
  }, [model.clinicId, model.routingMode, model.updatedAt]);

  useEffect(
    () => () => {
      request.current?.abort();
    },
    [],
  );

  const displayedMode = mutation.pendingMode ?? mutation.confirmedMode;
  const effective = resolveCallHandlingEffectiveState({
    enabled: model.enabled,
    routingMode: displayedMode,
    isOpen: model.isOpen,
    hasRegularHours: model.hasRegularHours,
    receptionAvailable: model.receptionAvailable,
  });
  const nextOpening = formatNextOpening(model);

  const currentOption =
    DASHBOARD_CALL_HANDLING_OPTIONS.find(
      (opt) => opt.routingMode === mutation.confirmedMode,
    ) ?? DASHBOARD_CALL_HANDLING_OPTIONS[0];

  const targetOption = DASHBOARD_CALL_HANDLING_OPTIONS.find(
    (opt) => opt.routingMode === pendingTargetMode,
  );

  async function changeRoutingMode(routingMode: ClinicTelephonyRoutingMode) {
    if (
      !model.enabled ||
      !model.canManage ||
      mutation.pendingMode !== null ||
      routingMode === mutation.confirmedMode
    ) {
      return;
    }

    const controller = new AbortController();
    request.current = controller;
    dispatch({ type: "begin", routingMode });

    try {
      const response = await fetch(
        `/api/clinics/${encodeURIComponent(model.clinicId)}/telephony`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ routingMode }),
          signal: controller.signal,
        },
      );
      const payload = (await response.json()) as ApiResponse<{
        routingMode?: unknown;
      }>;
      if (response.status === 403) throw new CallHandlingPermissionError();
      if (
        !payload.success ||
        payload.data?.routingMode !== routingMode
      ) {
        throw new Error("The confirmed routing mode was not returned.");
      }

      dispatch({ type: "success", routingMode });
      showToast({
        tone: "ok",
        title: CALL_HANDLING_SUCCESS_MESSAGES[routingMode],
      });
      router.refresh();
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      dispatch({ type: "failure" });
      showToast({
        tone: "alert",
        title:
          error instanceof CallHandlingPermissionError
            ? "You don't have permission to change call handling."
            : "Call handling wasn't changed. Try again.",
      });
    } finally {
      if (request.current === controller) request.current = null;
    }
  }

  function moveRoutingFocus(
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) {
    if (
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
        event.key,
      ) ||
      !model.enabled ||
      mutation.pendingMode !== null
    ) {
      return;
    }

    event.preventDefault();
    const direction =
      event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    const nextIndex =
      (currentIndex + direction + DASHBOARD_CALL_HANDLING_OPTIONS.length) %
      DASHBOARD_CALL_HANDLING_OPTIONS.length;
    routingButtons.current[nextIndex]?.focus();
    requestRoutingModeChange(
      DASHBOARD_CALL_HANDLING_OPTIONS[nextIndex].routingMode,
    );
  }

  return (
    <section
      aria-label="Call handling"
      className={cx(
        "overflow-hidden rounded-2xl border border-line bg-canvas p-4 sm:p-5 shadow-card",
        pendingTargetMode === null && "dashboard-card-hover",
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-section font-semibold text-ink">Call handling</h2>
            <StatusPill tone={model.enabled ? "ok" : "neutral"}>
              {model.enabled ? "Active" : "Disabled"}
            </StatusPill>
          </div>
          <p className="mt-0.5 truncate text-meta text-muted">
            Control incoming calls for {clinicName}.
          </p>
        </div>

        {model.canManage ? (
          <div
            role="radiogroup"
            aria-label={`Call routing for ${clinicName}`}
            aria-busy={mutation.pendingMode !== null}
            className="grid grid-cols-3 gap-1 rounded-xl border border-line bg-canvas-deep p-1 sm:w-auto"
          >
            {DASHBOARD_CALL_HANDLING_OPTIONS.map((option, index) => {
              const selected = displayedMode === option.routingMode;
              const pending = mutation.pendingMode === option.routingMode;
              return (
                <button
                  key={option.routingMode}
                  ref={(element) => {
                    routingButtons.current[index] = element;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={pending ? `${option.label}, updating` : option.label}
                  tabIndex={selected ? 0 : -1}
                  disabled={!model.enabled || mutation.pendingMode !== null}
                  onClick={() => requestRoutingModeChange(option.routingMode)}
                  onKeyDown={(event) => moveRoutingFocus(event, index)}
                  className={cx(
                    "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-label font-semibold",
                    "transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2",
                    selected
                      ? "bg-canvas text-ink shadow-card"
                      : "text-muted hover:bg-canvas hover:text-ink",
                    "disabled:cursor-not-allowed disabled:opacity-60",
                  )}
                >
                  {pending && (
                    <LoaderCircle
                      aria-hidden="true"
                      className="h-3.5 w-3.5 animate-spin"
                    />
                  )}
                  {option.label}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-line bg-canvas-deep px-3.5 py-2 text-meta text-muted">
            Routing changes require clinic edit permission.
          </div>
        )}
      </div>

      <div className="mt-3.5 grid gap-2.5 sm:grid-cols-2">
        <div className="flex min-w-0 items-center gap-3 rounded-xl border border-line/80 bg-canvas-deep/40 px-3.5 py-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-soft-ink">
            <PhoneCall aria-hidden="true" className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted">Current routing</p>
            <p aria-live="polite" className="truncate text-label font-semibold text-ink">
              {effective.status}
            </p>
            {effective.supportingText && (
              <p className="truncate text-meta text-muted">{effective.supportingText}</p>
            )}
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-3 rounded-xl border border-line/80 bg-canvas-deep/40 px-3.5 py-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-info-bg text-info-ink">
            <Clock3 aria-hidden="true" className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted">Today&apos;s hours</p>
            <p className="tnum truncate text-label font-semibold text-ink">
              {formatTodayHours(model)}
            </p>
            {nextOpening && !model.isOpen && (
              <p className="truncate text-meta text-muted">Next opening: {nextOpening}</p>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={pendingTargetMode !== null}
        onCancel={() => {
          if (mutation.pendingMode === null) {
            setPendingTargetMode(null);
          }
        }}
        onConfirm={() => {
          if (pendingTargetMode) {
            const target = pendingTargetMode;
            void changeRoutingMode(target).finally(() => {
              setPendingTargetMode(null);
            });
          }
        }}
        title="Change call handling setting?"
        body={
          targetOption
            ? `Do you really want to change the settings from ${currentOption.label} to ${targetOption.label}?`
            : ""
        }
        confirmLabel="Yes"
        cancelLabel="No"
        tone="primary"
        isBusy={mutation.pendingMode !== null}
        busyLabel="Changing..."
      />
    </section>
  );
}

export default function CallHandlingPanel({
  model,
  clinicName,
}: {
  model: DashboardCallHandlingModel | null;
  clinicName: string | null;
}) {
  if (model === null) return <AllClinicsCallHandling />;
  return (
    <ClinicCallHandling
      model={model}
      clinicName={clinicName ?? "this clinic"}
    />
  );
}
