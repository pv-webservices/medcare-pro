import type { ReactNode } from "react";
import { formatRupees } from "@/lib/money";
import type { BreakdownRow } from "@/lib/reports";
import Card from "@/components/ui/Card";

/**
 * Revenue split by clinic or by doctor — PRD §6.6 (FR-6.4).
 *
 * A table, not a chart. Past roughly seven classes adjacent colours blur, and a
 * clinic group can have more doctors than that; a table also gives the exact
 * rupee figure, which is the thing an owner actually needs from this section.
 *
 * The share bar is a single-hue magnitude mark — one series, one colour, never
 * darker-where-bigger, which would double-encode length as hue.
 */

interface BreakdownTableProps {
  title: string;
  /** What the first column holds, e.g. "Clinic" or "Doctor". */
  entityLabel: string;
  rows: readonly BreakdownRow[];
  emptyMessage: string;
  /**
   * Controls for this section, right-aligned beside the heading. Absent when
   * the viewer's role has nothing to do here — see ExportCsvLink.
   */
  actions?: ReactNode;
}

export default function BreakdownTable({
  title,
  entityLabel,
  rows,
  emptyMessage,
  actions,
}: BreakdownTableProps) {
  return (
    <section aria-labelledby={`breakdown-${entityLabel.toLowerCase()}`} className="viz-root pt-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2
          id={`breakdown-${entityLabel.toLowerCase()}`}
          className="text-lg font-bold text-ink"
        >
          {title}
        </h2>
        {actions}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl bg-canvas px-6 py-8 text-center shadow-neu-raised-sm">
          <p className="text-sm font-medium text-muted">
            {emptyMessage}
          </p>
        </div>
      ) : (
        <Card isFlush>
          <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line bg-canvas-deep/50">
                <th scope="col" className="py-3 pl-4 pr-4 text-sm font-semibold text-ink">
                  {entityLabel}
                </th>
                <th scope="col" className="py-3 pr-4 text-right text-sm font-semibold text-ink">
                  Registrations
                </th>
                <th scope="col" className="py-3 pr-4 text-right text-sm font-semibold text-ink">
                  Revenue
                </th>
                <th scope="col" className="w-32 py-3 pr-4 text-sm font-semibold text-ink">
                  Share
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id ?? "unassigned"}
                  className="border-b border-line last:border-0 hover:bg-canvas-deep/50 transition-colors"
                >
                  <td className="py-3 pl-4 pr-4 text-sm font-medium text-ink">{row.name}</td>
                  <td className="py-3 pr-4 text-right text-sm tabular-nums text-muted">
                    {row.registrations}
                  </td>
                  <td className="py-3 pr-4 text-right text-sm font-medium tabular-nums text-ink">
                    {formatRupees(row.revenue)}
                  </td>
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-3">
                      <div
                        aria-hidden="true"
                        className="h-2 flex-1 overflow-hidden rounded-full bg-canvas-deep"
                      >
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.max(row.sharePercent, 0)}%`,
                            backgroundColor: "var(--viz-series)",
                          }}
                        />
                      </div>
                      <span className="w-11 shrink-0 text-right text-xs font-medium tabular-nums text-muted">
                        {row.sharePercent.toFixed(1)}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </Card>
      )}
    </section>
  );
}
