import Link from "next/link";
import type { DoctorSummary } from "@/lib/doctors";
import Table, { TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import Card from "@/components/ui/Card";
import StatusPill from "@/components/ui/StatusPill";
import { buttonClasses } from "@/components/ui/Button";

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
    <StatusPill tone="warn" hasDot={false}>
      On leave today
    </StatusPill>
  );
}

export default function DoctorsTable({ doctors, showClinic }: DoctorsTableProps) {
  if (doctors.length === 0) {
    return (
      <div className="rounded-3xl border border-slate-100 bg-white px-6 py-12 text-center shadow-sm">
        <p className="mb-1 text-lg font-bold text-slate-900">No doctors yet</p>
        <p className="text-sm text-slate-500">
          Add a doctor to start setting their availability and registering
          patients to them.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="hidden md:block">
        <Table caption="Doctors across all clinics">
          <THead>
            <TH>Doctor</TH>
            <TH>Department</TH>
            {showClinic && <TH>Clinic</TH>}
            <TH>Phone</TH>
            <TH align="end">
              <span className="sr-only">Actions</span>
            </TH>
          </THead>
          <TBody>
            {doctors.map((doctor) => (
              <TR key={doctor.id}>
                <TD>
                  <div className="flex flex-col gap-1.5 items-start">
                    <Link
                      href={`/doctors/${doctor.id}`}
                      className="font-semibold text-slate-900 underline decoration-slate-200 underline-offset-4 hover:decoration-slate-900"
                    >
                      {doctor.name}
                    </Link>
                    {doctor.isOnLeaveToday && <OnLeaveBadge />}
                  </div>
                </TD>
                <TD>{doctor.department}</TD>
                {showClinic && <TD>{doctor.clinicName}</TD>}
                <TD isNumeric={Boolean(doctor.phone)}>
                  {doctor.phone ?? <span className="text-slate-400">—</span>}
                </TD>
                <TD align="end" className="py-2">
                  <Link
                    href={`/doctors/${doctor.id}`}
                    className={buttonClasses("secondary", "sm")}
                  >
                    Open
                  </Link>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>

      <ul className="grid gap-3 md:hidden">
        {doctors.map((doctor) => (
          <li key={doctor.id}>
            <Card isFlush={false}>
              <div className="flex flex-col gap-1.5 items-start">
                <Link
                  href={`/doctors/${doctor.id}`}
                  className="font-semibold text-slate-900 underline decoration-slate-200 underline-offset-4 hover:decoration-slate-900"
                >
                  {doctor.name}
                </Link>
                <p className="text-sm text-slate-500">
                  {doctor.department}
                  {showClinic ? ` · ${doctor.clinicName}` : ""}
                </p>
                {doctor.phone && (
                  <p className="text-sm tabular-nums text-slate-700">{doctor.phone}</p>
                )}
                {doctor.isOnLeaveToday && (
                  <div className="mt-1">
                    <OnLeaveBadge />
                  </div>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
