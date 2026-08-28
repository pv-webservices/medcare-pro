import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";

/**
 * The one badge in this app. Tones map to MEANING, never to taste:
 *
 *   ok       delivered, active, verified, paid, completed
 *   warn     queued, pending, unread, waiting, no-show risk
 *   alert    failed, blocked, rejected, cancelled
 *   info     scheduled, informational state with no action attached
 *   neutral  a fact (visit type, role name, "updated")
 *   accent   the current selection, and "confirmed"
 *
 * THE DOT IS NOT DECORATION. It carries the state for anyone who cannot
 * separate the tones by hue, so the pill never relies on colour alone — and the
 * word inside it is always the state in full, never an abbreviation.
 *
 * The pill is flat and bordered. Nothing in a table row should look pressable
 * unless it is; a status is a label.
 */

export type StatusTone = "ok" | "warn" | "alert" | "info" | "neutral" | "accent";

const TONES: Record<StatusTone, { pill: string; dot: string }> = {
  ok: { pill: "border-ok-line bg-ok-bg text-ok-ink", dot: "bg-ok-mark" },
  warn: { pill: "border-warn-line bg-warn-bg text-warn-ink", dot: "bg-warn-mark" },
  alert: {
    pill: "border-alert-line bg-alert-bg text-alert-ink",
    dot: "bg-alert-mark",
  },
  info: { pill: "border-info-line bg-info-bg text-info-ink", dot: "bg-info-mark" },
  neutral: { pill: "border-line bg-pill text-pill-ink", dot: "bg-pill-ink" },
  accent: {
    pill: "border-accent-soft bg-accent-soft text-accent-soft-ink",
    dot: "bg-accent",
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
        "text-meta font-medium whitespace-nowrap",
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
