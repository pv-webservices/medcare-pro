"use client";

import { CalendarX2, CheckCircle2, LogIn, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Button, { type ButtonSize } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import type { AppointmentStatus } from "@/lib/appointmentRules";

/**
 * The lifecycle controls on one appointment — AP-6.
 *
 * One component for the board row and the detail page, so the same appointment
 * never offers a different set of actions depending on which screen you reached
 * it from. Rescheduling is deliberately NOT here: moving a slot needs a date, a
 * doctor and a slot picker, which is a form and not a button, so it lives on
 * the detail page alone.
 *
 * WHICH BUTTONS APPEAR IS DERIVED FROM THE STATUS, and it mirrors AP-1's
 * transition table rather than restating it in prose:
 *
 *   Booked / Confirmed  →  Check In, Cancel, Did Not Attend
 *   Arrived             →  Register Patient, Cancel, Did Not Attend
 *   anything terminal   →  nothing. The row is finished.
 *
 * HIDING A BUTTON IS NOT ACCESS CONTROL. Every route behind these calls runs
 * its own feature, scope and permission checks and refuses a caller who posts
 * to it directly. The `can*` props exist so nobody is offered a control that
 * will only refuse them — the courtesy layer on top of the enforcement.
 *
 * "Register Patient" is the only `commit` variant here. Commit colour marks a
 * write into a clinic's records, and converting is the one action on this strip
 * that creates one — a Patient, a Patient ID and a Registration. Checking
 * somebody in moves a status; it does not put anything on the register.
 */

interface AppointmentActionsProps {
  appointmentId: string;
  status: AppointmentStatus;
  canCheckIn: boolean;
  canConvert: boolean;
  canCancel: boolean;
  size?: ButtonSize;
  className?: string;
}

/** Which endpoint each control posts to, and what the desk should read after. */
type Action = "check-in" | "convert" | "cancel" | "no-show";

const SUCCESS: Record<Action, { title: string; detail?: string }> = {
  "check-in": { title: "Patient marked as arrived." },
  convert: {
    title: "Patient registered.",
    detail: "The visit is on the register and the slot stays booked.",
  },
  cancel: { title: "Appointment cancelled.", detail: "The slot is free again." },
  "no-show": {
    title: "Marked as did not attend.",
    detail: "The slot is free again.",
  },
};

export default function AppointmentActions({
  appointmentId,
  status,
  canCheckIn,
  canConvert,
  canCancel,
  size = "sm",
  className,
}: AppointmentActionsProps) {
  const router = useRouter();
  const showToast = useToast();
  const [busy, setBusy] = useState<Action | null>(null);

  const isArrived = status === "CHECKED_IN";
  const isWaiting = status === "SCHEDULED" || status === "CONFIRMED";
  const isLive = isArrived || isWaiting;

  async function run(action: Action) {
    setBusy(action);

    try {
      const response = await fetch(`/api/appointments/${appointmentId}/${action}`, {
        method: "POST",
      });
      const payload: { success?: boolean; error?: string } = await response
        .json()
        .catch(() => ({}));

      if (!response.ok || !payload.success) {
        // The server's message is written for the front desk — "This
        // appointment has already been converted to a registration." reads
        // better than anything this component could invent, so it is passed
        // through rather than replaced.
        showToast({
          tone: "alert",
          title: "That did not go through.",
          detail: payload.error ?? "Try again in a moment.",
        });
        return;
      }

      showToast({ tone: "ok", ...SUCCESS[action] });
      router.refresh();
    } catch {
      showToast({
        tone: "alert",
        title: "Could not reach the server.",
        detail: "Check your connection and try again.",
      });
    } finally {
      setBusy(null);
    }
  }

  if (!isLive) {
    return null;
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        {isWaiting && canCheckIn && (
          <Button
            size={size}
            variant="secondary"
            isBusy={busy === "check-in"}
            busyLabel="Checking in…"
            disabled={busy !== null}
            onClick={() => run("check-in")}
          >
            <LogIn aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
            Check In
          </Button>
        )}

        {isArrived && canConvert && (
          <Button
            size={size}
            variant="commit"
            isBusy={busy === "convert"}
            busyLabel="Registering…"
            disabled={busy !== null}
            onClick={() => run("convert")}
          >
            <UserPlus aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
            Register Patient
          </Button>
        )}

        {canCancel && (
          <>
            <Button
              size={size}
              variant="quiet"
              isBusy={busy === "no-show"}
              busyLabel="Saving…"
              disabled={busy !== null}
              onClick={() => run("no-show")}
            >
              <CalendarX2 aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
              Did Not Attend
            </Button>

            <Button
              size={size}
              variant="danger"
              isBusy={busy === "cancel"}
              busyLabel="Cancelling…"
              disabled={busy !== null}
              onClick={() => run("cancel")}
            >
              Cancel
            </Button>
          </>
        )}
      </div>

      {isArrived && canConvert && (
        <p className="mt-2 text-xs text-slate-500">
          <CheckCircle2
            aria-hidden="true"
            strokeWidth={1.75}
            className="mr-1 inline h-3.5 w-3.5 align-[-2px]"
          />
          Registering creates the patient record and Patient ID if this is their
          first visit.
        </p>
      )}
    </div>
  );
}
