import { CalendarDays } from "lucide-react";
import Link from "next/link";
import AppointmentActions from "@/components/appointments/AppointmentActions";
import {
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_STATUS_TONES,
  formatAppointmentDate,
} from "@/components/appointments/status";
import { buttonClasses } from "@/components/ui/Button";
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
  /** AP-9. `appointment:update`, which also governs correcting a booking. */
  canConfirm: boolean;
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
  /** Optional view context to render truthful headings and empty states */
  dateView?: {
    view?: "day" | "upcoming";
    date: string;
    isToday: boolean;
  };
  permissions: AppointmentPermissions;
}

function Dash() {
  return <span className="text-faint">—</span>;
}

function SlotTime({ start, end }: { start: string; end: string }) {
  return (
    <>
      <span className="tnum text-body font-semibold text-ink">{start}</span>
      <p className="tnum mt-0.5 text-meta text-muted">to {end}</p>
    </>
  );
}

function BookAction() {
  return (
    <Link href="/appointments/new" className={buttonClasses("primary", "md")}>
      Book appointment
    </Link>
  );
}

export default function AppointmentsTable({
  appointments,
  showClinic,
  showDate,
  isFiltered,
  dateView,
  permissions,
}: AppointmentsTableProps) {
  const isUpcoming = dateView?.view === "upcoming" || dateView?.date === "";

  const scheduleTitle = isUpcoming
    ? "Upcoming schedule"
    : dateView?.isToday
      ? "Today's schedule"
      : "Day's schedule";

  const scheduleSubtitle = isUpcoming
    ? "Upcoming appointments across available days."
    : dateView?.isToday
      ? "Appointments scheduled for today."
      : "Appointments scheduled for this day.";

  if (appointments.length === 0) {
    return (
      <div className="rounded-3xl border border-line bg-canvas shadow-card overflow-hidden">
        <div className="border-b border-line px-5 py-4 sm:px-6">
          <h2 className="text-section font-semibold text-ink">{scheduleTitle}</h2>
          <p className="mt-0.5 text-label text-muted">{scheduleSubtitle}</p>
        </div>

        <div className="p-6 sm:p-12">
          <EmptyState
            isBare
            icon={<CalendarDays className="h-5 w-5" strokeWidth={2} />}
            title={
              isFiltered
                ? "No appointments match these filters"
                : isUpcoming
                  ? "No upcoming appointments"
                  : dateView?.isToday
                    ? "Nothing booked for today"
                    : "Nothing booked for this day"
            }
            guidance={
              isFiltered
                ? "Try another doctor, status, or adjust the history filter."
                : isUpcoming
                  ? "Book a patient into a doctor's slot to schedule visits."
                  : "Book a patient into a doctor's slot to start filling the day."
            }
            action={!isFiltered && permissions.canCreate ? <BookAction /> : undefined}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-line bg-canvas shadow-card overflow-hidden">
      {/* 4. SURFACE HEADING */}
      <div className="border-b border-line px-5 py-4 sm:px-6">
        <h2 className="text-section font-semibold text-ink">{scheduleTitle}</h2>
        <p className="mt-0.5 text-label text-muted">{scheduleSubtitle}</p>
      </div>

      {/* 5. DESKTOP TABLE */}
      <div className="hidden xl:block">
        <Table
          caption="Appointments, with the slot, patient, doctor and what happens next"
          className="border-0 shadow-none rounded-none"
        >
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
                    <span className="tnum whitespace-nowrap text-ink-soft">
                      {formatAppointmentDate(appointment.date)}
                    </span>
                  </TD>
                )}

                <TD>
                  <Link
                    href={`/appointments/${appointment.id}`}
                    className="rounded font-medium text-ink transition-colors duration-150 hover:text-accent"
                  >
                    {appointment.name}
                  </Link>
                  <p className="tnum mt-0.5 text-meta text-muted">
                    {appointment.mobileNumber}
                  </p>
                </TD>

                <TD>
                  <span className="font-medium text-ink">
                    {appointment.doctorName || <Dash />}
                  </span>
                </TD>

                <TD>
                  <span className="text-ink-soft">{appointment.appointmentTypeName}</span>
                </TD>

                {showClinic && (
                  <TD>
                    <span className="text-ink-soft">{appointment.clinicName}</span>
                  </TD>
                )}

                <TD isNumeric>
                  {formatRupees(appointment.amount)}
                </TD>

                <TD>
                  <StatusPill tone={APPOINTMENT_STATUS_TONES[appointment.status]}>
                    {APPOINTMENT_STATUS_LABELS[appointment.status]}
                  </StatusPill>
                </TD>

                <TD align="end" className="py-2.5">
                  <AppointmentActions
                    appointmentId={appointment.id}
                    status={appointment.status}
                    canCheckIn={permissions.canCheckIn}
                    canConvert={permissions.canConvert}
                    canCancel={permissions.canCancel}
                    canConfirm={permissions.canConfirm}
                    presentation="compact"
                  />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>

      {/* 10. TABLET / MOBILE STACKED CARDS */}
      <ul className="divide-y divide-line xl:hidden">
        {appointments.map((appointment) => (
          <li key={appointment.id} className="p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="tnum text-heading font-semibold text-ink">
                  {appointment.startTime}
                  <span className="ml-2 text-meta font-normal text-muted">
                    to {appointment.endTime}
                  </span>
                </p>
                <Link
                  href={`/appointments/${appointment.id}`}
                  className="mt-1 block rounded font-medium text-ink transition-colors duration-150 hover:text-accent"
                >
                  {appointment.name}
                </Link>
                <p className="tnum mt-0.5 text-meta text-muted">
                  {appointment.mobileNumber}
                </p>
              </div>

              <div className="shrink-0 text-right">
                <p className="tnum text-body font-semibold text-ink">
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

            <p className="mt-2 text-meta text-muted">
              {appointment.appointmentTypeName}
              {appointment.doctorName ? ` · ${appointment.doctorName}` : ""}
              {showClinic ? ` · ${appointment.clinicName}` : ""}
              {showDate ? ` · ${formatAppointmentDate(appointment.date)}` : ""}
            </p>

            <div className="mt-3.5 pt-3 border-t border-line/60 flex items-center justify-end">
              <AppointmentActions
                appointmentId={appointment.id}
                status={appointment.status}
                canCheckIn={permissions.canCheckIn}
                canConvert={permissions.canConvert}
                canCancel={permissions.canCancel}
                canConfirm={permissions.canConfirm}
                presentation="compact"
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
