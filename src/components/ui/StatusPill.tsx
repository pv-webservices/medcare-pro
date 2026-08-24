import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";

/**
 * The one badge in this app. Tones map to meaning, never to taste — see the
 * status vocabulary table in .claude/skills/admin-dashboard-ui.
 *
 *   ok       delivered, active, verified, paid, completed
 *   warn     queued, pending, unread, waiting
 *   alert    failed, blocked, rejected, cancelled
 *   neutral  a fact with no action attached (visit type, role name, "updated")
 *   accent   the current selection, and "confirmed" — the one tone tied to the
 *            house accent rather than to a status hue
 *
 * THE PILL IS FLAT. Everything raised on this canvas is something you can press,
 * and a pill is a label. Giving it depth would promise an interaction that is
 * not there — which on a soft surface is a genuinely misleading signal, not a
 * stylistic quibble.
 *
 * The dot is not decoration: it carries the state for anyone who cannot
 * separate the tones by hue, so the pill never relies on colour alone.
 */

export type StatusTone = "ok" | "warn" | "alert" | "neutral" | "accent";

const TONES: Record<StatusTone, { pill: string; dot: string }> = {
  ok: { pill: "bg-ok-bg text-ok-ink", dot: "bg-ok-mark" },
  warn: { pill: "bg-warn-bg text-warn-ink", dot: "bg-warn-mark" },
  alert: { pill: "bg-alert-bg text-alert-ink", dot: "bg-alert-mark" },
  neutral: { pill: "bg-pill text-pill-ink", dot: "bg-pill-ink" },
  accent: { pill: "bg-accent-soft text-accent-soft-ink", dot: "bg-accent" },
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
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1",
        "text-meta font-semibold whitespace-nowrap",
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
