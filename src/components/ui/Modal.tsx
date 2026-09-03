"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import Button from "@/components/ui/Button";
import IconButton from "@/components/ui/IconButton";
import { cx } from "@/components/ui/cx";

const emptySubscribe = () => () => {};

function useMounted() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

/**
 * A modal dialog, and the confirmation dialog built on it.
 *
 * WHAT BELONGS IN ONE. A quick create, a short edit, a preview, and above all a
 * confirmation. What does NOT belong in one is a long workflow: booking an
 * appointment or registering a patient is a full page, because a twelve-field
 * form in a 480px box is a form nobody can check before submitting.
 *
 * THE ACCESSIBILITY IS THE HARD PART, and it is why this is a primitive:
 *  - `role="dialog"` + `aria-modal` + a label wired to the visible title.
 *  - Focus moves into the dialog on open and returns to whatever opened it on
 *    close, so a keyboard user is never dropped at the top of the page.
 *  - Tab is trapped inside while it is open. A dialog you can tab out of but
 *    not see is worse than no dialog.
 *  - Escape closes, and so does the backdrop — but never while a request is in
 *    flight, which is what `isBusy` guards.
 *  - The page behind it does not scroll.
 */

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  /** One line under the title. What this dialog is for. */
  description?: ReactNode;
  /** Buttons, right-aligned in the footer. Primary action last. */
  footer?: ReactNode;
  /** Blocks Escape and backdrop dismissal — for a write already in flight. */
  isBusy?: boolean;
  size?: "sm" | "md" | "lg";
  children?: ReactNode;
}

const SIZES = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
} as const;

export default function Modal({
  isOpen,
  onClose,
  title,
  description,
  footer,
  isBusy = false,
  size = "md",
  children,
}: ModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const mounted = useMounted();

  const requestClose = useCallback(() => {
    if (!isBusy) {
      onClose();
    }
  }, [isBusy, onClose]);

  /** Remember what opened us, move focus in, and give it back on close. */
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    openerRef.current = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    (first ?? panel)?.focus();

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = overflow;
      openerRef.current?.focus();
    };
  }, [isOpen]);

  if (!isOpen || !mounted || typeof document === "undefined") {
    return null;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      requestClose();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const panel = panelRef.current;
    if (!panel) {
      return;
    }

    const focusable = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((node) => node.offsetParent !== null || node === document.activeElement);

    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto p-0 sm:items-center sm:p-6"
      onKeyDown={handleKeyDown}
    >
      <div
        aria-hidden="true"
        onClick={requestClose}
        className="overlay-in fixed inset-0 bg-[rgb(12_16_28/0.45)] backdrop-blur-[2px]"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cx(
          "panel-in relative z-10 w-full rounded-t-4xl border border-line bg-canvas shadow-float",
          "sm:rounded-3xl",
          SIZES[size],
        )}
      >
        <div className="flex items-start justify-between gap-4 px-5 pb-4 pt-5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-section font-semibold text-ink">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-1 text-body text-muted">
                {description}
              </p>
            )}
          </div>

          <IconButton
            label="Close"
            size="sm"
            onClick={requestClose}
            disabled={isBusy}
            className="-mr-1 -mt-1"
          >
            <X aria-hidden="true" strokeWidth={2} className="h-4 w-4" />
          </IconButton>
        </div>

        {children && <div className="px-5 pb-5">{children}</div>}

        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

interface ConfirmDialogProps {
  isOpen: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  /** State plainly what will happen. Name the record; do not say "this item". */
  body: ReactNode;
  /** The verb, matching the button that opened it. "Delete doctor". */
  confirmLabel: string;
  cancelLabel?: string;
  /** Destructive by default — that is what confirmations are usually for. */
  tone?: "danger" | "primary";
  isBusy?: boolean;
  busyLabel?: string;
}

/**
 * The confirmation for a destructive or irreversible action.
 *
 * It says what will happen, in the words of the action that triggered it, and
 * it labels its confirm button with the verb rather than with "OK" — a dialog
 * whose buttons are OK and Cancel makes the reader reconstruct which one is
 * destructive from the sentence above them.
 */
export function ConfirmDialog({
  isOpen,
  onCancel,
  onConfirm,
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "danger",
  isBusy = false,
  busyLabel,
}: ConfirmDialogProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title={title}
      size="sm"
      isBusy={isBusy}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={isBusy}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === "danger" ? "dangerSolid" : "primary"}
            onClick={onConfirm}
            isBusy={isBusy}
            busyLabel={busyLabel}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-body text-ink-soft">{body}</p>
    </Modal>
  );
}
