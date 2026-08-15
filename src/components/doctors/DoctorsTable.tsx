import Link from "next/link";
import type { DoctorSummary } from "@/lib/doctors";

/**
 * Doctor list — PRD §6.4 (FR-4.1).
 *
 * Same list pattern as the clinics table, so staff recognise it once and reuse
 * that knowledge. "On leave" is the only coloured element: it is the one thing
 * on this screen that changes what a receptionist does next.
 */

interface DoctorsTableProps {
  doctors: readonly DoctorSummary[];
  /** Hidden when the list is already filtered to a single clinic. */
  showClinic: boolean;
}

function OnLeaveBadge() {
  return (
    <span className="inline-block rounded bg-amber-600/15 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-400">
      On leave today
    </span>
  );
}

export default function DoctorsTable({ doctors, showClinic }: DoctorsTableProps) {
  if (doctors.length === 0) {
    return (
      <div className="rounded border border-black/15 px-4 py-8 text-center dark:border-white/20">
        <p className="mb-1 font-medium">No doctors yet</p>
        <p className="text-sm text-black/60 dark:text-white/60">
          Add a doctor to start setting their availability and registering
          patients to them.
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
                Phone
              </th>
              <th scope="col" className="py-2 text-right text-sm font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {doctors.map((doctor) => (
              <tr
                key={doctor.id}
                className="border-b border-black/10 dark:border-white/10"
              >
                <td className="py-3 pr-4">
                  <Link href={`/doctors/${doctor.id}`} className="font-medium underline">
                    {doctor.name}
                  </Link>
                  {doctor.isOnLeaveToday && (
                    <div className="mt-1">
                      <OnLeaveBadge />
                    </div>
                  )}
                </td>
                <td className="py-3 pr-4 text-sm">{doctor.department}</td>
                {showClinic && (
                  <td className="py-3 pr-4 text-sm">{doctor.clinicName}</td>
                )}
                <td className="py-3 pr-4 text-sm tabular-nums">
                  {doctor.phone ?? (
                    <span className="text-black/40 dark:text-white/40">—</span>
                  )}
                </td>
                <td className="py-3 text-right">
                  <Link
                    href={`/doctors/${doctor.id}`}
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

      <ul className="grid gap-3 md:hidden">
        {doctors.map((doctor) => (
          <li
            key={doctor.id}
            className="rounded border border-black/15 px-4 py-3 dark:border-white/20"
          >
            <Link href={`/doctors/${doctor.id}`} className="font-medium underline">
              {doctor.name}
            </Link>
            <p className="mt-0.5 text-sm text-black/55 dark:text-white/55">
              {doctor.department}
              {showClinic ? ` · ${doctor.clinicName}` : ""}
            </p>
            {doctor.phone && (
              <p className="mt-0.5 text-sm tabular-nums">{doctor.phone}</p>
            )}
            {doctor.isOnLeaveToday && (
              <div className="mt-2">
                <OnLeaveBadge />
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
