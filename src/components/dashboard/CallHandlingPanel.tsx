"use client";

import type { ClinicTelephonyRoutingMode } from "@prisma/client";
import { Clock3, LoaderCircle, PhoneCall } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useReducer, useRef, type KeyboardEvent } from "react";
import { Panel, StatusPill, cx, useToast } from "@/components/ui";
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
    <Panel
      title="Call handling"
      description="Call routing is configured per clinic. Select a clinic above to view or change its routing."
      actions={<StatusPill tone="neutral">Per clinic</StatusPill>}
    >
      <p className="text-label text-muted">
        No routing changes are available in the All clinics view.
      </p>
    </Panel>
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
  const [mutation, dispatch] = useReducer(callHandlingMutationReducer, {
    confirmedMode: model.routingMode,
    pendingMode: null,
  });

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
    void changeRoutingMode(
      DASHBOARD_CALL_HANDLING_OPTIONS[nextIndex].routingMode,
    );
  }

  return (
    <Panel
      title="Call handling"
      description={`Control incoming calls for ${clinicName}.`}
      actions={
        <StatusPill tone={model.enabled ? "ok" : "neutral"}>
          {model.enabled ? "Active" : "Disabled"}
        </StatusPill>
      }
    >
      {model.canManage ? (
        <div
          role="radiogroup"
          aria-label={`Call routing for ${clinicName}`}
          aria-busy={mutation.pendingMode !== null}
          className="grid grid-cols-3 gap-1 rounded-xl border border-line bg-canvas-deep p-1"
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
                onClick={() => changeRoutingMode(option.routingMode)}
                onKeyDown={(event) => moveRoutingFocus(event, index)}
                className={cx(
                  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-label font-semibold",
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
                    className="h-4 w-4 animate-spin"
                  />
                )}
                {option.label}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-line bg-canvas-deep px-4 py-3 text-label text-muted">
          Routing changes require clinic edit permission.
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="flex min-w-0 gap-3 rounded-xl border border-line px-4 py-3.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-soft-ink">
            <PhoneCall aria-hidden="true" className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-meta font-medium text-muted">Current routing</p>
            <p aria-live="polite" className="mt-0.5 text-body font-semibold text-ink">
              {effective.status}
            </p>
            {effective.supportingText && (
              <p className="mt-1 text-meta text-muted">{effective.supportingText}</p>
            )}
          </div>
        </div>

        <div className="flex min-w-0 gap-3 rounded-xl border border-line px-4 py-3.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-info-bg text-info-ink">
            <Clock3 aria-hidden="true" className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-meta font-medium text-muted">Today&apos;s hours</p>
            <p className="tnum mt-0.5 text-body font-semibold text-ink">
              {formatTodayHours(model)}
            </p>
            {nextOpening && !model.isOpen && (
              <p className="mt-1 text-meta text-muted">Next opening: {nextOpening}</p>
            )}
          </div>
        </div>
      </div>
    </Panel>
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
