import Link from "next/link";
import type { DoctorSummary } from "@/lib/doctors";
import Table, { TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { Stethoscope } from "lucide-react";
import Avatar from "@/components/ui/Avatar";
import EmptyState from "@/components/ui/EmptyState";
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
      <EmptyState
        icon={<Stethoscope className="h-5 w-5" strokeWidth={2} />}
        title="No doctors yet"
        guidance="Add your first doctor to start managing availability and registering patients to them."
      />
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
                <TD isPrimary>
                  <span className="flex items-center gap-2.5">
                    <Avatar name={doctor.name} size="sm" />
                    <span className="min-w-0">
                      <Link
                        href={`/doctors/${doctor.id}`}
                        className="block truncate rounded transition-colors duration-150 hover:text-accent"
                      >
                        {doctor.name}
                      </Link>
                      {doctor.isOnLeaveToday && (
                        <span className="mt-1 block">
                          <OnLeaveBadge />
                        </span>
                      )}
                    </span>
                  </span>
                </TD>
                <TD>{doctor.department}</TD>
                {showClinic && <TD>{doctor.clinicName}</TD>}
                <TD isNumeric={Boolean(doctor.phone)}>
                  {doctor.phone ?? <span className="text-faint">—</span>}
                </TD>
                <TD align="end">
                  <Link
                    href={`/doctors/${doctor.id}`}
                    className={buttonClasses("secondary", "sm")}
                  >
                    Open profile
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
            <Card>
              <div className="flex items-start gap-3">
                <Avatar name={doctor.name} />
                <div className="min-w-0 flex-1">
                <Link
                  href={`/doctors/${doctor.id}`}
                  className="rounded font-medium text-ink transition-colors duration-150 hover:text-accent"
                >
                  {doctor.name}
                </Link>
                <p className="text-body text-muted">
                  {doctor.department}
                  {showClinic ? ` · ${doctor.clinicName}` : ""}
                </p>
                {doctor.phone && (
                  <p className="text-body tnum text-ink">{doctor.phone}</p>
                )}
                {doctor.isOnLeaveToday && (
                  <div className="mt-1.5">
                    <OnLeaveBadge />
                  </div>
                )}
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
