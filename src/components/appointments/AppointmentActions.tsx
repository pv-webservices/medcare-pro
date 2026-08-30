"use client";

import {
  CalendarX2,
  CheckCheck,
  CheckCircle2,
  LogIn,
  MoreVertical,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Button, { type ButtonSize } from "@/components/ui/Button";
import Menu, { menuItemClasses } from "@/components/ui/Menu";
import { ConfirmDialog } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { cx } from "@/components/ui/cx";
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
 *   Booked              →  Confirm, Check In, Cancel, Did Not Attend
 *   Confirmed           →  Check In, Cancel, Did Not Attend
 *   Arrived             →  Register Patient, Cancel, Did Not Attend
 *   anything terminal   →  nothing. The row is finished.
 *
 * Confirm appears on a booked appointment ONLY, because SCHEDULED is the one
 * state AP-1's transition table lets into CONFIRMED — a patient who has already
 * arrived is past confirming, and the button would only ever refuse.
 *
 * HIDING A BUTTON IS NOT ACCESS CONTROL. Every route behind these calls runs
 * its own feature, scope and permission checks and refuses a caller who posts
 * to it directly. The `can*` props exist so nobody is offered a control that
 * will only refuse them — the courtesy layer on top of the enforcement.
 *
 * "Register patient" is the only `commit` variant here. Commit colour marks a
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
  /** AP-9. Confirming answers to `appointment:update`, not to a key of its own. */
  canConfirm: boolean;
  size?: ButtonSize;
  /** "default" displays the full button row; "compact" renders inline primary action + overflow menu for board rows; "detail" renders the dedicated horizontal action strip. */
  presentation?: "default" | "compact" | "detail";
  className?: string;
}

/** Which endpoint each control posts to, and what the desk should read after. */
type Action = "confirm" | "check-in" | "convert" | "cancel" | "no-show";

