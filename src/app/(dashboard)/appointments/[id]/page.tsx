import { ArrowRight, ClipboardList } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import AppointmentActions from "@/components/appointments/AppointmentActions";
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
import Panel from "@/components/ui/Panel";
import StatusPill from "@/components/ui/StatusPill";
import { getAppointmentDetailForActor } from "@/lib/appointmentDetail";
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
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <div className="mt-1 text-slate-900">{children}</div>
    </div>
  );
}

function NotSet() {
  return <span className="text-slate-400">Not recorded</span>;
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
  ] = await Promise.all([
    can(actor, "appointment:checkin", clinicId),
    can(actor, "appointment:convert", clinicId),
    can(actor, "appointment:cancel", clinicId),
    can(actor, "appointment:reschedule", clinicId),
    can(actor, "registration:read", clinicId),
    // AP-8. Messaging a patient answers to `message:send`, not to any
    // appointment permission — booking all day does not confer texting.
    can(actor, "message:send", clinicId),
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
  // Only the doctors at this appointment's own clinic: a move may change the
  // doctor, but never the clinic — that would move the revenue with it.
  const doctors = await listDoctorsForActor(actor, { clinicId });

  return (
    <section className="mx-auto w-full max-w-[1100px] animate-in fade-in duration-500 space-y-5">
      <PageHeader
        title={appointment.name}
        back={{ href: "/appointments", label: "Back to appointments" }}
        meta={
          <>
            {formatAppointmentDate(appointment.date)} at{" "}
            <span className="font-bold tabular-nums text-slate-900">
              {appointment.startTime}
            </span>
            {" – "}
            <span className="tabular-nums">{appointment.endTime}</span>
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
        <Card isFlush className="border-emerald-200 bg-emerald-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm text-emerald-800">
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
                Open Registration
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
        <Card isFlush className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-600">
              This booking was moved. The live one is on another slot.
            </p>
            <Link
              href={`/appointments/${appointment.rescheduledToId}`}
              className={buttonClasses("secondary", "sm")}
            >
              Open the New Appointment
              <ArrowRight
                aria-hidden="true"
                strokeWidth={1.75}
                className="h-4 w-4"
              />
            </Link>
          </div>
        </Card>
      )}

      {!isFinished && (canCheckIn || canConvert || canCancel) && (
        <Panel
          title="What happens next"
          description="Move this appointment on as the patient arrives, or close it out."
        >
          <AppointmentActions
            appointmentId={appointment.id}
            status={appointment.status}
            canCheckIn={canCheckIn}
            canConvert={canConvert}
            canCancel={canCancel}
            size="md"
          />
        </Panel>
      )}

      {showReminder && (
        <Panel
          title="Remind the patient"
          description="Send one of the account's approved messages about this appointment over WhatsApp."
        >
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
        </Panel>
      )}

      <Panel title="The slot" description="What was booked, and with whom.">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label="Doctor">
            {appointment.doctorName}
            <p className="mt-0.5 text-sm text-slate-500">
              {appointment.doctorDepartment}
            </p>
          </Fact>

          <Fact label="Service">
            {appointment.appointmentTypeName}
            <p className="mt-0.5 text-sm tabular-nums text-slate-500">
              {appointment.durationMinutes} minutes
            </p>
          </Fact>

          <Fact label="Amount quoted">
            <span className="font-bold tabular-nums">
              {formatRupees(appointment.amount)}
            </span>
          </Fact>

          <Fact label="Clinic">{appointment.clinicName}</Fact>

          <Fact label="Booked by">
            {appointment.bookedByName ?? <NotSet />}
          </Fact>

          {appointment.checkedInAt && (
            <Fact label="Arrived">
              <span className="tabular-nums">
                {new Date(appointment.checkedInAt).toLocaleString(undefined, {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              {appointment.checkedInByName && (
                <p className="mt-0.5 text-sm text-slate-500">
                  Recorded by {appointment.checkedInByName}
                </p>
              )}
            </Fact>
          )}

          {appointment.cancelledAt && (
            <Fact label="Cancelled">
              <span className="tabular-nums">
                {new Date(appointment.cancelledAt).toLocaleString(undefined, {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              {appointment.cancelledByName && (
                <p className="mt-0.5 text-sm text-slate-500">
                  By {appointment.cancelledByName}
                </p>
              )}
              {appointment.cancellationReason && (
                <p className="mt-1 text-sm text-slate-600">
                  {appointment.cancellationReason}
                </p>
              )}
            </Fact>
          )}
        </div>
      </Panel>

      <Panel
        title="The patient"
        description={
          appointment.patientCode
            ? "Linked to a record on the register."
            : "Not on the register yet — a patient record is created when this appointment is registered."
        }
      >
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label="Name">{appointment.name}</Fact>

          <Fact label="Mobile number">
            <span className="tabular-nums">{appointment.mobileNumber}</span>
          </Fact>

          <Fact label="Patient ID">
            {appointment.patientCode ? (
              <span className="serial font-semibold">
                {appointment.patientCode}
              </span>
            ) : (
              <span className="text-slate-400">Not created yet</span>
            )}
          </Fact>

          <Fact label="Age">
            {appointment.age === null ? (
              <NotSet />
            ) : (
              <span className="tabular-nums">{appointment.age}</span>
            )}
          </Fact>

          <Fact label="Gender">{appointment.gender ?? <NotSet />}</Fact>

          <Fact label="City">{appointment.city ?? <NotSet />}</Fact>

          <Fact label="Address">{appointment.address ?? <NotSet />}</Fact>
        </div>
      </Panel>

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
    </section>
  );
}
