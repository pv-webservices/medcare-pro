import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";

/**
 * The one badge in this app. Tones map to meaning, never to taste — see the
 * status vocabulary table in .claude/skills/admin-dashboard-ui.
 *
 *   ok       delivered, active, verified
 *   warn     queued, pending, unread
 *   alert    failed, blocked, rejected
 *   neutral  a fact with no action attached (visit type, role name)
 *   accent   the current selection — the only tone tied to clinic identity
 *
 * The dot is not decoration: it carries the state for anyone who cannot
 * separate the tones by hue, so the pill never relies on colour alone.
 */

export type StatusTone = "ok" | "warn" | "alert" | "neutral" | "accent";

const TONES: Record<StatusTone, { pill: string; dot: string }> = {
  ok: { pill: "border-emerald-200 bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  warn: { pill: "border-amber-200 bg-amber-50 text-amber-700", dot: "bg-amber-500" },
  alert: { pill: "border-red-200 bg-red-50 text-red-700", dot: "bg-red-500" },
  neutral: {
    pill: "border-slate-200 bg-slate-50 text-slate-600",
    dot: "bg-slate-400",
  },
  accent: {
    pill: "border-violet-200 bg-violet-50 text-violet-700",
    dot: "bg-violet-500",
  },
};

interface StatusPillProps {
  tone?: StatusTone;
  /** Drop the dot where the pill is already unambiguous, e.g. a lone tag. */
  hasDot?: boolean;
  className?: string;
  children: ReactNode;
}

export default function StatusPill({
  tone = "neutral",
  hasDot = true,
  className,
  children,
}: StatusPillProps) {
  const { pill, dot } = TONES[tone];

  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5",
        "text-[10px] font-bold uppercase tracking-wider",
        pill,
        className,
      )}
    >
      {hasDot && (
        <span aria-hidden="true" className={cx("h-1.5 w-1.5 rounded-full", dot)} />
      )}
      {children}
    </span>
  );
}
