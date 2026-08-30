import { ArrowRight, ClipboardList } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import AppointmentActions from "@/components/appointments/AppointmentActions";
import EditBookingForm from "@/components/appointments/EditBookingForm";
import RescheduleForm from "@/components/appointments/RescheduleForm";
import SendReminderPanel from "@/components/appointments/SendReminderPanel";
import {
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_STATUS_TONES,
  formatAppointmentDate,
} from "@/components/appointments/status";
import { buttonClasses } from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import ModuleLocked from "@/components/ui/ModuleLocked";
import PageHeader from "@/components/ui/PageHeader";
import StatusPill from "@/components/ui/StatusPill";
import { getAppointmentDetailForActor } from "@/lib/appointmentDetail";
import { editRefusal } from "@/lib/appointmentEditRules";
import {
  reminderRefusal,
  reminderTemplateValues,
} from "@/lib/appointmentReminderRules";
import {
  isAppointmentStatus,
  isTerminalAppointmentStatus,
} from "@/lib/appointmentRules";
import { listDoctorsForActor } from "@/lib/doctors";
import { MODULE_FEATURES, moduleLock } from "@/lib/features";
import { formatRupees } from "@/lib/money";
import { can, ScopeError } from "@/lib/rbac";
import { listTemplatesForActor } from "@/lib/whatsappTemplates";
import { requireActor, UnauthenticatedError } from "@/lib/session";

// One appointment — AP-6.
//
// The board answers "who is coming in?"; this answers "what is the story of
// this one?". That is why the patient's full snapshot, who booked it, when they
// arrived and what it became all live here and not in a list — a screen of
// names, numbers and addresses is a different disclosure from opening one
// person's booking.
//
// A ScopeError from the library becomes a 404 here, exactly as it becomes one
// in the API. Another organisation's appointment, an unknown id, and one in a
// clinic outside this user's roles all read the same.

interface AppointmentDetailPageProps {
  // Next 16 hands route params to the page as a promise.
  params: Promise<{ id: string }>;
}

/** One label-over-value pair. The label is muted; the value carries the weight. */
function Fact({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-micro font-semibold uppercase tracking-wider text-muted">
        {label}
      </p>
      <div className="mt-1 font-bold text-ink">{children}</div>
    </div>
  );
}

function NotSet() {
  return <span className="font-normal text-faint">Not recorded</span>;
}

function formatBookingTimestamp(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const day = d.getUTCDate();
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const month = months[d.getUTCMonth()];
    const hours = String(d.getUTCHours()).padStart(2, "0");
    const minutes = String(d.getUTCMinutes()).padStart(2, "0");
    return `${day} ${month} · ${hours}:${minutes}`;
  } catch {
    return dateStr;
  }
}