const SUCCESS: Record<Action, { title: string; detail?: string }> = {
  confirm: {
    title: "Appointment confirmed.",
    detail: "The slot was already held and stays held.",
  },
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
  canConfirm,
  size = "sm",
  presentation = "default",
  className,
}: AppointmentActionsProps) {
  const router = useRouter();
  const showToast = useToast();
  const [busy, setBusy] = useState<Action | null>(null);
  /**
   * Cancelling frees the slot and cannot be undone from this screen, so it is
   * the one action here that asks first. Everything else on this row moves the
   * appointment forward and is recoverable by moving it again.
   */
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false);

  const isArrived = status === "CHECKED_IN";
  const isBooked = status === "SCHEDULED";
  const isWaiting = isBooked || status === "CONFIRMED";
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

  if (presentation === "compact") {
    return (
      <div className={cx("flex items-center justify-end gap-1.5", className)}>
        {isBooked && canConfirm && (
          <Button
            size={size}
            variant="secondary"
            isBusy={busy === "confirm"}
            busyLabel="Confirming..."
            disabled={busy !== null}
            onClick={() => run("confirm")}
          >
            Confirm
          </Button>
        )}

        {isBooked && !canConfirm && canCheckIn && (
          <Button
            size={size}
            variant="secondary"
            isBusy={busy === "check-in"}
            busyLabel="Checking in..."
            disabled={busy !== null}
            onClick={() => run("check-in")}
          >
            Check in
          </Button>
        )}

        {status === "CONFIRMED" && canCheckIn && (
          <Button
            size={size}
            variant="secondary"
            isBusy={busy === "check-in"}
            busyLabel="Checking in..."
            disabled={busy !== null}
            onClick={() => run("check-in")}
          >
            Check in
          </Button>
        )}

        {isArrived && canConvert && (
          <Button
            size={size}
            variant="primary"
            isBusy={busy === "convert"}
            busyLabel="Registering..."
            disabled={busy !== null}
            onClick={() => run("convert")}
          >
            Register
          </Button>
        )}

        <Menu
          align="end"
          usePortal
          label="Appointment actions"
          trigger={({ isOpen }) => (
            <span
              className={cx(
                "inline-flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-canvas text-muted transition-colors duration-150",
                "hover:border-line-strong hover:bg-canvas-deep hover:text-ink",
                isOpen && "border-line-strong bg-canvas-deep text-ink",
              )}
              aria-label="More actions"
              title="More actions"
            >
              <MoreVertical className="h-4 w-4" aria-hidden="true" strokeWidth={2} />
            </span>
          )}
        >
          <Link
            href={`/appointments/${appointmentId}`}
            className={menuItemClasses()}
          >
            Open appointment
          </Link>

          {isBooked && canConfirm && canCheckIn && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => run("check-in")}
              className={menuItemClasses()}
            >
              Check in
            </button>
          )}

          {isLive && canCancel && (
            <>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => run("no-show")}
                className={menuItemClasses()}
              >
                Did not attend
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => setIsConfirmingCancel(true)}
                className={menuItemClasses(false, "danger")}
              >
                Cancel appointment
              </button>
            </>
          )}
        </Menu>

        <ConfirmDialog
          isOpen={isConfirmingCancel}
          onCancel={() => setIsConfirmingCancel(false)}
          onConfirm={() => {
            setIsConfirmingCancel(false);
            void run("cancel");
          }}
          title="Cancel this appointment?"
          body="The slot is released and becomes bookable again. The appointment stays on the record as cancelled."
          confirmLabel="Cancel appointment"
          cancelLabel="Keep it"
          isBusy={busy === "cancel"}
          busyLabel="Cancelling..."
        />
      </div>
    );
  }

  if (!isLive) {
    return null;
  }

  if (presentation === "detail") {
    return (
      <div className={className}>
        <div className="flex flex-wrap items-center gap-2.5">
          {status === "CONFIRMED" && (
            <span className="rounded-xl border border-line bg-canvas px-3.5 py-2 text-label font-medium text-ink shadow-sm">
              Confirmed
            </span>
          )}

          {isBooked && canConfirm && (
            <Button
              size={size}
              variant="secondary"
              isBusy={busy === "confirm"}
              busyLabel="Confirming…"
              disabled={busy !== null}
              onClick={() => run("confirm")}
              className="rounded-xl font-medium"
            >
              <CheckCheck aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
              Confirm
            </Button>
          )}

          {isWaiting && canCheckIn && (
            <Button
              size={size}
              variant="primary"
              isBusy={busy === "check-in"}
              busyLabel="Checking in…"
              disabled={busy !== null}
              onClick={() => run("check-in")}
              className="rounded-xl font-medium shadow-cta"
            >
              <LogIn aria-hidden="true" strokeWidth={2} className="h-4 w-4" />
              Check in
            </Button>
          )}

          {isArrived && canConvert && (
            <Button
              size={size}
              variant="primary"
              isBusy={busy === "convert"}
              busyLabel="Registering…"
              disabled={busy !== null}
              onClick={() => run("convert")}
              className="rounded-xl font-medium shadow-cta"
            >
              <UserPlus aria-hidden="true" strokeWidth={2} className="h-4 w-4" />
              Register patient
            </Button>
          )}

          {canCancel && (
            <>
              <Button
                size={size}
                variant="ghost"
                isBusy={busy === "no-show"}
                busyLabel="Saving…"
                disabled={busy !== null}
                onClick={() => run("no-show")}
                className="rounded-xl font-medium text-ink hover:bg-canvas-deep"
              >
                Did not attend
              </Button>

              <Button
                size={size}
                variant="danger"
                isBusy={busy === "cancel"}
                busyLabel="Cancelling…"
                disabled={busy !== null}
                onClick={() => setIsConfirmingCancel(true)}
                className="rounded-xl font-medium border border-alert-mark/30"
              >
                Cancel
              </Button>
            </>
          )}
        </div>

        <ConfirmDialog
          isOpen={isConfirmingCancel}
          onCancel={() => setIsConfirmingCancel(false)}
          onConfirm={() => {
            setIsConfirmingCancel(false);
            void run("cancel");
          }}
          title="Cancel this appointment?"
          body="The slot is released and becomes bookable again. The appointment stays on the record as cancelled."
          confirmLabel="Cancel appointment"
          cancelLabel="Keep it"
          isBusy={busy === "cancel"}
          busyLabel="Cancelling…"
        />

        {isArrived && canConvert && (
          <p className="mt-2 text-meta text-muted">
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

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        {isBooked && canConfirm && (
          <Button
            size={size}
            variant="secondary"
            isBusy={busy === "confirm"}
            busyLabel="Confirming..."
            disabled={busy !== null}
            onClick={() => run("confirm")}
          >
            <CheckCheck aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
            Confirm
          </Button>
        )}

        {isWaiting && canCheckIn && (
          <Button
            size={size}
            variant="secondary"
            isBusy={busy === "check-in"}
            busyLabel="Checking in..."
            disabled={busy !== null}
            onClick={() => run("check-in")}
          >
            <LogIn aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
            Check in
          </Button>
        )}

        {isArrived && canConvert && (
          <Button
            size={size}
            variant="primary"
            isBusy={busy === "convert"}
            busyLabel="Registering..."
            disabled={busy !== null}
            onClick={() => run("convert")}
          >
            <UserPlus aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
            Register patient
          </Button>
        )}

        {canCancel && (
          <>
            <Button
              size={size}
              variant="ghost"
              isBusy={busy === "no-show"}
              busyLabel="Saving..."
              disabled={busy !== null}
              onClick={() => run("no-show")}
            >
              <CalendarX2 aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
              Did not attend
            </Button>

            <Button
              size={size}
              variant="danger"
              isBusy={busy === "cancel"}
              busyLabel="Cancelling..."
              disabled={busy !== null}
              onClick={() => setIsConfirmingCancel(true)}
            >
              Cancel appointment
            </Button>
          </>
        )}
      </div>

      <ConfirmDialog
        isOpen={isConfirmingCancel}
        onCancel={() => setIsConfirmingCancel(false)}
        onConfirm={() => {
          setIsConfirmingCancel(false);
          void run("cancel");
        }}
        title="Cancel this appointment?"
        body="The slot is released and becomes bookable again. The appointment stays on the record as cancelled."
        confirmLabel="Cancel appointment"
        cancelLabel="Keep it"
        isBusy={busy === "cancel"}
        busyLabel="Cancelling..."
      />

      {isArrived && canConvert && (
        <p className="mt-2 text-meta text-muted">
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
