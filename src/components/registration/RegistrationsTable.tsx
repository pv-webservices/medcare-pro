import Link from "next/link";
import { formatRupees } from "@/lib/money";
import { VISIT_TYPE_LABELS, type RegistrationRecord } from "@/lib/registrations";

/**
 * Registration list — PRD §6.3 (FR-3.2, FR-3.3).
 *
 * Same list pattern as the doctors and clinics tables, so staff recognise it
 * once and reuse that knowledge. The Patient ID leads each row because it is
 * what a patient reads out over the phone.
 */

interface RegistrationsTableProps {
  registrations: readonly RegistrationRecord[];
  /** Hidden when the list is already filtered to a single clinic. */
  showClinic: boolean;
  /** True when a search or filter is applied — changes the empty state's advice. */
  isFiltered: boolean;
}

function formatVisitDate(date: string): string {
  // Parsed as UTC to match how the date is stored, so the label cannot slip a day.
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function Dash() {
  return <span className="text-black/40 dark:text-white/40">—</span>;
}

/**
 * Only follow-ups are badged. A new patient is the default case, so labelling
 * both would put a coloured chip on every row and mark nothing out.
 */
function FollowUpBadge() {
  return (
    <span className="inline-block rounded bg-sky-600/15 px-2 py-0.5 text-xs font-medium text-sky-800 dark:text-sky-300">
      {VISIT_TYPE_LABELS.FOLLOW_UP}
    </span>
  );
}

export default function RegistrationsTable({
  registrations,
  showClinic,
  isFiltered,
}: RegistrationsTableProps) {
  if (registrations.length === 0) {
    return (
      <div className="rounded border border-black/15 px-4 py-8 text-center dark:border-white/20">
        <p className="mb-1 font-medium">
          {isFiltered ? "No registrations match" : "No registrations yet"}
        </p>
        <p className="text-sm text-black/60 dark:text-white/60">
          {isFiltered
            ? "Try a different name or phone number, or widen the date range."
            : "Register a patient to start recording visits and revenue."}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-black/15 dark:border-white/20">
              <th scope="col" className="py-2 pr-4 text-sm font-medium">
                Patient ID
              </th>
              <th scope="col" className="py-2 pr-4 text-sm font-medium">
                Patient
              </th>
              <th scope="col" className="py-2 pr-4 text-sm font-medium">
                Mobile
              </th>
              <th scope="col" className="py-2 pr-4 text-sm font-medium">
                Doctor
              </th>
              <th scope="col" className="py-2 pr-4 text-sm font-medium">
                Department
              </th>
              {showClinic && (
                <th scope="col" className="py-2 pr-4 text-sm font-medium">
                  Clinic
                </th>
              )}
              <th scope="col" className="py-2 pr-4 text-sm font-medium">
                Visit date
              </th>
              <th scope="col" className="py-2 text-right text-sm font-medium">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {registrations.map((registration) => (
              <tr
                key={registration.id}
                className="border-b border-black/10 dark:border-white/10"
              >
                <td className="py-3 pr-4">
                  <Link
                    href={`/registration/${registration.id}`}
                    className="font-medium tabular-nums underline"
                  >
                    {registration.patientCode}
                  </Link>
                </td>
                <td className="py-3 pr-4 text-sm">
                  {registration.patientName}
                  {registration.visitType === "FOLLOW_UP" && (
                    <div className="mt-1">
                      <FollowUpBadge />
                    </div>
                  )}
                </td>
                <td className="py-3 pr-4 text-sm tabular-nums">
                  {registration.mobileNumber}
                </td>
                <td className="py-3 pr-4 text-sm">
                  {registration.doctorName ?? <Dash />}
                </td>
                <td className="py-3 pr-4 text-sm">{registration.department}</td>
                {showClinic && (
                  <td className="py-3 pr-4 text-sm">{registration.clinicName}</td>
                )}
                <td className="py-3 pr-4 text-sm tabular-nums">
                  {formatVisitDate(registration.visitDate)}
                  <span className="ml-1 text-black/55 dark:text-white/55">
                    {registration.visitTime}
                  </span>
                </td>
                <td className="py-3 text-right text-sm font-medium tabular-nums">
                  {formatRupees(registration.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="grid gap-3 md:hidden">
        {registrations.map((registration) => (
          <li
            key={registration.id}
            className="rounded border border-black/15 px-4 py-3 dark:border-white/20"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link
                  href={`/registration/${registration.id}`}
                  className="font-medium underline"
                >
                  {registration.patientName}
                </Link>
                <p className="mt-0.5 text-sm tabular-nums text-black/55 dark:text-white/55">
                  {registration.patientCode} · {registration.mobileNumber}
                </p>
              </div>
              <p className="shrink-0 font-medium tabular-nums">
                {formatRupees(registration.amount)}
              </p>
            </div>
            <p className="mt-1 text-sm text-black/55 dark:text-white/55">
              {registration.department}
              {registration.doctorName ? ` · ${registration.doctorName}` : ""}
              {showClinic ? ` · ${registration.clinicName}` : ""}
            </p>
            <p className="mt-0.5 text-sm tabular-nums">
              {formatVisitDate(registration.visitDate)} {registration.visitTime}
            </p>
            {registration.visitType === "FOLLOW_UP" && (
              <div className="mt-2">
                <FollowUpBadge />
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
