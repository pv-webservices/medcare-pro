import Link from "next/link";
import type { ClinicSummary } from "@/lib/clinics";

/**
 * Clinic list — PRD §6.2 (FR-2.2), showing each clinic's doctor and patient counts.
 *
 * This is the list pattern the later stages reuse for doctors and registrations:
 * a table on tablet and up, stacked cards below, counts rendered as the largest
 * text in the row so they read at a glance.
 */

interface ClinicsTableProps {
  clinics: readonly ClinicSummary[];
}

const COUNT_CLASS = "text-xl font-semibold tabular-nums";
const COUNT_LABEL_CLASS = "text-xs text-black/55 dark:text-white/55";

export default function ClinicsTable({ clinics }: ClinicsTableProps) {
  if (clinics.length === 0) {
    return (
      <div className="rounded border border-black/15 px-4 py-8 text-center dark:border-white/20">
        <p className="mb-1 font-medium">No clinics yet</p>
        <p className="text-sm text-black/60 dark:text-white/60">
          Add your first clinic to start adding doctors and registering patients.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Tablet and up. Wrapped so a narrow viewport scrolls the table, not the page. */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-black/15 dark:border-white/20">
              <th scope="col" className="py-2 pr-4 text-sm font-medium">
                Clinic
              </th>
              <th scope="col" className="py-2 pr-4 text-sm font-medium">
                City
              </th>
              <th scope="col" className="py-2 pr-4 text-right text-sm font-medium">
                Doctors
              </th>
              <th scope="col" className="py-2 pr-4 text-right text-sm font-medium">
                Patients
              </th>
              <th scope="col" className="py-2 text-right text-sm font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {clinics.map((clinic) => (
              <tr
                key={clinic.id}
                className="border-b border-black/10 dark:border-white/10"
              >
                <td className="py-3 pr-4">
                  <Link href={`/clinics/${clinic.id}`} className="font-medium underline">
                    {clinic.name}
                  </Link>
                  {clinic.address && (
                    <p className="mt-0.5 text-sm text-black/55 dark:text-white/55">
                      {clinic.address}
                    </p>
                  )}
                </td>
                <td className="py-3 pr-4 text-sm">
                  {clinic.city ?? <span className="text-black/40 dark:text-white/40">—</span>}
                </td>
                <td className={`py-3 pr-4 text-right ${COUNT_CLASS}`}>
                  {clinic.doctorCount}
                </td>
                <td className={`py-3 pr-4 text-right ${COUNT_CLASS}`}>
                  {clinic.patientCount}
                </td>
                <td className="py-3 text-right">
                  <Link
                    href={`/clinics/${clinic.id}`}
                    className="inline-flex min-h-11 items-center rounded border border-black/20 px-4 text-sm font-medium dark:border-white/25"
                  >
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Below tablet: the same data as stacked cards. */}
      <ul className="grid gap-3 md:hidden">
        {clinics.map((clinic) => (
          <li
            key={clinic.id}
            className="rounded border border-black/15 px-4 py-3 dark:border-white/20"
          >
            <Link href={`/clinics/${clinic.id}`} className="font-medium underline">
              {clinic.name}
            </Link>
            {clinic.city && (
              <p className="mt-0.5 text-sm text-black/55 dark:text-white/55">
                {clinic.city}
              </p>
            )}
            <div className="mt-3 flex gap-6">
              <div>
                <p className={COUNT_CLASS}>{clinic.doctorCount}</p>
                <p className={COUNT_LABEL_CLASS}>Doctors</p>
              </div>
              <div>
                <p className={COUNT_CLASS}>{clinic.patientCount}</p>
                <p className={COUNT_LABEL_CLASS}>Patients</p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
