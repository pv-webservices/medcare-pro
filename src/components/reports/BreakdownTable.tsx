import { formatRupees } from "@/lib/money";
import type { BreakdownRow } from "@/lib/reports";

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
}

export default function BreakdownTable({
  title,
  entityLabel,
  rows,
  emptyMessage,
}: BreakdownTableProps) {
  return (
    <section aria-labelledby={`breakdown-${entityLabel.toLowerCase()}`} className="viz-root">
      <h2
        id={`breakdown-${entityLabel.toLowerCase()}`}
        className="mb-3 text-lg font-semibold"
      >
        {title}
      </h2>

      {rows.length === 0 ? (
        <p className="rounded border border-black/15 px-4 py-6 text-center text-sm text-black/60 dark:border-white/20 dark:text-white/60">
          {emptyMessage}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-black/15 dark:border-white/20">
                <th scope="col" className="py-2 pr-4 text-sm font-medium">
                  {entityLabel}
                </th>
                <th scope="col" className="py-2 pr-4 text-right text-sm font-medium">
                  Registrations
                </th>
                <th scope="col" className="py-2 pr-4 text-right text-sm font-medium">
                  Revenue
                </th>
                <th scope="col" className="w-32 py-2 text-sm font-medium">
                  Share
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id ?? "unassigned"}
                  className="border-b border-black/10 dark:border-white/10"
                >
                  <td className="py-3 pr-4 text-sm">{row.name}</td>
                  <td className="py-3 pr-4 text-right text-sm tabular-nums">
                    {row.registrations}
                  </td>
                  <td className="py-3 pr-4 text-right text-sm font-medium tabular-nums">
                    {formatRupees(row.revenue)}
                  </td>
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      <div
                        aria-hidden="true"
                        className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/10 dark:bg-white/15"
                      >
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.max(row.sharePercent, 0)}%`,
                            backgroundColor: "var(--viz-series)",
                          }}
                        />
                      </div>
                      <span className="w-11 shrink-0 text-right text-xs tabular-nums text-black/55 dark:text-white/55">
                        {row.sharePercent.toFixed(1)}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