export default async function AppointmentDetailPage({
  params,
}: AppointmentDetailPageProps) {
  let actor;
  try {
    actor = await requireActor();
  } catch (error: unknown) {
    if (error instanceof UnauthenticatedError) {
      redirect("/login");
    }
    throw error;
  }

  const locked = await moduleLock(actor, MODULE_FEATURES.appointments);
  if (locked) {
    return <ModuleLocked title="Appointments" reason={locked} />;
  }

  const { id } = await params;

  let appointment;
  try {
    appointment = await getAppointmentDetailForActor(actor, id);
  } catch (error: unknown) {
    if (error instanceof ScopeError) {
      notFound();
    }
    throw error;
  }

  const clinicId = appointment.clinicId;
  const [
    canCheckIn,
    canConvert,
    canCancel,
    canReschedule,
    canReadRegistration,
    canSendMessage,
    canUpdate,
  ] = await Promise.all([
    can(actor, "appointment:checkin", clinicId),
    can(actor, "appointment:convert", clinicId),
    can(actor, "appointment:cancel", clinicId),
    can(actor, "appointment:reschedule", clinicId),
    can(actor, "registration:read", clinicId),
    // AP-8. Messaging a patient answers to `message:send`, not to any
    // appointment permission — booking all day does not confer texting.
    can(actor, "message:send", clinicId),
    // AP-9. Correcting the booking's details, and recording that the patient
    // confirmed — one key covers both.
    can(actor, "appointment:update", clinicId),
  ]);

  const isFinished = isTerminalAppointmentStatus(appointment.status);

  // AP-8. The reminder panel appears only for someone who may send and only
  // while the appointment is still ahead of the patient; inside it, the refusal
  // explains a booking that cannot be reminded (no patient record yet, or they
  // have already arrived). Templates are loaded only when they will be shown —
  // `listTemplatesForActor` refuses anyone who cannot send anywhere.
  const showReminder = canSendMessage && !isFinished;
  const reminderTemplates = showReminder ? await listTemplatesForActor(actor) : [];
  const reminderValues = reminderTemplateValues({
    patientName: appointment.name,
    patientCode: appointment.patientCode,
    clinicName: appointment.clinicName,
    doctorName: appointment.doctorName,
    department: appointment.doctorDepartment,
    serviceName: appointment.appointmentTypeName,
    slotDate: appointment.date,
    slotTime: appointment.startTime,
  });
  const reminderRefusalText = isAppointmentStatus(appointment.status)
    ? reminderRefusal(appointment.status, appointment.patientCode !== null)
    : "This appointment is in a state this version does not recognise.";
  // AP-9. The correction form appears only for someone who may edit AND only
  // while the booking is in a state a correction still means something in.
  // `editRefusal` is the same pure rule the endpoint enforces, so the form is
  // absent for exactly the appointments the server would refuse — most
  // importantly a converted one, whose details now belong to the registration.
  const canEditBooking = canUpdate && editRefusal(appointment.status) === null;

  // Only the doctors at this appointment's own clinic: a move may change the
  // doctor, but never the clinic — that would move the revenue with it.
  const doctors = await listDoctorsForActor(actor, { clinicId });

  return (
    <section className="w-full space-y-6">
      <PageHeader
        title={appointment.name}
        breadcrumbs={[
          { label: "Appointments", href: "/appointments" },
          { label: appointment.name },
        ]}
        description="Appointment details and patient context."
        meta={
          <>
            {formatAppointmentDate(appointment.date)} ·{" "}
            <span className="tnum font-semibold text-ink">
              {appointment.startTime}
            </span>
            {"–"}
            <span className="tnum font-semibold text-ink">
              {appointment.endTime}
            </span>
            {" · "}
            {appointment.clinicName}
          </>
        }
        actions={
          <StatusPill tone={APPOINTMENT_STATUS_TONES[appointment.status]}>
            {APPOINTMENT_STATUS_LABELS[appointment.status]}
          </StatusPill>
        }
      />

      {/* The visit this became. First, because on a converted appointment it is
          the thing the desk came here to find. */}
      {appointment.registration && (
        <Card isFlush className="rounded-3xl border border-ok-line bg-ok-bg p-5 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-body text-ok-ink">
              <ClipboardList
                aria-hidden="true"
                strokeWidth={1.75}
                className="h-4 w-4"
              />
              Registered as{" "}
              <span className="serial font-semibold">
                {appointment.registration.patientCode}
              </span>
            </p>
            {canReadRegistration && (
              <Link
                href={`/registration/${appointment.registration.id}`}
                className={buttonClasses("secondary", "sm")}
              >
                Open registration
                <ArrowRight
                  aria-hidden="true"
                  strokeWidth={1.75}
                  className="h-4 w-4"
                />
              </Link>
            )}
          </div>
        </Card>
      )}

      {/* The row that replaced this one, when it was moved. */}
      {appointment.rescheduledToId && (
        <Card isFlush className="rounded-3xl border border-line bg-canvas p-5 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-body text-muted">
              This booking was moved. The live one is on another slot.
            </p>
            <Link
              href={`/appointments/${appointment.rescheduledToId}`}
              className={buttonClasses("secondary", "sm")}
            >
              Open the new appointment
              <ArrowRight
                aria-hidden="true"
                strokeWidth={1.75}
                className="h-4 w-4"
              />
            </Link>
          </div>
        </Card>
      )}

      {/* What happens next */}
      {!isFinished && (canCheckIn || canConvert || canCancel || canUpdate) && (
        <section className="rounded-3xl border border-line bg-canvas p-5 sm:p-6 shadow-card">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-ink">What happens next</h2>
              <p className="mt-0.5 text-label text-muted">
                Move the appointment forward as the patient arrives.
              </p>
            </div>
            <AppointmentActions
              appointmentId={appointment.id}
              status={appointment.status}
              canCheckIn={canCheckIn}
              canConvert={canConvert}
              canCancel={canCancel}
              canConfirm={canUpdate}
              presentation="detail"
            />
          </div>
        </section>
      )}

      {/* Two-Column Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* Left Column (lg:col-span-7 xl:col-span-8) */}
        <div className="space-y-6 lg:col-span-7 xl:col-span-8">
          {/* The slot */}
          <section className="rounded-3xl border border-line bg-canvas p-6 sm:p-7 shadow-card">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold tracking-tight text-ink">
                  The slot
                </h2>
                <p className="mt-0.5 text-label text-muted">
                  What was booked, where, and with whom.
                </p>
              </div>
              {!isFinished && canReschedule && doctors.length > 0 && (
                <a
                  href="#reschedule-section"
                  className="rounded-xl border border-line bg-canvas px-3.5 py-1.5 text-label font-medium text-ink shadow-sm hover:bg-canvas-deep transition-colors"
                >
                  Move slot
                </a>
              )}
            </div>

            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              <Fact label="Doctor">
                <span className="text-body font-bold text-ink block">
                  {appointment.doctorName}
                </span>
                <p className="mt-0.5 text-label font-normal text-muted">
                  {appointment.doctorDepartment}
                </p>
              </Fact>

              <Fact label="Service">
                <span className="text-body font-bold text-ink block">
                  {appointment.appointmentTypeName}
                </span>
                <p className="mt-0.5 text-label font-normal tnum text-muted">
                  {appointment.durationMinutes} minutes
                </p>
              </Fact>

              <Fact label="Amount quoted">
                <span className="text-body font-bold text-ink tnum">
                  {formatRupees(appointment.amount)}
                </span>
              </Fact>

              <Fact label="Clinic">
                <span className="text-body font-bold text-ink">
                  {appointment.clinicName}
                </span>
              </Fact>

              <Fact label="Booked by">
                <span className="text-body font-normal text-ink">
                  {appointment.bookedByName ?? <NotSet />}
                </span>
              </Fact>

              <Fact label="Booked">
                <span className="text-body font-bold text-ink tnum">
                  {formatBookingTimestamp(appointment.createdAt)}
                </span>
              </Fact>

              {appointment.checkedInAt && (
                <Fact label="Arrived">
                  <span className="text-body font-bold text-ink tnum">
                    {new Date(appointment.checkedInAt).toLocaleString(undefined, {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  {appointment.checkedInByName && (
                    <p className="mt-0.5 text-label font-normal text-muted">
                      By {appointment.checkedInByName}
                    </p>
                  )}
                </Fact>
              )}

              {appointment.cancelledAt && (
                <Fact label="Cancelled">
                  <span className="text-body font-bold text-ink tnum">
                    {new Date(appointment.cancelledAt).toLocaleString(undefined, {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  {appointment.cancelledByName && (
                    <p className="mt-0.5 text-label font-normal text-muted">
                      By {appointment.cancelledByName}
                    </p>
                  )}
                  {appointment.cancellationReason && (
                    <p className="mt-0.5 text-label font-normal text-muted">
                      {appointment.cancellationReason}
                    </p>
                  )}
                </Fact>
              )}
            </div>
          </section>

          {/* The patient */}
          <section className="rounded-3xl border border-line bg-canvas p-6 sm:p-7 shadow-card">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold tracking-tight text-ink">
                  The patient
                </h2>
                <p className="mt-0.5 text-label text-muted">
                  {appointment.patientCode
                    ? "Linked to a record on the register."
                    : "Not registered yet — a Patient ID is created on conversion."}
                </p>
              </div>
              {canEditBooking && (
                <a
                  href="#correct-details-section"
                  className="rounded-xl border border-line bg-canvas px-3.5 py-1.5 text-label font-medium text-ink shadow-sm hover:bg-canvas-deep transition-colors"
                >
                  Edit details
                </a>
              )}
            </div>

            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              <Fact label="Name">
                <span className="text-body font-bold text-ink">{appointment.name}</span>
              </Fact>

              <Fact label="Mobile number">
                <span className="text-body font-bold text-ink tnum">{appointment.mobileNumber}</span>
              </Fact>

              <Fact label="Patient ID">
                {appointment.patientCode ? (
                  <span className="serial text-body font-bold text-ink">
                    {appointment.patientCode}
                  </span>
                ) : (
                  <span className="text-body font-normal text-faint">Not created yet</span>
                )}
              </Fact>

              <Fact label="Age">
                {appointment.age === null ? (
                  <NotSet />
                ) : (
                  <span className="text-body font-bold text-ink tnum">{appointment.age}</span>
                )}
              </Fact>

              <Fact label="Gender">
                {appointment.gender ? (
                  <span className="text-body font-bold text-ink">{appointment.gender}</span>
                ) : (
                  <NotSet />
                )}
              </Fact>

              <Fact label="City">
                {appointment.city ? (
                  <span className="text-body font-bold text-ink">{appointment.city}</span>
                ) : (
                  <NotSet />
                )}
              </Fact>

              <Fact label="Address" className="sm:col-span-2 lg:col-span-3">
                {appointment.address ? (
                  <span className="text-body font-bold text-ink">{appointment.address}</span>
                ) : (
                  <NotSet />
                )}
              </Fact>
            </div>
          </section>

          {/* Correct these details */}
          {canEditBooking && (
            <section id="correct-details-section" className="rounded-3xl border border-line bg-canvas p-6 sm:p-7 shadow-card">
              <div className="mb-6">
                <h2 className="text-lg font-bold tracking-tight text-ink">
                  Correct these details
                </h2>
                <p className="mt-0.5 text-label text-muted">
                  Fix what was written down when the booking was taken.
                </p>
              </div>

              <EditBookingForm
                appointmentId={appointment.id}
                initial={{
                  name: appointment.name,
                  mobileNumber: appointment.mobileNumber,
                  age: appointment.age === null ? "" : String(appointment.age),
                  gender: appointment.gender ?? "",
                  city: appointment.city ?? "",
                  address: appointment.address ?? "",
                  amount: appointment.amount,
                }}
              />
            </section>
          )}

          {/* Move to another slot */}
          {!isFinished && canReschedule && doctors.length > 0 && (
            <RescheduleForm
              appointmentId={appointment.id}
              clinicId={clinicId}
              appointmentTypeId={appointment.appointmentTypeId}
              appointmentTypeName={appointment.appointmentTypeName}
              currentDoctorId={appointment.doctorId}
              currentDate={appointment.date}
              doctors={doctors.map(({ id: doctorId, name, department }) => ({
                id: doctorId,
                name,
                department,
              }))}
            />
          )}
        </div>

        {/* Right Column (lg:col-span-5 xl:col-span-4) */}
        <div className="space-y-6 lg:col-span-5 xl:col-span-4">
          {/* Appointment summary */}
          <section className="rounded-3xl border border-line bg-canvas p-6 sm:p-7 shadow-card">
            <h2 className="text-lg font-bold tracking-tight text-ink">
              Appointment summary
            </h2>

            <div className="mt-5 divide-y divide-line/60 border-t border-line/60">
              <div className="flex items-center justify-between py-3 text-label">
                <span className="text-muted">Status</span>
                <span className="font-semibold text-ok-ink">
                  {APPOINTMENT_STATUS_LABELS[appointment.status]}
                </span>
              </div>
              <div className="flex items-center justify-between py-3 text-label">
                <span className="text-muted">Date</span>
                <span className="font-semibold text-ink">
                  {formatAppointmentDate(appointment.date)}
                </span>
              </div>
              <div className="flex items-center justify-between py-3 text-label">
                <span className="text-muted">Time</span>
                <span className="font-semibold text-ink tnum">
                  {appointment.startTime}–{appointment.endTime}
                </span>
              </div>
              <div className="flex items-center justify-between py-3 text-label">
                <span className="text-muted">Clinic</span>
                <span className="font-semibold text-ink">
                  {appointment.clinicName}
                </span>
              </div>
            </div>
          </section>

          {/* Remind the patient */}
          {showReminder && (
            <section className="rounded-3xl border border-line bg-canvas p-6 sm:p-7 shadow-card">
              <div className="mb-5">
                <h2 className="text-lg font-bold tracking-tight text-ink">
                  Remind the patient
                </h2>
                <p className="mt-0.5 text-label text-muted">
                  Use an approved WhatsApp template.
                </p>
              </div>
              <SendReminderPanel
                appointmentId={appointment.id}
                templates={reminderTemplates.map(({ id, name, body, footer }) => ({
                  id,
                  name,
                  body,
                  footer,
                }))}
                values={reminderValues}
                refusal={reminderRefusalText}
              />
            </section>
          )}
        </div>
      </div>
    </section>
  );
}
