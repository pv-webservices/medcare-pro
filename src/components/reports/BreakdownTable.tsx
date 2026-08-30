import type { ReactNode } from "react";
import { formatRupees } from "@/lib/money";
import type { BreakdownRow } from "@/lib/reports";

interface BreakdownTableProps {
  title: string;
  /** What the first column holds, e.g. "Clinic" or "Doctor". */
  entityLabel: string;
  rows: readonly BreakdownRow[];
  emptyMessage: string;
  actions?: ReactNode;
}

function getDoctorInitials(name: string): string {
  if (name.toLowerCase().includes("not assigned") || name === "—") return "NA";
  const clean = name.replace(/^Dr\.?\s+/i, "").trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export default function BreakdownTable({
  title,
  entityLabel,
  rows,
  emptyMessage,
  actions,
}: BreakdownTableProps) {
  const isDoctor = entityLabel.toLowerCase() === "doctor";
  const totalRegistrations = rows.reduce((sum, r) => sum + r.registrations, 0);
  const totalRevenue = rows.reduce((sum, r) => sum + Number(r.revenue), 0);

  return (
    <section
      aria-labelledby={`breakdown-${entityLabel.toLowerCase()}`}
      className="rounded-3xl border border-line bg-canvas p-6 sm:p-7 shadow-card flex flex-col justify-between"
    >
      <div>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h2
            id={`breakdown-${entityLabel.toLowerCase()}`}
            className="text-lg font-bold tracking-tight text-ink"
          >
            {title}
          </h2>
          {actions}
        </div>

        {rows.length === 0 ? (
          <div className="rounded-2xl border border-line bg-canvas-deep/30 px-6 py-10 text-center">
            <p className="text-body text-muted">{emptyMessage}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-line">
                  <th
                    scope="col"
                    className="pb-3 text-micro font-semibold uppercase tracking-wider text-muted"
                  >
                    {entityLabel}
                  </th>
                  <th
                    scope="col"
                    className="pb-3 text-right text-micro font-semibold uppercase tracking-wider text-muted"
                  >
                    Registrations
                  </th>
                  <th
                    scope="col"
                    className="pb-3 text-right text-micro font-semibold uppercase tracking-wider text-muted"
                  >
                    Revenue
                  </th>
                  <th
                    scope="col"
                    className="pb-3 pl-4 text-left text-micro font-semibold uppercase tracking-wider text-muted"
                  >
                    Share
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {rows.map((row) => {
                  const initials = isDoctor ? getDoctorInitials(row.name) : "";
                  const isUnassigned = row.id === null || row.name.toLowerCase().includes("not assigned");

                  return (
                    <tr
                      key={row.id ?? "unassigned"}
                      className="transition-colors duration-150 hover:bg-canvas-deep/40"
                    >
                      <td className="py-3.5 pr-3 text-body font-medium text-ink">
                        {isDoctor ? (
                          <div className="flex items-center gap-2.5">
                            <div
                              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-micro font-bold ${
                                isUnassigned
                                  ? "bg-slate-100 text-slate-600"
                                  : "bg-[#DCFCE7] text-[#15803D]"
                              }`}
                            >
                              {initials}
                            </div>
                            <span className="truncate">{row.name}</span>
                          </div>
                        ) : (
                          <span>{row.name}</span>
                        )}
                      </td>
                      <td className="tnum py-3.5 px-3 text-right text-body text-ink">
                        {row.registrations}
                      </td>
                      <td className="tnum py-3.5 px-3 text-right text-body font-bold text-ink">
                        {formatRupees(row.revenue)}
                      </td>
                      <td className="py-3.5 pl-4">
                        <div className="flex items-center gap-3">
                          <div
                            aria-hidden="true"
                            className="h-2 w-14 sm:w-20 overflow-hidden rounded-full bg-canvas-deep"
                          >
                            <div
                              className="h-full rounded-full bg-accent"
                              style={{
                                width: `${Math.min(Math.max(row.sharePercent, 0), 100)}%`,
                              }}
                            />
                          </div>
                          <span className="w-12 shrink-0 text-right text-label font-medium tnum text-muted">
                            {row.sharePercent.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {rows.length > 0 && (
                <tfoot>
                  <tr className="border-t border-line font-bold">
                    <td className="py-3.5 pr-3 text-body font-bold text-ink">
                      Total
                    </td>
                    <td className="tnum py-3.5 px-3 text-right text-body font-bold text-ink">
                      {totalRegistrations}
                    </td>
                    <td className="tnum py-3.5 px-3 text-right text-body font-bold text-ink">
                      {formatRupees(totalRevenue)}
                    </td>
                    <td className="py-3.5 pl-4">
                      <div className="flex items-center gap-3">
                        <div
                          aria-hidden="true"
                          className="h-2 w-14 sm:w-20 overflow-hidden rounded-full bg-canvas-deep"
                        >
                          <div className="h-full w-full rounded-full bg-accent" />
                        </div>
                        <span className="w-12 shrink-0 text-right text-label font-bold tnum text-ink">
                          100.0%
                        </span>
                      </div>
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
