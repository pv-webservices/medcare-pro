import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cx } from "@/components/ui/cx";

/**
 * A single number and what it means. The dashboard's KPI row and the Reports
 * summary both use this, so a figure is read the same way wherever it appears.
 *
 * THE NUMBER IS THE OBJECT. It gets the largest type on the card, tabular
 * figures so a column of them aligns, and the darkest ink. The label above it
 * is quiet; the delta below it is quieter still. A card where the icon or the
 * border is the first thing seen has its priorities backwards.
 *
 * THE DELTA IS NOT COLOUR-CODED BY SIGN ALONE. Up is not automatically good —
 * rising "pending tasks" is bad — so the caller says which direction is
 * positive with `isUpGood`, and the arrow carries the direction for anyone who
 * cannot separate the hues.
 */

interface MetricCardProps {
  label: string;
  /** Pre-formatted for display: "1,843", "Rs 4,52,300". */
  value: string;
  /** Percentage change against the previous period. Omit when there is none. */
  delta?: number;
  /** Whether an increase is a good outcome for this metric. */
  isUpGood?: boolean;
  /** What the delta is measured against. "vs last month". */
  deltaCaption?: string;
  /** A Lucide icon, rendered in a quiet tile. */
  icon?: ReactNode;
  /** A footnote under the number — scope, denominator, anything qualifying. */
  footnote?: ReactNode;
  /** Soft colour used only by the icon tile. */
  tone?: "violet" | "blue" | "cyan" | "green" | "orange";
  className?: string;
}

const ICON_TONES = {
  violet: "bg-accent-soft text-accent-soft-ink",
  blue: "bg-info-bg text-info-ink",
  cyan: "bg-cyan-50 text-cyan-700",
  green: "bg-ok-bg text-ok-ink",
  orange: "bg-warn-bg text-warn-ink",
} as const;

export default function MetricCard({
  label,
  value,
  delta,
  isUpGood = true,
  deltaCaption,
  icon,
  footnote,
  tone = "violet",
  className,
}: MetricCardProps) {
  const hasDelta = typeof delta === "number" && Number.isFinite(delta);
  const isUp = hasDelta && delta > 0;
  const isFlat = hasDelta && delta === 0;
  const isGood = isUp === isUpGood;

  return (
    <div
      className={cx(
        "h-full min-h-[116px] rounded-2xl border border-line bg-canvas p-4 shadow-card sm:p-5 dashboard-card-hover",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-label font-medium text-muted">{label}</p>
        {icon && (
          <span
            aria-hidden="true"
            className={cx(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
              ICON_TONES[tone],
            )}
          >
            {icon}
          </span>
        )}
      </div>

      <p className="tnum mt-2.5 text-metric font-semibold text-ink">{value}</p>

      {(hasDelta || footnote) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-meta">
          {hasDelta && (
            <span
              className={cx(
                "inline-flex items-center gap-1 font-semibold",
                isFlat ? "text-muted" : isGood ? "text-ok-ink" : "text-alert-ink",
              )}
            >
              {!isFlat &&
                (isUp ? (
                  <ArrowUpRight aria-hidden="true" strokeWidth={2.5} className="h-3.5 w-3.5" />
                ) : (
                  <ArrowDownRight aria-hidden="true" strokeWidth={2.5} className="h-3.5 w-3.5" />
                ))}
              <span className="tnum">
                {isUp ? "+" : ""}
                {delta}%
              </span>
            </span>
          )}
          {deltaCaption && <span className="text-muted">{deltaCaption}</span>}
          {footnote && <span className="text-muted">{footnote}</span>}
        </div>
      )}
    </div>
  );
}
