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
    <section aria-labelledby={`breakdown-${entityLabel.toLowerCase()}`} className="viz-root">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2
          id={`breakdown-${entityLabel.toLowerCase()}`}
          className="text-heading font-semibold text-ink"
        >
          {title}
        </h2>
        {actions}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-3xl border border-line bg-canvas px-6 py-10 text-center shadow-card">
          <p className="text-body text-muted">{emptyMessage}</p>
        </div>
      ) : (
        <Card isFlush>
          <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line bg-canvas-deep">
                <th scope="col" className="px-4 py-2.5 text-micro font-semibold uppercase text-muted">
                  {entityLabel}
                </th>
                <th scope="col" className="px-4 py-2.5 text-right text-micro font-semibold uppercase text-muted">
                  Registrations
                </th>
                <th scope="col" className="px-4 py-2.5 text-right text-micro font-semibold uppercase text-muted">
                  Revenue
                </th>
                <th scope="col" className="w-36 px-4 py-2.5 text-micro font-semibold uppercase text-muted">
                  Share
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id ?? "unassigned"}
                  className="border-b border-line transition-colors duration-150 last:border-0 hover:bg-canvas-deep"
                >
                  <td className="px-4 py-3 text-body font-medium text-ink">{row.name}</td>
                  <td className="tnum px-4 py-3 text-right text-body text-muted">
                    {row.registrations}
                  </td>
                  <td className="tnum px-4 py-3 text-right text-body font-medium text-ink">
                    {formatRupees(row.revenue)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div
                        aria-hidden="true"
                        className="h-1.5 flex-1 overflow-hidden rounded-full bg-canvas-deep"
                      >
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.max(row.sharePercent, 0)}%`,
                            backgroundColor: "var(--viz-series)",
                          }}
                        />
                      </div>
                      <span className="w-11 shrink-0 text-right text-meta font-medium tnum text-muted">
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
