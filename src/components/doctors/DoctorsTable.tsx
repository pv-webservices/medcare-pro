import Link from "next/link";
import { ChevronDown, ChevronLeft, ChevronRight, Stethoscope } from "lucide-react";
import type { DoctorSummary } from "@/lib/doctors";
import StatusPill from "@/components/ui/StatusPill";
import EmptyState from "@/components/ui/EmptyState";

interface DoctorsTableProps {
  doctors: readonly DoctorSummary[];
  /** Hidden when the list is already filtered to a single clinic. */
  showClinic: boolean;
}

function OnLeaveBadge() {
  return (
    <StatusPill tone="warn" hasDot={false}>
      On leave today
    </StatusPill>
  );
}

function getDoctorInitials(name: string): string {
  const clean = name.replace(/^Dr\.?\s+/i, "").trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "DR";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export default function DoctorsTable({ doctors, showClinic }: DoctorsTableProps) {
  if (doctors.length === 0) {
    return (
      <EmptyState
        icon={<Stethoscope className="h-5 w-5" strokeWidth={2} />}
        title="No doctors yet"
        guidance="Add your first doctor to start managing availability and registering patients to them."
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Table Surface */}
      <div className="overflow-hidden rounded-3xl border border-line bg-canvas shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] border-collapse text-left text-body">
            <thead>
              <tr className="border-b border-line bg-canvas-deep/40">
                <th
                  scope="col"
                  className="py-4 pl-6 pr-4 text-micro font-semibold uppercase tracking-wider text-muted"
                >
                  Doctor
                </th>
                <th
                  scope="col"
                  className="py-4 px-4 text-micro font-semibold uppercase tracking-wider text-muted"
                >
                  Department
                </th>
                <th
                  scope="col"
                  className="py-4 px-4 text-micro font-semibold uppercase tracking-wider text-muted"
                >
                  Clinic
                </th>
                <th
                  scope="col"
                  className="py-4 px-4 text-micro font-semibold uppercase tracking-wider text-muted"
                >
                  Phone
                </th>
                <th
                  scope="col"
                  className="py-4 pl-4 pr-6 text-right text-micro font-semibold uppercase tracking-wider text-muted"
                >
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {doctors.map((doctor) => {
                const initials = getDoctorInitials(doctor.name);

                return (
                  <tr
                    key={doctor.id}
                    className="transition-colors duration-150 hover:bg-canvas-deep/30"
                  >
                    <td className="py-4 pl-6 pr-4">
                      <div className="flex items-center gap-3.5">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#EEF2FF] text-[#4F46E5] font-bold text-label">
                          {initials}
                        </div>
                        <div className="min-w-0">
                          <Link
                            href={`/doctors/${doctor.id}`}
                            className="block font-bold text-ink hover:text-accent transition-colors truncate"
                          >
                            {doctor.name}
                          </Link>
                          {doctor.isOnLeaveToday && (
                            <div className="mt-1">
                              <OnLeaveBadge />
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-4 text-body text-ink">
                      {doctor.department}
                    </td>
                    <td className="py-4 px-4 text-body text-ink">
                      {doctor.clinicName}
                    </td>
                    <td className="py-4 px-4 tnum text-body text-ink">
                      {doctor.phone || <span className="text-muted/60">—</span>}
                    </td>
                    <td className="py-4 pl-4 pr-6 text-right">
                      <Link
                        href={`/doctors/${doctor.id}`}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-canvas px-4 py-2 text-label font-semibold text-accent shadow-sm hover:bg-canvas-deep hover:text-accent-strong transition-colors"
                      >
                        <span>Open profile</span>
                        <ChevronRight className="h-4 w-4" aria-hidden="true" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination & Info Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-canvas px-6 py-3.5 shadow-card">
        <p className="text-label text-muted">
          Showing 1 to {doctors.length} of {doctors.length}{" "}
          {doctors.length === 1 ? "doctor" : "doctors"}
        </p>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled
            aria-label="Previous page"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-canvas text-muted opacity-50 cursor-not-allowed"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white font-semibold text-label shadow-sm">
            1
          </span>
          <button
            type="button"
            disabled
            aria-label="Next page"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-canvas text-muted opacity-50 cursor-not-allowed"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-1.5 rounded-xl border border-line bg-canvas px-3 py-1.5 text-label font-medium text-muted shadow-sm">
          <span>10 per page</span>
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
