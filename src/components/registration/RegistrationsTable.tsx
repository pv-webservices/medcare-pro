import Link from "next/link";
import { ChevronDown, ChevronLeft, ChevronRight, Users } from "lucide-react";
import EmptyState from "@/components/ui/EmptyState";
import { formatRupees } from "@/lib/money";
import { VISIT_TYPE_LABELS, type RegistrationRecord } from "@/lib/registrations";

interface RegistrationsTableProps {
  registrations: readonly RegistrationRecord[];
  showClinic: boolean;
  isFiltered: boolean;
  canCreate: boolean;
  total?: number;
  page?: number;
  lastPage?: number;
  firstOnPage?: number;
  lastOnPage?: number;
  hrefFor?: (page: number) => string;
}

function formatVisitDate(date: string): string {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function Dash() {
  return <span className="text-muted/60">—</span>;
}

export default function RegistrationsTable({
  registrations,
  showClinic,
  isFiltered,
  canCreate,
  total = registrations.length,
  page = 1,
  lastPage = 1,
  firstOnPage = 1,
  lastOnPage = registrations.length,
  hrefFor,
}: RegistrationsTableProps) {
  if (registrations.length === 0) {
    return (
      <EmptyState
        icon={<Users className="h-5 w-5" strokeWidth={2} />}
        title={isFiltered ? "No registrations match these filters" : "No registrations yet"}
        guidance={
          isFiltered
            ? "Try a different name or phone number, or widen the date range."
            : "Register a patient to start recording visits and revenue."
        }
        action={
          !isFiltered && canCreate ? (
            <Link
              href="/registration/new"
              className="inline-flex items-center rounded-xl bg-accent px-4 py-2 font-semibold text-body text-white shadow-cta hover:bg-accent-strong transition-colors"
            >
              New registration
            </Link>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Desktop & Tablet Table Surface */}
      <div className="hidden md:block overflow-hidden rounded-3xl border border-line bg-canvas shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left text-body">
            <thead>
              <tr className="border-b border-line bg-canvas-deep/40">
                <th
                  scope="col"
                  className="py-4 pl-6 pr-4 text-micro font-semibold uppercase tracking-wider text-muted"
                >
                  Patient ID
                </th>
                <th
                  scope="col"
                  className="py-4 px-4 text-micro font-semibold uppercase tracking-wider text-muted"
                >
                  Patient
                </th>
                <th
                  scope="col"
                  className="py-4 px-4 text-micro font-semibold uppercase tracking-wider text-muted"
                >
                  Doctor
                </th>
                <th
                  scope="col"
                  className="py-4 px-4 text-micro font-semibold uppercase tracking-wider text-muted"
                >
                  Department
                </th>
                {showClinic && (
                  <th
                    scope="col"
                    className="py-4 px-4 text-micro font-semibold uppercase tracking-wider text-muted"
                  >
                    Clinic
                  </th>
                )}
                <th
                  scope="col"
                  className="py-4 px-4 text-micro font-semibold uppercase tracking-wider text-muted"
                >
                  Visit
                </th>
                <th
                  scope="col"
                  className="py-4 px-4 text-right text-micro font-semibold uppercase tracking-wider text-muted"
                >
                  Amount
                </th>
                <th
                  scope="col"
                  className="py-4 pl-2 pr-6 text-right text-micro font-semibold uppercase tracking-wider text-muted"
                >
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {registrations.map((registration) => (
                <tr
                  key={registration.id}
                  className="group transition-colors duration-150 hover:bg-canvas-deep/30"
                >
                  <td className="py-4 pl-6 pr-4 align-middle">
                    <Link
                      href={`/registration/${registration.id}`}
                      className="serial font-bold text-ink hover:text-accent transition-colors"
                    >
                      {registration.patientCode}
                    </Link>
                  </td>

                  <td className="py-4 px-4 align-middle">
                    <div className="space-y-0.5">
                      <Link
                        href={`/registration/${registration.id}`}
                        className="block font-bold text-ink hover:text-accent transition-colors"
                      >
                        {registration.patientName}
                      </Link>
                      <p className="text-label text-muted tnum font-normal">
                        {registration.mobileNumber}
                      </p>
                    </div>
                  </td>

                  <td className="py-4 px-4 align-middle text-body text-ink">
                    {registration.doctorName ?? <Dash />}
                  </td>

                  <td className="py-4 px-4 align-middle text-body text-ink">
                    {registration.department}
                  </td>

                  {showClinic && (
                    <td className="py-4 px-4 align-middle text-body text-ink">
                      {registration.clinicName}
                    </td>
                  )}

                  <td className="py-4 px-4 align-middle">
                    <div className="space-y-0.5">
                      <span className="block text-body text-ink font-normal whitespace-nowrap">
                        {formatVisitDate(registration.visitDate)}
                      </span>
                      <p className="text-label text-muted tnum font-normal">
                        {registration.visitTime}
                      </p>
                    </div>
                  </td>

                  <td className="py-4 px-4 align-middle text-right text-body font-bold text-ink tnum whitespace-nowrap">
                    {formatRupees(registration.amount)}
                  </td>

                  <td className="py-4 pl-2 pr-6 align-middle text-right">
                    <Link
                      href={`/registration/${registration.id}`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:text-ink hover:bg-canvas-deep transition-colors"
                      aria-label={`Open registration ${registration.patientCode}`}
                    >
                      <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile Card List */}
      <ul className="grid gap-3 md:hidden">
        {registrations.map((registration) => (
          <li key={registration.id}>
            <div className="rounded-3xl border border-line bg-canvas p-5 shadow-card space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Link
                    href={`/registration/${registration.id}`}
                    className="font-bold text-ink hover:text-accent transition-colors text-body"
                  >
                    {registration.patientName}
                  </Link>
                  <p className="mt-0.5 text-label text-muted">
                    <span className="serial font-semibold">{registration.patientCode}</span>
                    <span className="tnum ml-2">· {registration.mobileNumber}</span>
                  </p>
                </div>
                <span className="font-bold text-ink tnum text-body">
                  {formatRupees(registration.amount)}
                </span>
              </div>

              <p className="text-label text-muted">
                {registration.department}
                {registration.doctorName ? ` · ${registration.doctorName}` : ""}
                {showClinic ? ` · ${registration.clinicName}` : ""}
              </p>

              <div className="flex items-center justify-between pt-1 text-label text-muted">
                <span className="tnum">
                  {formatVisitDate(registration.visitDate)} {registration.visitTime}
                </span>
                <Link
                  href={`/registration/${registration.id}`}
                  className="inline-flex items-center gap-1 font-semibold text-accent"
                >
                  View
                  <ChevronRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {/* Pagination / Count Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-canvas px-6 py-3.5 shadow-card">
        <p className="text-label text-muted">
          Showing {firstOnPage} to {lastOnPage} of {total}{" "}
          {total === 1 ? "registration" : "registrations"}
        </p>

        <div className="flex items-center gap-1.5">
          {page > 1 && hrefFor ? (
            <Link
              href={hrefFor(page - 1)}
              aria-label="Previous page"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-canvas text-ink hover:bg-canvas-deep transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </Link>
          ) : (
            <button
              type="button"
              disabled
              aria-label="Previous page"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-canvas text-muted opacity-50 cursor-not-allowed"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}

          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white font-semibold text-label shadow-sm">
            {page}
          </span>

          {page < lastPage && hrefFor ? (
            <Link
              href={hrefFor(page + 1)}
              aria-label="Next page"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-canvas text-ink hover:bg-canvas-deep transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </Link>
          ) : (
            <button
              type="button"
              disabled
              aria-label="Next page"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-canvas text-muted opacity-50 cursor-not-allowed"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 rounded-xl border border-line bg-canvas px-3 py-1.5 text-label font-medium text-muted shadow-sm">
          <span>10 per page</span>
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
