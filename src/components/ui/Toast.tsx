"use client";

import { X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cx } from "@/components/ui/cx";

/**
 * Write confirmations and failures.
 *
 * A toast reports the outcome of something the reader just did, in the same
 * words as the control that did it — "Add Clinic" produces "Clinic added". It
 * is never used for ambient news; that is what Notifications are for.
 *
 * Successes clear themselves. Failures do not: a failed save is something the
 * front desk has to act on, and a message that disappears before it is read is
 * the same as no message. That asymmetry is the whole point of the component.
 */

export type ToastTone = "ok" | "alert";

interface ToastMessage {
  id: number;
  tone: ToastTone;
  /** What happened. "Clinic added." */
  title: string;
  /** What to do about it, when there is something to do. */
  detail?: string;
}

type ShowToast = (toast: Omit<ToastMessage, "id">) => void;

const ToastContext = createContext<ShowToast | null>(null);

const AUTO_DISMISS_MS = 5000;

export function useToast(): ShowToast {
  const show = useContext(ToastContext);

  if (!show) {
    throw new Error("useToast must be used inside a ToastProvider.");
  }

  return show;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly ToastMessage[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback<ShowToast>(
    (toast) => {
      const id = (nextId.current += 1);
      setToasts((current) => [...current, { ...toast, id }]);

      if (toast.tone === "ok") {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), AUTO_DISMISS_MS),
        );
      }
    },
    [dismiss],
  );

  // Timers outlive the toasts they belong to if the tree unmounts mid-flight.
  const timersRef = timers;
  useEffect(() => {
    const pending = timersRef.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, [timersRef]);

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}

      <div
        // Bottom of the screen: on a front-desk tablet the top of the page is
        // where the work is, and a banner there covers it.
        className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col gap-2 sm:inset-x-auto sm:right-6 sm:w-96"
      >
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const TONES: Record<ToastTone, string> = {
  ok: "border-ok/40",
  alert: "border-alert/50",
};

const DOTS: Record<ToastTone, string> = {
  ok: "bg-ok",
  alert: "bg-alert",
};

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastMessage;
  onDismiss: (id: number) => void;
}) {
  return (
    <div
      role={toast.tone === "alert" ? "alert" : "status"}
      aria-live={toast.tone === "alert" ? "assertive" : "polite"}
      className={cx(
        "pointer-events-auto flex items-start gap-3 rounded-lg border bg-surface",
        "px-4 py-3 shadow-pop",
        TONES[toast.tone],
      )}
    >
      <span
        aria-hidden="true"
        className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", DOTS[toast.tone])}
      />

      <div className="min-w-0 flex-1">
        <p className="text-body font-medium text-ink">{toast.title}</p>
        {toast.detail && (
          <p className="mt-0.5 text-label text-muted">{toast.detail}</p>
        )}
      </div>

      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="-mr-1 -mt-1 rounded-md p-1.5 text-muted hover:bg-surface-sunk hover:text-ink"
      >
        <span className="sr-only">Dismiss</span>
        <X aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
      </button>
    </div>
  );
}
