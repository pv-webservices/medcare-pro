import Link from "next/link";
import {
  REPORT_PERIODS,
  REPORT_PERIOD_LABELS,
  type ReportPeriod,
} from "@/lib/reportPeriods";

/**
 * Daily / Weekly / Monthly / Yearly — PRD §6.6 (FR-6.1).
 *
 * Links, not a client-side control: the selection belongs in the URL so a
 * chosen view can be bookmarked, shared or reloaded, and there is no state here
 * worth shipping JavaScript for.
 *
 * One filter row above everything it scopes — the KPIs, the graph and both
 * breakdowns all re-render against the same choice. The clinic half of the
 * scope stays with the sidebar switcher, as in every other module.
 */

interface PeriodSelectorProps {
  selected: ReportPeriod;
}

export default function PeriodSelector({ selected }: PeriodSelectorProps) {
  return (
    <nav aria-label="Report period">
      <ul className="flex flex-wrap items-center gap-1 rounded-2xl border border-line bg-canvas p-1 shadow-card">
        {REPORT_PERIODS.map((period) => {
          const isSelected = period === selected;

          return (
            <li key={period}>
              <Link
                href={`/reports?period=${period}`}
                aria-current={isSelected ? "page" : undefined}
                className={`inline-flex min-h-9 items-center justify-center rounded-xl px-4 py-1.5 text-label font-medium transition-all duration-150 ${
                  isSelected
                    ? "bg-accent text-accent-ink font-semibold shadow-sm"
                    : "text-muted hover:bg-canvas-deep hover:text-ink"
                }`}
              >
                {REPORT_PERIOD_LABELS[period]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
