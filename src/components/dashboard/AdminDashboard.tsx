import Link from "next/link";
import { Suspense } from "react";
import {
  Activity,
  ArrowRight,
  Bell,
  CalendarDays,
  ClipboardList,
  IndianRupee,
  ListTodo,
  ShieldCheck,
  Stethoscope,
  UserRoundPlus,
} from "lucide-react";
import AdminDashboardDatePicker from "@/components/dashboard/AdminDashboardDatePicker";
import {
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_STATUS_TONES,
} from "@/components/appointments/status";
import {
  EmptyState,
  MetricCard,
  PageHeader,
  Panel,
  StatusPill,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  buttonClasses,
  cx,
} from "@/components/ui";
import type {
  AdminDashboardData,
  AdminDoctorRow,
} from "@/lib/adminDashboard";
import { formatRupees } from "@/lib/money";
import { VISIT_TYPE_LABELS, type VisitType } from "@/lib/registrations";

interface AdminDashboardProps {
  data: AdminDashboardData;
  today: string;
  now?: Date;
}

function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function firstNameOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const skip = new Set(["dr", "dr.", "mr", "mr.", "mrs", "mrs.", "ms", "ms."]);
  return words.find((word) => !skip.has(word.toLowerCase())) ?? name;
}

function formatSelectedDate(date: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00.000Z`));
}

function formatEventTime(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function relativeTime(date: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return formatEventTime(date);
}

function visitTypeLabel(value: string): string {
  return value in VISIT_TYPE_LABELS
    ? VISIT_TYPE_LABELS[value as VisitType]
    : value.replaceAll("_", " ").toLowerCase();
}

function ViewAll({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-9 items-center gap-1 rounded-lg px-1 text-label font-medium text-accent transition-colors duration-150 hover:text-accent-strong"
    >
      {label}
      <ArrowRight aria-hidden="true" strokeWidth={2} className="h-3.5 w-3.5" />
    </Link>
  );
}

function EmptyAction({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className={buttonClasses("secondary", "sm")}>
      {label}
    </Link>
  );
}

export default function AdminDashboard({
  data,
  today,
  now = new Date(),
}: AdminDashboardProps) {
  const isToday = data.date === today;
  const clinicName = data.scope.clinicName;
  const scopeLabel = clinicName ?? "All assigned clinics";
  const selectedDateLabel = formatSelectedDate(data.date);
  const description = isToday
    ? clinicName
      ? `Here's what's happening at ${clinicName} today.`
      : "Here's what's happening across your assigned clinics today."
    : clinicName
      ? `Here's what happened at ${clinicName} on ${selectedDateLabel}.`
      : `Here's what happened across your assigned clinics on ${selectedDateLabel}.`;

  const hasAnyWidget = Object.entries(data.capabilities.dashboard).some(
    ([key, allowed]) => key !== "view" && allowed,
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={`${greetingFor(now.getHours())}, ${firstNameOf(data.userName)}`}
        description={description}
        scope={scopeLabel}
        meta={!isToday ? selectedDateLabel : undefined}
        actions={
          <Suspense>
            <AdminDashboardDatePicker current={data.date} today={today} />
          </Suspense>
        }
      />

      {!hasAnyWidget ? (
        <EmptyState
          icon={<ShieldCheck className="h-5 w-5" strokeWidth={2} />}
          title="No dashboard modules are available"
          guidance="Your role does not currently have access to operational dashboard data. Ask an account owner to review your permissions."
        />
      ) : (
        <>
          <KpiRow data={data} isToday={isToday} />

          {data.capabilities.dashboard.appointments && data.appointments && (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <SchedulePanel data={data} isToday={isToday} />
              <OperationalSummary data={data} />
            </div>
          )}

          {(data.capabilities.dashboard.registrations || data.capabilities.dashboard.doctors) && (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {data.capabilities.dashboard.registrations && data.registrations && (
                <RegistrationPanel data={data} isToday={isToday} />
              )}
              {data.capabilities.dashboard.doctors && data.doctors && (
                <DoctorAvailabilityPanel data={data} isToday={isToday} />
              )}
            </div>
          )}

          {data.capabilities.dashboard.tasks && data.tasks && (
            <TaskSummaryPanel data={data} />
          )}

          {(data.capabilities.dashboard.activity || data.capabilities.dashboard.notifications) && (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {data.capabilities.dashboard.activity && (
                <ActivityPanel data={data} now={now} />
              )}
              {data.capabilities.dashboard.notifications && data.notifications && (
                <NotificationsPanel data={data} now={now} />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TaskSummaryPanel({ data }: { data: AdminDashboardData }) {
  const summary = data.tasks!;
  const items = [
    { label: "My open tasks", value: summary.myOpen },
    { label: "Due today", value: summary.dueToday },
    { label: "Overdue", value: summary.overdue },
    { label: "Completed today", value: summary.completedToday },
  ];

  return (
    <Panel
      title="Tasks"
      description="Your current workload and deadlines"
      actions={<ViewAll href="/tasks" label="View tasks" />}
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {items.map((item) => (
          <div key={item.label} className="rounded-2xl border border-line bg-canvas-deep p-4">
            <div className="flex items-center gap-2 text-muted">
              <ListTodo className="h-4 w-4" strokeWidth={2} />
              <span className="text-label">{item.label}</span>
            </div>
            <p className="tnum mt-2 text-section font-semibold text-ink">
              {item.value.toLocaleString("en-IN")}
            </p>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function KpiRow({ data, isToday }: { data: AdminDashboardData; isToday: boolean }) {
  const cards = [];

  if (data.capabilities.dashboard.appointments && data.appointments) {
    cards.push(
      <MetricCard
        key="appointments"
        label={isToday ? "Today's appointments" : "Appointments"}
        value={data.appointments.active.toLocaleString("en-IN")}
        footnote={`${data.appointments.byStatus.CONVERTED} registered · ${data.appointments.byStatus.CHECKED_IN} arrived`}
        icon={<CalendarDays className="h-[18px] w-[18px]" strokeWidth={2} />}
      />,
    );
  }

  if (data.capabilities.dashboard.registrations && data.registrations) {
    cards.push(
      <MetricCard
        key="registrations"
        label={isToday ? "Today's registrations" : "Registrations"}
        value={data.registrations.total.toLocaleString("en-IN")}
        footnote={`${data.registrations.newPatients} new · ${data.registrations.followUps} follow-up`}
        icon={<ClipboardList className="h-[18px] w-[18px]" strokeWidth={2} />}
      />,
    );
  }

  if (data.capabilities.dashboard.revenue && data.revenueToday !== null) {
    cards.push(
      <MetricCard
        key="revenue"
        label={isToday ? "Today's revenue" : "Revenue"}
        value={formatRupees(data.revenueToday)}
        footnote="Recorded registrations"
        icon={<IndianRupee className="h-[18px] w-[18px]" strokeWidth={2} />}
      />,
    );
  }

  if (data.capabilities.dashboard.doctors && data.doctors) {
    cards.push(
      <MetricCard
        key="doctors"
        label={isToday ? "Active doctors today" : "Available doctors"}
        value={data.doctors.available.toLocaleString("en-IN")}
        footnote={`${data.doctors.onLeave} on leave · ${data.doctors.notScheduled} not scheduled`}
        icon={<Stethoscope className="h-[18px] w-[18px]" strokeWidth={2} />}
      />,
    );
  }

  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards}</div>;
}

function SchedulePanel({ data, isToday }: { data: AdminDashboardData; isToday: boolean }) {
  const rows = data.schedule;

  return (
    <Panel
      title={isToday ? "Today's schedule" : "Schedule"}
      description="Appointments in time order"
      className="xl:col-span-2"
      actions={<ViewAll href={`/appointments?date=${data.date}`} label="View full schedule" />}
      isFlush
      hasDivider
    >
      {rows.length === 0 ? (
        <EmptyState
          isBare
          icon={<CalendarDays className="h-5 w-5" strokeWidth={2} />}
          title={isToday ? "No appointments scheduled for today" : "No appointments scheduled"}
          guidance="New bookings for this date will appear here."
          action={
            data.capabilities.actions.canBookAppointment ? (
              <EmptyAction href="/appointments/new" label="Book appointment" />
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Table caption="Appointments for the selected day" className="rounded-none border-0 shadow-none">
              <THead>
                <TH>Time</TH>
                <TH>Patient</TH>
                <TH>Doctor</TH>
                <TH>Service</TH>
                <TH>Status</TH>
                <TH>Action</TH>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <TR key={row.id}>
                    <TD isNumeric className="whitespace-nowrap">{row.startTime}</TD>
                    <TD isPrimary>
                      <span className="block">{row.patientName}</span>
                      {data.scope.type === "ACCOUNT" && (
                        <span className="mt-0.5 block text-meta font-normal text-muted">{row.clinicName}</span>
                      )}
                    </TD>
                    <TD>{row.doctorName}</TD>
                    <TD>{row.serviceName}</TD>
                    <TD>
                      <StatusPill tone={APPOINTMENT_STATUS_TONES[row.status]}>
                        {APPOINTMENT_STATUS_LABELS[row.status]}
                      </StatusPill>
                    </TD>
                    <TD>
                      <Link className="font-medium text-accent hover:text-accent-strong" href={`/appointments/${row.id}`}>
                        View
                      </Link>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>

          <ul className="divide-y divide-line px-4 md:hidden">
            {rows.map((row) => (
              <li key={row.id} className="py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-body font-semibold text-ink">{row.startTime} · {row.patientName}</p>
                    <p className="mt-1 text-label text-muted">{row.doctorName} · {row.serviceName}</p>
                    {data.scope.type === "ACCOUNT" && (
                      <p className="mt-0.5 text-meta text-muted">{row.clinicName}</p>
                    )}
                  </div>
                  <StatusPill tone={APPOINTMENT_STATUS_TONES[row.status]}>
                    {APPOINTMENT_STATUS_LABELS[row.status]}
                  </StatusPill>
                </div>
                <Link href={`/appointments/${row.id}`} className="mt-3 inline-flex min-h-9 items-center text-label font-medium text-accent">
                  View appointment
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

function OperationalSummary({ data }: { data: AdminDashboardData }) {
  const summary = data.appointments!;
  const statuses = [
    "SCHEDULED",
    "CONFIRMED",
    "CHECKED_IN",
    "CONVERTED",
    "CANCELLED",
    "NO_SHOW",
  ] as const;

  return (
    <Panel title="Operational summary" description="Appointment status for this day">
      <div className="mb-4 flex items-end justify-between border-b border-line pb-4">
        <span className="text-body text-muted">Appointments</span>
        <span className="tnum text-metric font-semibold text-ink">{summary.total}</span>
      </div>
      <ul className="flex flex-col gap-3">
        {statuses.map((status) => (
          <li key={status} className="flex items-center justify-between gap-3">
            <span className="text-body text-muted">{APPOINTMENT_STATUS_LABELS[status]}</span>
            <span className="tnum text-body font-semibold text-ink">{summary.byStatus[status]}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function RegistrationPanel({ data, isToday }: { data: AdminDashboardData; isToday: boolean }) {
  const rows = data.registrationActivity;

  return (
    <Panel
      title="Registration activity"
      description={isToday ? "Patient visits recorded today" : "Patient visits on this date"}
      actions={<ViewAll href={`/registration?from=${data.date}&to=${data.date}`} label="View registrations" />}
      isFlush
      hasDivider
    >
      {rows.length === 0 ? (
        <EmptyState
          isBare
          icon={<UserRoundPlus className="h-5 w-5" strokeWidth={2} />}
          title={isToday ? "No registrations today" : "No registrations on this date"}
          guidance="New patient visits will appear here when they are recorded."
          action={data.capabilities.actions.canCreateRegistration ? <EmptyAction href="/registration/new" label="New registration" /> : undefined}
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Table caption="Recent registrations" className="rounded-none border-0 shadow-none">
              <THead>
                <TH>Patient</TH>
                <TH>Visit</TH>
                <TH>Doctor</TH>
                <TH>Time</TH>
                <TH>Created by</TH>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <TR key={row.id}>
                    <TD isPrimary>
                      <Link href={`/registration/${row.id}`} className="hover:text-accent">{row.patientName}</Link>
                      {data.scope.type === "ACCOUNT" && <span className="mt-0.5 block text-meta font-normal text-muted">{row.clinicName}</span>}
                    </TD>
                    <TD><StatusPill tone="neutral">{visitTypeLabel(row.visitType)}</StatusPill></TD>
                    <TD>{row.doctorName ?? "Not assigned"}</TD>
                    <TD isNumeric>{row.visitTime}</TD>
                    <TD>{row.createdByName}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>

          <ul className="divide-y divide-line px-4 md:hidden">
            {rows.map((row) => (
              <li key={row.id} className="py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/registration/${row.id}`} className="text-body font-semibold text-ink hover:text-accent">{row.patientName}</Link>
                    <p className="mt-1 text-label text-muted">{row.doctorName ?? "Not assigned"} · {row.visitTime}</p>
                    <p className="mt-0.5 text-meta text-muted">Created by {row.createdByName}</p>
                  </div>
                  <StatusPill tone="neutral">{visitTypeLabel(row.visitType)}</StatusPill>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

const DOCTOR_STATUS: Record<AdminDoctorRow["status"], { label: string; tone: "ok" | "warn" | "neutral" }> = {
  AVAILABLE: { label: "Available", tone: "ok" },
  ON_LEAVE: { label: "On leave", tone: "warn" },
  NOT_SCHEDULED: { label: "Not scheduled", tone: "neutral" },
};

function DoctorAvailabilityPanel({ data, isToday }: { data: AdminDashboardData; isToday: boolean }) {
  const doctors = data.doctors!;

  return (
    <Panel
      title="Doctor availability"
      description={isToday ? "Scheduled coverage for today" : "Scheduled coverage for this date"}
      actions={<ViewAll href="/doctors" label="View doctors" />}
    >
      {doctors.rows.length === 0 ? (
        <EmptyState
          isBare
          icon={<Stethoscope className="h-5 w-5" strokeWidth={2} />}
          title="No doctors are available"
          guidance="Doctor schedules and leave for this date will appear here."
          action={data.capabilities.actions.canAddDoctor ? <EmptyAction href="/doctors" label="Add doctor" /> : undefined}
        />
      ) : (
        <ul className="divide-y divide-line">
          {doctors.rows.map((doctor) => {
            const status = DOCTOR_STATUS[doctor.status];
            return (
              <li key={doctor.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <Link href={`/doctors/${doctor.id}`} className="text-body font-medium text-ink hover:text-accent">{doctor.name}</Link>
                  <p className="mt-0.5 text-meta text-muted">
                    {doctor.department}
                    {data.scope.type === "ACCOUNT" ? ` · ${doctor.clinicName}` : ""}
                  </p>
                  {doctor.availability && doctor.status !== "ON_LEAVE" && (
                    <p className="mt-0.5 text-meta text-muted">{doctor.availability}</p>
                  )}
                </div>
                <StatusPill tone={status.tone}>{status.label}</StatusPill>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function ActivityPanel({ data, now }: { data: AdminDashboardData; now: Date }) {
  return (
    <Panel title="Recent activity" description="Registration edit history in your scope">
      {data.recentActivity.length === 0 ? (
        <EmptyState
          isBare
          icon={<Activity className="h-5 w-5" strokeWidth={2} />}
          title="No recent registration changes"
          guidance="Created and edited registrations will appear here."
        />
      ) : (
        <ol className="divide-y divide-line">
          {data.recentActivity.map((row) => (
            <li key={row.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-soft-ink">
                <Activity aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-body text-ink">
                  <span className="font-medium">{row.actorName}</span> {row.action} {row.patientName}&apos;s registration
                </p>
                {row.changedFields.length > 0 && row.action === "updated" && (
                  <p className="mt-0.5 text-meta text-muted">
                    Changed: {row.changedFields.slice(0, 2).join(", ")}
                    {row.changedFields.length > 2 ? ` +${row.changedFields.length - 2} more` : ""}
                  </p>
                )}
                <p className="mt-0.5 text-meta text-muted">{relativeTime(row.timestamp, now)}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

function NotificationsPanel({ data, now }: { data: AdminDashboardData; now: Date }) {
  const notifications = data.notifications!;

  return (
    <Panel
      title="Notifications"
      description={`${notifications.unreadCount} unread notification${notifications.unreadCount === 1 ? "" : "s"}`}
      actions={<ViewAll href="/notifications" label="View all" />}
    >
      {notifications.items.length === 0 ? (
        <EmptyState
          isBare
          icon={<Bell className="h-5 w-5" strokeWidth={2} />}
          title="No notifications"
          guidance="Patient, doctor and clinic changes will appear here."
        />
      ) : (
        <ol className="divide-y divide-line">
          {notifications.items.map((item) => (
            <li key={item.id} className="relative flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <span
                className={cx(
                  "mt-1 h-2 w-2 shrink-0 rounded-full",
                  item.read ? "bg-line-strong" : "bg-accent",
                )}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className={cx("text-body", item.read ? "text-ink-soft" : "font-medium text-ink")}>{item.message}</p>
                <p className="mt-0.5 text-meta text-muted">
                  {item.typeLabel} · {relativeTime(item.createdAt, now)}
                </p>
                {item.href && (
                  <Link href={item.href} className="mt-1 inline-flex min-h-8 items-center text-meta font-medium text-accent hover:text-accent-strong">
                    Open record
                  </Link>
                )}
              </div>
              {!item.read && <span className="sr-only">Unread</span>}
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
