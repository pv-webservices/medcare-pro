import { ChevronRight } from "lucide-react";
import Link from "next/link";
import AppointmentActions from "@/components/appointments/AppointmentActions";
import {
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_STATUS_TONES,
  formatAppointmentDate,
} from "@/components/appointments/status";
import { buttonClasses } from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import StatusPill from "@/components/ui/StatusPill";
import Table, { TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import type { AppointmentListItem } from "@/lib/appointments";
import { formatRupees } from "@/lib/money";

/**
 * The appointment board — AP-6.
 *
 * THE TIME LEADS EVERY ROW. A board is read down the clock: the desk is asking
 * "who is next, and who is late?", not "who is here alphabetically". The
 * registration list leads with the Patient ID for the same kind of reason — it
 * is what the reader is matching against — and an appointment has no Patient ID
 * to lead with, because booking never mints one.
 *
 * The mobile number sits under the patient's name rather than in its own
 * column: it identifies the same person, it is what the desk rings when 09:30
 * has not arrived, and pairing them keeps the table inside a tablet's width.
 *
 * The date column appears only when the board is NOT pinned to one day. On a
 * day view it would repeat the same value down every row and buy nothing.
 */

interface AppointmentPermissions {
  canCheckIn: boolean;
  canConvert: boolean;
  canCancel: boolean;
  canCreate: boolean;
}

interface AppointmentsTableProps {
  appointments: readonly AppointmentListItem[];
  /** Hidden when the sidebar switcher has already pinned a single clinic. */
  showClinic: boolean;
  /** Hidden on a single-day board, where every row repeats the same date. */
  showDate: boolean;
  /** True when a filter is applied — changes the empty state's advice. */
  isFiltered: boolean;
  permissions: AppointmentPermissions;
}

function Dash() {
  return <span className="text-slate-400">—</span>;
}

function SlotTime({ start, end }: { start: string; end: string }) {
  return (
    <>
      <span className="font-bold tabular-nums text-slate-900">{start}</span>
      <p className="mt-0.5 text-xs tabular-nums text-slate-500">to {end}</p>
    </>
  );
}

function BookAction() {
  return (
    <Link href="/appointments/new" className={buttonClasses("commit", "md")}>
      Book Appointment
    </Link>
  );
}

export default function AppointmentsTable({
  appointments,
  showClinic,
  showDate,
  isFiltered,
  permissions,
}: AppointmentsTableProps) {
  if (appointments.length === 0) {
    return (
      <EmptyState
        title={isFiltered ? "No appointments match" : "Nothing booked"}
        guidance={
          isFiltered
            ? "Try another day, a different doctor, or show past outcomes as well."
            : "Book a patient into a doctor's slot to start filling the day."
        }
        action={
          // A filtered board is not empty, it is narrowed — the way out is the
          // controls already on screen, not a new booking.
          !isFiltered && permissions.canCreate ? <BookAction /> : undefined
        }
      />
    );
  }

  return (
    <>
      <div className="hidden lg:block">
        <Table caption="Appointments, with the slot, patient, doctor and what happens next">
          <THead>
            <TH>Slot</TH>
            {showDate && <TH>Date</TH>}
            <TH>Patient</TH>
            <TH>Doctor</TH>
            <TH>Service</TH>
            {showClinic && <TH>Clinic</TH>}
            <TH align="end">Amount</TH>
            <TH>Status</TH>
            <TH align="end">
              <span className="sr-only">Actions</span>
            </TH>
          </THead>

          <TBody>
            {appointments.map((appointment) => (
              <TR key={appointment.id}>
                <TD>
                  <SlotTime
                    start={appointment.startTime}
                    end={appointment.endTime}
                  />
                </TD>

                {showDate && (
                  <TD>
                    <span className="tabular-nums">
                      {formatAppointmentDate(appointment.date)}
                    </span>
                  </TD>
                )}

                <TD>
                  <Link
                    href={`/appointments/${appointment.id}`}
                    className="font-semibold text-slate-900 underline decoration-slate-200 underline-offset-4 hover:decoration-slate-900"
                  >
                    {appointment.name}
                  </Link>
                  <p className="mt-0.5 text-xs tabular-nums text-slate-500">
                    {appointment.mobileNumber}
                  </p>
                </TD>

                <TD>{appointment.doctorName || <Dash />}</TD>

                <TD>{appointment.appointmentTypeName}</TD>

                {showClinic && <TD>{appointment.clinicName}</TD>}

                <TD isNumeric className="font-bold text-slate-900">
                  {formatRupees(appointment.amount)}
                </TD>

                <TD>
                  <StatusPill tone={APPOINTMENT_STATUS_TONES[appointment.status]}>
                    {APPOINTMENT_STATUS_LABELS[appointment.status]}
                  </StatusPill>
                </TD>

                <TD align="end" className="py-2">
                  <div className="flex items-center justify-end gap-1">
                    <AppointmentActions
                      appointmentId={appointment.id}
                      status={appointment.status}
                      canCheckIn={permissions.canCheckIn}
                      canConvert={permissions.canConvert}
                      canCancel={permissions.canCancel}
                    />
                    <Link
                      href={`/appointments/${appointment.id}`}
                      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:text-slate-900"
                    >
                      <span className="sr-only">
                        Open {appointment.name}&apos;s appointment
                      </span>
                      <ChevronRight
                        aria-hidden="true"
                        strokeWidth={1.75}
                        className="h-4 w-4"
                      />
                    </Link>
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>

      {/* Below a laptop: the same fields, stacked. The time keeps its lead
          position and its weight — it is still what the board is read by. */}
      <ul className="grid gap-3 lg:hidden">
        {appointments.map((appointment) => (
          <li key={appointment.id}>
            <Card isFlush className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-lg font-bold tabular-nums text-slate-900">
                    {appointment.startTime}
                    <span className="ml-2 text-xs font-normal text-slate-500">
                      to {appointment.endTime}
                    </span>
                  </p>
                  <Link
                    href={`/appointments/${appointment.id}`}
                    className="mt-1 block font-semibold text-slate-900 underline decoration-slate-200 underline-offset-4 hover:decoration-slate-900"
                  >
                    {appointment.name}
                  </Link>
                  <p className="mt-0.5 text-xs tabular-nums text-slate-500">
                    {appointment.mobileNumber}
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  <p className="font-bold tabular-nums text-slate-900">
                    {formatRupees(appointment.amount)}
                  </p>
                  <div className="mt-1.5">
                    <StatusPill
                      tone={APPOINTMENT_STATUS_TONES[appointment.status]}
                    >
                      {APPOINTMENT_STATUS_LABELS[appointment.status]}
                    </StatusPill>
                  </div>
                </div>
              </div>

              <p className="mt-2 text-xs text-slate-500">
                {appointment.appointmentTypeName}
                {appointment.doctorName ? ` · ${appointment.doctorName}` : ""}
                {showClinic ? ` · ${appointment.clinicName}` : ""}
                {showDate ? ` · ${formatAppointmentDate(appointment.date)}` : ""}
              </p>

              <AppointmentActions
                appointmentId={appointment.id}
                status={appointment.status}
                canCheckIn={permissions.canCheckIn}
                canConvert={permissions.canConvert}
                canCancel={permissions.canCancel}
                className="mt-3"
              />
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
