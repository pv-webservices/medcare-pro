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
  ok: { pill: "border-ok/35 bg-ok/10 text-ok", dot: "bg-ok" },
  warn: { pill: "border-warn/35 bg-warn/10 text-warn", dot: "bg-warn" },
  alert: { pill: "border-alert/35 bg-alert/10 text-alert", dot: "bg-alert" },
  neutral: {
    pill: "border-line bg-surface-sunk text-muted",
    dot: "bg-muted",
  },
  accent: {
    pill: "border-accent/40 bg-accent/12 text-ink",
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
        "text-micro font-semibold uppercase",
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
