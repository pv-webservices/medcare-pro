import type { ReactNode } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { cx } from "@/components/ui/cx";

/**
 * Every message these screens show, in one component.
 *
 * THE TONE PICKS THE ARIA ROLE, so a call site cannot get it wrong. A refusal
 * is `role="alert"` with `aria-live="assertive"` — the user has just pressed a
 * button and is waiting for the answer, and it must interrupt. A confirmation
 * or a piece of context is `role="status"` with `aria-live="polite"`, which
 * waits for a pause instead of talking over the reader.
 *
 * NO RAW SERVER TEXT. Callers pass a written sentence chosen by outcome; the
 * pages never hand a thrown error, a status line or a database message to this
 * component. That rule lives at the call sites, but it is written here because
 * this is where it would be broken.
 *
 * `action` is for the thing to DO about the message — resend the verification
 * email, create an account — kept on its own line so it is not mistaken for
 * part of the sentence.
 */

export type AuthAlertTone = "error" | "warning" | "success" | "info";

interface AuthAlertProps {
  tone: AuthAlertTone;
  /** Optional bold first line; the sentence goes in `children`. */
  title?: string;
  children: ReactNode;
  action?: ReactNode;
  id?: string;
  className?: string;
}

const TONES: Record<
  AuthAlertTone,
  { box: string; icon: typeof AlertCircle; mark: string }
> = {
  error: {
    box: "border-auth-alert-line bg-auth-alert-bg text-auth-alert-ink",
    icon: AlertCircle,
    mark: "text-auth-alert-mark",
  },
  warning: {
    box: "border-auth-warn-line bg-auth-warn-bg text-auth-warn-ink",
    icon: AlertTriangle,
    mark: "text-auth-warn-mark",
  },
  success: {
    box: "border-auth-ok-line bg-auth-ok-bg text-auth-ok-ink",
    icon: CheckCircle2,
    mark: "text-auth-ok-mark",
  },
  info: {
    box: "border-auth-line bg-auth-bg text-auth-ink-soft",
    icon: Info,
    mark: "text-auth-muted",
  },
};

export default function AuthAlert({
  tone,
  title,
  children,
  action,
  id,
  className,
}: AuthAlertProps) {
  const config = TONES[tone];
  const Icon = config.icon;
  const isUrgent = tone === "error" || tone === "warning";

  return (
    <div
      id={id}
      role={isUrgent ? "alert" : "status"}
      aria-live={isUrgent ? "assertive" : "polite"}
      className={cx(
        "flex gap-3 rounded-[14px] border p-3.5 text-[13.5px] leading-relaxed",
        config.box,
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        className={cx("mt-px h-[18px] w-[18px] shrink-0", config.mark)}
        strokeWidth={2}
      />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        <div className={title ? "mt-0.5" : undefined}>{children}</div>
        {action && <div className="mt-2.5">{action}</div>}
      </div>
    </div>
  );
}
