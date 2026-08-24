"use client";

import { AlertTriangle, Check, X } from "lucide-react";
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
 *
 * It is the only surface in the app that uses `shadow-neu-float`. A toast has
 * to read as being in front of the page rather than part of it, and the raised
 * shadow every card already wears cannot say that — so this one gets real
 * elevation on top of the neumorphic pair.
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
        className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col gap-3 sm:inset-x-auto sm:right-6 sm:w-96"
      >
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * The icon tile carries the tone, so the message is not relying on a colour a
 * reader may not distinguish — a tick and a warning triangle are different
 * shapes before they are different hues.
 */
const TILES: Record<ToastTone, string> = {
  ok: "bg-accent text-accent-ink",
  alert: "bg-alert-bg text-alert-ink",
};

const ICONS: Record<ToastTone, typeof Check> = {
  ok: Check,
  alert: AlertTriangle,
};

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastMessage;
  onDismiss: (id: number) => void;
}) {
  const Icon = ICONS[toast.tone];

  return (
    <div
      role={toast.tone === "alert" ? "alert" : "status"}
      aria-live={toast.tone === "alert" ? "assertive" : "polite"}
      className="pointer-events-auto flex items-start gap-3 rounded-3xl bg-canvas px-4 py-4 shadow-neu-float"
    >
      <span
        aria-hidden="true"
        className={cx(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
          TILES[toast.tone],
        )}
      >
        <Icon strokeWidth={2.5} className="h-4 w-4" />
      </span>

      <div className="min-w-0 flex-1 pt-1">
        <p className="text-body font-semibold text-ink">{toast.title}</p>
        {toast.detail && (
          <p className="mt-0.5 text-label font-medium text-muted">{toast.detail}</p>
        )}
      </div>

      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="-mr-1 rounded-full p-2 text-muted transition-shadow duration-200 hover:text-ink hover:shadow-neu-raised-sm active:shadow-neu-pressed"
      >
        <span className="sr-only">Dismiss</span>
        <X aria-hidden="true" strokeWidth={2} className="h-4 w-4" />
      </button>
    </div>
  );
}
