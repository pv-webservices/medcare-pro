"use client";

import { PhoneCall, PhoneForwarded } from "lucide-react";
import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Modal";
import Panel from "@/components/ui/Panel";
import StatusPill, { type StatusTone } from "@/components/ui/StatusPill";
import { useToast } from "@/components/ui/Toast";
import {
  isActiveTelephonyTestCallStatus,
  type TelephonyTestCallPanelView,
  type TelephonyTestCallStatus,
  type TelephonyTestCallView,
} from "@/lib/telephony/testCallContract";
import type { ApiResponse } from "@/lib/utils";

const STATUS_LABELS: Record<TelephonyTestCallStatus, string> = {
  REQUESTED: "Starting…",
  RINGING: "Ringing…",
  ANSWERED: "Answered…",
  COMPLETED: "Completed",
  FAILED: "Failed",
};

function statusTone(status: TelephonyTestCallStatus): StatusTone {
  if (status === "COMPLETED") return "ok";
  if (status === "FAILED") return "alert";
  return "warn";
}

async function readApiResponse<T>(response: Response): Promise<ApiResponse<T>> {
  return (await response.json()) as ApiResponse<T>;
}

export default function PhoneMenuTestPanel({
  clinicId,
  initialTestCall,
}: {
  clinicId: string;
  initialTestCall: TelephonyTestCallPanelView;
}) {
  const showToast = useToast();
  const [testCall, setTestCall] = useState(initialTestCall);
  const [pending, setPending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

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
          const panelBody = await readApiResponse<TelephonyTestCallPanelView>(panelResponse);
          if (!cancelled && panelResponse.ok && panelBody.success && panelBody.data) {
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

  async function startTestCall() {
    if (pending || !testCall.available) return;
    setPending(true);
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
      setConfirmOpen(false);
      showToast({ tone: "ok", title: "Controlled test call started." });
    } catch {
      showToast({
        tone: "alert",
        title: "Test call not started",
        detail: "Check your connection and try again.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <>
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
              <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
                <PhoneForwarded className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-label font-semibold text-ink">
                  {testCall.destinationLabel ?? "QA destination not configured"}
                </p>
                <p className="mt-1 text-meta leading-relaxed text-muted">
                  {testCall.unavailableReason ?? "The call is limited to two minutes and cannot perform clinic actions."}
                </p>
              </div>
            </div>
          </div>
          <Button variant="primary" disabled={!testCall.available || pending} onClick={() => setConfirmOpen(true)}>
            <PhoneCall aria-hidden="true" className="h-4 w-4" />
            Start test call
          </Button>
        </div>

        {testCall.latestAttempt && (
          <div aria-live="polite" className="mt-4 flex min-w-0 flex-wrap items-start justify-between gap-3 rounded-2xl border border-line bg-canvas px-4 py-3.5">
            <div className="min-w-0">
              <p className="text-label font-semibold text-ink">Latest test</p>
              <p className="mt-1 text-meta leading-relaxed text-muted">{testCall.latestAttempt.message}</p>
            </div>
            <StatusPill tone={statusTone(testCall.latestAttempt.status)}>
              {STATUS_LABELS[testCall.latestAttempt.status]}
            </StatusPill>
          </div>
        )}
      </Panel>

      <ConfirmDialog
        isOpen={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={startTestCall}
        title="Start phone menu test?"
        body={`Start a test call to ${testCall.destinationLabel ?? "the configured QA number"}? The call will play this clinic's current phone menu but will not book appointments or transfer callers.`}
        confirmLabel="Start test call"
        tone="primary"
        isBusy={pending}
        busyLabel="Starting test call"
      />
    </>
  );
}
