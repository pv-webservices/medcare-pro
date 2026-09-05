import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import {
  Activity,
  ArrowRight,
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  IndianRupee,
  ListTodo,
  MessageCircleMore,
  Plus,
  Stethoscope,
  UserRoundPlus,
  UsersRound,
} from "lucide-react";
import { APPOINTMENT_STATUS_LABELS, APPOINTMENT_STATUS_TONES } from "@/components/appointments/status";
import AreaChart, { type AreaPoint } from "@/components/dashboard/AreaChart";
import CallHandlingPanel from "@/components/dashboard/CallHandlingPanel";
import BookingFollowUpsPanel from "@/components/dashboard/BookingFollowUpsPanel";
import DashboardLayoutEditor, { type DashboardWidgetSlot } from "@/components/dashboard/DashboardLayoutEditor";
import DateRangePicker from "@/components/dashboard/DateRangePicker";
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
} from "@/components/ui";
import type { AdminDashboardData, DashboardTrendPoint } from "@/lib/adminDashboard";
import type { EffectiveDashboardLayout } from "@/lib/dashboardLayouts";
import { DASHBOARD_WIDGETS, type DashboardWidgetId } from "@/lib/dashboardWidgets";
import { formatRupees, formatRupeesCompact } from "@/lib/money";
import type { DashboardCallHandlingModel } from "@/lib/telephony/dashboardCallHandling";
import type { DashboardBookingFollowUpsModel } from "@/lib/telephony/bookingFollowUps";

interface Props {
  data: AdminDashboardData;
  layout: EffectiveDashboardLayout;
  callHandling: DashboardCallHandlingModel | null;
  bookingFollowUps: DashboardBookingFollowUpsModel | null;
  now?: Date;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/).find((part) => !["dr", "dr.", "mr", "mr.", "ms", "ms."].includes(part.toLowerCase())) ?? name;
}

function greeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function roundedDelta(value: number | null | undefined): number | undefined {
  return value == null ? undefined : Math.round(value * 10) / 10;
}

function chartPoints(points: readonly DashboardTrendPoint[], maxLabels = 8): AreaPoint[] {
  const step = Math.max(1, Math.ceil(points.length / maxLabels));
  return points.map((point, index) => ({
    label: index % step === 0 || index === points.length - 1 ? point.label : "",
    value: point.value,
  }));
}

function relativeTime(date: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function ViewAll({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex min-h-9 items-center gap-1 text-label font-semibold text-accent hover:text-accent-strong">
      {children}<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
    </Link>
  );
}

type MiniTone = "default" | "alert" | "ok" | "warn" | "info" | "violet" | "cyan";

const MINI_TONES: Record<MiniTone, string> = {
  default: "bg-canvas-deep text-ink",
  alert: "bg-alert-bg text-alert-ink",
  ok: "bg-ok-bg text-ok-ink",
  warn: "bg-warn-bg text-warn-ink",
  info: "bg-info-bg text-info-ink",
  violet: "bg-accent-soft text-accent-soft-ink",
  cyan: "bg-cyan-50 text-cyan-700",
};

function MiniStat({ label, value, tone = "default" }: { label: string; value: string | number; tone?: MiniTone }) {
  return (
    <div className={`rounded-xl border border-line/80 px-3 py-2.5 dashboard-tile-hover ${MINI_TONES[tone]}`}>
      <p className="text-meta font-medium text-muted">{label}</p>
      <p className="tnum mt-0.5 text-section font-semibold text-current">{typeof value === "number" ? value.toLocaleString("en-IN") : value}</p>
    </div>
  );
}

function appointmentTone(status: string): MiniTone {
  if (status === "CONFIRMED") return "ok";
  if (status === "CANCELLED") return "alert";
  if (status === "NO_SHOW") return "warn";
  if (status === "CHECKED_IN") return "info";
  if (status === "CONVERTED") return "violet";
  if (status === "RESCHEDULED") return "violet";
  return "default";
}

function NoData({ title, guidance, icon }: { title: string; guidance: string; icon: ReactNode }) {
  return <EmptyState isBare icon={icon} title={title} guidance={guidance} />;
}

export default function AdminDashboard({ data, layout, callHandling, bookingFollowUps, now = new Date() }: Props) {
  const scopeLabel = data.scope.clinicName ?? (data.scope.clinicCount > 1 ? "All accessible clinics" : "Accessible clinic");
  const slots = layout.layout.widgets.map((preference): DashboardWidgetSlot => ({
    id: preference.widgetId,
    content: renderDashboardWidget(preference.widgetId, data, now),
  }));

  return (
    <div className="flex min-w-0 flex-col gap-4 sm:gap-5">
      <PageHeader
        title={`${greeting(now.getHours())}, ${firstName(data.userName)} 👋`}
        description="A live operational view of patient care, appointments, collections, and team workload."
        meta={`${scopeLabel} · ${data.rangeLabel}`}
        className="mb-0"
        actions={
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end">
            {data.capabilities.actions.canCreateRegistration && (
              <Link href="/registration/new" className={buttonClasses("primary", "sm", "col-span-2 w-full sm:w-auto")}><UserRoundPlus className="h-4 w-4" />New registration</Link>
            )}
            {data.capabilities.actions.canBookAppointment && (
              <Link href="/appointments/new" className={buttonClasses("secondary", "sm", "w-full sm:w-auto")}><Plus className="h-4 w-4" />Appointment</Link>
            )}
            {data.capabilities.actions.canCreateTask && (
              <Link href="/tasks" className={buttonClasses("secondary", "sm", "w-full sm:w-auto")}><ListTodo className="h-4 w-4" />New task</Link>
            )}
            <div className="col-span-2 sm:col-span-1"><Suspense><DateRangePicker current={data.period} /></Suspense></div>
          </div>
        }
      />

      <CallHandlingPanel
        key={callHandling?.clinicId ?? "all-clinics"}
        model={callHandling}
        clinicName={data.scope.clinicName}
      />

      <BookingFollowUpsPanel model={bookingFollowUps} now={now} />

      {layout.layout.widgets.length === 0 ? (
        <EmptyState
          icon={<CircleAlert className="h-5 w-5" />}
          title="No dashboard data is assigned"
          guidance="This role can open the dashboard, but no dashboard data permissions are enabled for the selected clinic."
        />
      ) : (
        <DashboardLayoutEditor
          initialLayout={layout.layout}
          widgets={slots}
          canCustomize={layout.canCustomize}
          sourceLabel={layout.source === "personal" ? "your saved layout" : layout.source === "role" ? "your role default" : "system default"}
        />
      )}
    </div>
  );
}

function DeferredWidget({ widgetId }: { widgetId: DashboardWidgetId }) {
  const widget = DASHBOARD_WIDGETS.get(widgetId)!;
  return (
    <div className="flex min-h-[116px] items-center justify-center rounded-2xl border border-line bg-canvas p-5 text-center shadow-card dashboard-card-hover">
      <div><p className="text-label font-semibold text-ink">{widget.title}</p><p className="mt-1 text-meta text-muted">Save the layout to load this widget&apos;s current data.</p></div>
    </div>
  );
}

function renderDashboardWidget(widgetId: DashboardWidgetId, data: AdminDashboardData, now: Date): ReactNode {
  switch (widgetId) {
    case "total-patients":
      return data.summary.totalPatients === undefined ? <DeferredWidget widgetId={widgetId} /> : <MetricCard label="Total patients" value={data.summary.totalPatients.toLocaleString("en-IN")} footnote={data.patients ? `${data.patients.new} new in period` : undefined} tone="violet" icon={<UsersRound className="h-[18px] w-[18px]" />} />;
    case "todays-appointments":
      return data.summary.todaysAppointments === undefined ? <DeferredWidget widgetId={widgetId} /> : <MetricCard label="Today's appointments" value={data.summary.todaysAppointments.toLocaleString("en-IN")} delta={roundedDelta(data.summary.appointmentChange)} deltaCaption={data.comparisonLabel} tone="blue" icon={<CalendarDays className="h-[18px] w-[18px]" />} />;
    case "todays-collection":
      return data.summary.todaysCollection === undefined ? <DeferredWidget widgetId={widgetId} /> : <MetricCard label="Today's collection" value={formatRupees(data.summary.todaysCollection)} footnote="Recorded registrations" tone="green" icon={<IndianRupee className="h-[18px] w-[18px]" />} />;
    case "month-revenue":
      return data.summary.monthRevenue === undefined ? <DeferredWidget widgetId={widgetId} /> : <MetricCard label="Month-to-date revenue" value={formatRupees(data.summary.monthRevenue)} delta={roundedDelta(data.summary.revenueChange)} deltaCaption={data.comparisonLabel} tone="blue" icon={<IndianRupee className="h-[18px] w-[18px]" />} />;
    case "active-doctors":
      return data.summary.activeDoctors === undefined ? <DeferredWidget widgetId={widgetId} /> : <MetricCard label="Active doctors" value={data.summary.activeDoctors.toLocaleString("en-IN")} footnote={data.doctors ? `${data.doctors.availableToday} available today` : undefined} tone="cyan" icon={<Stethoscope className="h-[18px] w-[18px]" />} />;
    case "pending-tasks":
      return data.summary.pendingTasks === undefined ? <DeferredWidget widgetId={widgetId} /> : <MetricCard label="Pending tasks" value={data.summary.pendingTasks.toLocaleString("en-IN")} isUpGood={false} footnote={`${data.summary.overdueTasks ?? 0} overdue`} tone="orange" icon={<ListTodo className="h-[18px] w-[18px]" />} />;
    case "message-acceptance":
      return data.summary.messageHealth === undefined ? <DeferredWidget widgetId={widgetId} /> : <MetricCard label="Message acceptance" value={data.summary.messageHealth === null ? "—" : `${data.summary.messageHealth.toFixed(1)}%`} footnote="Gateway accepted today" tone="violet" icon={<MessageCircleMore className="h-[18px] w-[18px]" />} />;
    case "patient-overview": return data.patients ? <PatientOverview data={data} /> : <DeferredWidget widgetId={widgetId} />;
    case "appointment-overview": return data.appointments ? <AppointmentOverview data={data} /> : <DeferredWidget widgetId={widgetId} />;
    case "revenue-trend": return data.revenue ? <RevenueTrendPanel data={data} /> : <DeferredWidget widgetId={widgetId} />;
    case "revenue-summary": return data.revenue ? <RevenueSummaryPanel data={data} /> : <DeferredWidget widgetId={widgetId} />;
    case "revenue-by-doctor": return data.revenue ? <RevenueByDoctorPanel data={data} /> : <DeferredWidget widgetId={widgetId} />;
    case "today-schedule": return data.schedule ? <SchedulePanel data={data} /> : <DeferredWidget widgetId={widgetId} />;
    case "recent-patient-activity": return data.recentActivity ? <ActivityPanel data={data} now={now} /> : <DeferredWidget widgetId={widgetId} />;
    case "doctor-overview": return data.doctors ? <DoctorPanel data={data} /> : <DeferredWidget widgetId={widgetId} />;
    case "message-health": return data.messages ? <MessagePanel data={data} /> : <DeferredWidget widgetId={widgetId} />;
    case "task-overview": return data.tasks ? <TaskPanel data={data} /> : <DeferredWidget widgetId={widgetId} />;
    case "clinic-performance": return <ClinicPerformance data={data} />;
  }
}

function PatientOverview({ data }: { data: AdminDashboardData }) {
  const patients = data.patients!;
  return (
    <Panel title="Patient overview" description={`Patient growth and visits · ${data.rangeLabel}`} actions={<ViewAll href="/registration">View patients</ViewAll>} className="h-full">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat label="Total patients" value={patients.total} />
        <MiniStat label="New" value={patients.new} tone="ok" />
        <MiniStat label="Returning" value={patients.returning} tone="warn" />
        <MiniStat label="Follow-ups" value={patients.followUps} tone="info" />
      </div>
      <div className="mt-5 border-t border-line pt-5">
        {patients.trend.some((point) => point.value > 0) ? (
          <AreaChart points={chartPoints(patients.trend)} caption="New patient growth over the selected period" className="[--viz-series:var(--accent)]" />
        ) : <p className="flex h-44 items-center justify-center text-body text-muted">No new patients in this period.</p>}
      </div>
      {patients.recent.length > 0 && (
        <div className="mt-5 border-t border-line pt-4">
          <p className="mb-2 text-label font-semibold text-ink">Recent registrations</p>
          <ul className="grid gap-x-6 sm:grid-cols-2">
            {patients.recent.slice(0, 4).map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 border-b border-line py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-body font-medium text-ink">{row.patientName}</p>
                  <p className="truncate text-meta text-muted">{row.clinicName}</p>
                </div>
                <StatusPill tone="neutral">{row.visitType === "FOLLOW_UP" ? "Follow-up" : "New"}</StatusPill>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function AppointmentOverview({ data }: { data: AdminDashboardData }) {
  const appointments = data.appointments!;
  const visibleStatuses = ["SCHEDULED", "CONFIRMED", "CHECKED_IN", "CONVERTED", "CANCELLED", "NO_SHOW", "RESCHEDULED"] as const;
  return (
    <Panel title="Appointment overview" description={`Demand, arrivals, and outcomes · ${data.rangeLabel}`} actions={<ViewAll href="/appointments">View appointments</ViewAll>} className="h-full">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {visibleStatuses.map((status) => (
          <MiniStat key={status} label={APPOINTMENT_STATUS_LABELS[status]} value={appointments.byStatus[status]} tone={appointmentTone(status)} />
        ))}
        <MiniStat label="Upcoming" value={appointments.upcoming} tone="cyan" />
      </div>
      <div className="mt-5 border-t border-line pt-5">
        {appointments.trend.some((point) => point.value > 0) ? <AreaChart points={chartPoints(appointments.trend)} caption="Appointment trend over the selected period" className="[--viz-series:#0e9aaa]" /> : <p className="flex h-44 items-center justify-center text-body text-muted">No appointments in this period.</p>}
      </div>
    </Panel>
  );
}

function RevenueTrendPanel({ data }: { data: AdminDashboardData }) {
  const revenue = data.revenue!;
  return (
    <Panel title="Revenue trend" description={`Registration-backed collections · ${data.rangeLabel}`} actions={<ViewAll href="/reports">Open reports</ViewAll>} className="h-full">
      {revenue.trend.some((point) => point.value > 0) ? <AreaChart points={chartPoints(revenue.trend, 10)} caption="Revenue trend over the selected period" className="[--viz-series:#3678e8]" /> : <NoData icon={<IndianRupee className="h-5 w-5" />} title="No revenue in this period" guidance="Collections appear here when registrations with an amount are recorded." />}
    </Panel>
  );
}

function RevenueSummaryPanel({ data }: { data: AdminDashboardData }) {
  const revenue = data.revenue!;
  return <Panel title="Revenue summary" description="Current collection checkpoints" className="h-full">
    <div className="grid grid-cols-2 gap-3"><MiniStat label="Today" value={formatRupeesCompact(revenue.today)} /><MiniStat label="This week" value={formatRupeesCompact(revenue.thisWeek)} /><MiniStat label="This month" value={formatRupeesCompact(revenue.thisMonth)} /><MiniStat label="Previous month" value={formatRupeesCompact(revenue.previousMonth)} /></div>
    <div className="mt-4 flex items-center justify-between rounded-xl border border-line px-4 py-3 dashboard-tile-hover"><span className="text-body text-muted">Average per visit</span><span className="tnum font-semibold text-ink">{formatRupees(revenue.averagePerVisit)}</span></div>
  </Panel>;
}

function RevenueByDoctorPanel({ data }: { data: AdminDashboardData }) {
  const rows = data.revenue!.byDoctor;
  return <Panel title="Revenue by doctor" description="Attributed registrations in this period" isFlush hasDivider className="h-full">
    {rows.length === 0 ? <NoData icon={<Stethoscope className="h-5 w-5" />} title="No attributed doctor revenue" guidance="Doctor attribution will appear when registrations are recorded in this period." /> : <>
      <div className="divide-y divide-line px-4 md:hidden">{rows.map((row) => <div key={row.doctorId} className="py-3.5"><p className="font-semibold text-ink">{row.doctorName}</p><dl className="mt-2 grid grid-cols-2 gap-3 text-meta"><div><dt className="text-muted">Patients</dt><dd className="tnum mt-0.5 font-semibold text-ink">{row.patients}</dd></div><div className="text-right"><dt className="text-muted">Revenue</dt><dd className="tnum mt-0.5 font-semibold text-ink">{formatRupees(row.revenue)}</dd></div></dl></div>)}</div>
      <div className="hidden overflow-x-auto md:block"><Table caption="Revenue by doctor" className="min-w-[620px] rounded-none border-0 shadow-none"><THead><TH>Doctor</TH><TH align="end">Patients</TH><TH align="end">Revenue</TH></THead><TBody>{rows.map((row) => <TR key={row.doctorId}><TD isPrimary>{row.doctorName}</TD><TD align="end" className="tnum">{row.patients}</TD><TD align="end" className="tnum">{formatRupees(row.revenue)}</TD></TR>)}</TBody></Table></div>
    </>}
  </Panel>;
}

function SchedulePanel({ data }: { data: AdminDashboardData }) {
  const schedule = data.schedule!;
  return (
    <Panel title="Today's schedule" description="Next appointments in chronological order" className="h-full" actions={<ViewAll href="/appointments">View all appointments</ViewAll>} isFlush hasDivider>
      {schedule.length === 0 ? <NoData icon={<CalendarCheck className="h-5 w-5" />} title="No upcoming appointments today" guidance="Bookings later today will appear here." /> : (
        <>
          <div className="divide-y divide-line px-4 md:hidden">
            {schedule.map((row) => (
              <div key={row.id} className="py-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><Link href={`/appointments/${row.id}`} className="truncate font-semibold text-ink hover:text-accent">{row.patientName}</Link><p className="mt-0.5 truncate text-meta text-muted">{row.appointmentType} · {row.clinicName}</p></div>
                  <StatusPill tone={APPOINTMENT_STATUS_TONES[row.status]}>{APPOINTMENT_STATUS_LABELS[row.status]}</StatusPill>
                </div>
                <p className="tnum mt-2 text-label font-semibold text-ink">{row.time} <span className="font-normal text-muted">with {row.doctorName}</span></p>
              </div>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block"><Table caption="Upcoming appointments today" className="min-w-[760px] rounded-none border-0 shadow-none"><THead><TH>Time</TH><TH>Patient</TH><TH>Doctor</TH><TH>Type</TH><TH>Clinic</TH><TH>Status</TH></THead><TBody>
          {schedule.map((row) => <TR key={row.id}><TD isNumeric>{row.time}</TD><TD isPrimary><Link href={`/appointments/${row.id}`} className="hover:text-accent">{row.patientName}</Link></TD><TD>{row.doctorName}</TD><TD>{row.appointmentType}</TD><TD>{row.clinicName}</TD><TD><StatusPill tone={APPOINTMENT_STATUS_TONES[row.status]}>{APPOINTMENT_STATUS_LABELS[row.status]}</StatusPill></TD></TR>)}
          </TBody></Table></div>
        </>
      )}
    </Panel>
  );
}

function ActivityPanel({ data, now }: { data: AdminDashboardData; now: Date }) {
  const rows = data.recentActivity!;
  return (
    <Panel title="Recent patient activity" description="Latest events in your clinic scope" className="h-full">
      {rows.length === 0 ? <NoData icon={<Activity className="h-5 w-5" />} title="No recent patient activity" guidance="Registrations and appointment changes will appear here." /> : (
        <ol className="divide-y divide-line">{rows.slice(0, 7).map((row) => <li key={row.id} className="flex gap-3 py-2.5 first:pt-0 last:pb-0"><span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-soft-ink"><Activity className="h-4 w-4" /></span><div className="min-w-0"><p className="text-label text-ink sm:text-body"><span className="font-semibold">{row.patientName}</span> · {row.description}</p><p className="mt-0.5 text-meta text-muted">{row.clinicName} · {relativeTime(row.occurredAt, now)}</p></div></li>)}</ol>
      )}
    </Panel>
  );
}

function DoctorPanel({ data }: { data: AdminDashboardData }) {
  const doctors = data.doctors!;
  return (
    <Panel title="Doctor overview" description={`Coverage and workload · ${data.rangeLabel}`} actions={<ViewAll href="/doctors">View doctors</ViewAll>} isFlush hasDivider>
      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3"><MiniStat label="Active doctors" value={doctors.active} /><MiniStat label="Available today" value={doctors.availableToday} tone="ok" /><MiniStat label="On leave" value={doctors.onLeave} /></div>
      {doctors.performance.length === 0 ? <NoData icon={<Stethoscope className="h-5 w-5" />} title="No doctor activity" guidance="Doctor workload will appear when appointments or registrations are recorded." /> : (
        <>
          <div className="divide-y divide-line px-4 md:hidden">
            {doctors.performance.map((row) => (
              <div key={row.doctorId} className="py-3.5">
                <p className="font-semibold text-ink">{row.doctorName}</p>
                <p className="mt-0.5 text-meta text-muted">{row.clinicName}</p>
                <dl className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-canvas-deep p-3 text-meta dashboard-tile-hover">
                  <div><dt className="text-muted">Appointments</dt><dd className="tnum mt-0.5 font-semibold text-ink">{row.appointments}</dd></div>
                  <div><dt className="text-muted">Seen</dt><dd className="tnum mt-0.5 font-semibold text-ink">{row.patients}</dd></div>
                  {row.revenue !== undefined && <div className="text-right"><dt className="text-muted">Revenue</dt><dd className="tnum mt-0.5 font-semibold text-ink">{formatRupeesCompact(row.revenue)}</dd></div>}
                </dl>
              </div>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block"><Table caption="Doctor workload" className="min-w-[720px] rounded-none border-0 shadow-none"><THead><TH>Doctor</TH><TH>Clinic</TH><TH align="end">Appointments</TH><TH align="end">Patients seen</TH>{doctors.performance.some((row) => row.revenue !== undefined) && <TH align="end">Revenue</TH>}</THead><TBody>
          {doctors.performance.map((row) => <TR key={row.doctorId}><TD isPrimary>{row.doctorName}</TD><TD>{row.clinicName}</TD><TD align="end" className="tnum">{row.appointments}</TD><TD align="end" className="tnum">{row.patients}</TD>{doctors.performance.some((item) => item.revenue !== undefined) && <TD align="end" className="tnum">{row.revenue === undefined ? "—" : formatRupeesCompact(row.revenue)}</TD>}</TR>)}
          </TBody></Table></div>
        </>
      )}
    </Panel>
  );
}

function MessagePanel({ data }: { data: AdminDashboardData }) {
  const messages = data.messages!;
  return (
    <Panel title="Message health" description="Today's stored WhatsApp gateway outcomes" actions={<ViewAll href="/messages">View messages</ViewAll>}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><MiniStat label="Sent" value={messages.total} /><MiniStat label="Accepted" value={messages.accepted} tone="ok" /><MiniStat label="Pending" value={messages.pending} /><MiniStat label="Failed" value={messages.failed} tone={messages.failed > 0 ? "alert" : "default"} /></div>
      <p className="mt-4 text-label text-muted">{messages.acceptanceRate === null ? "No messaging activity today." : `${messages.acceptanceRate.toFixed(1)}% accepted by the gateway. Delivery receipts are not available from the current provider.`}</p>
    </Panel>
  );
}

function TaskPanel({ data }: { data: AdminDashboardData }) {
  const tasks = data.tasks!;
  return (
    <Panel title="Task overview" description="Deadlines and current workload" actions={<ViewAll href="/tasks">View tasks</ViewAll>}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3"><MiniStat label="My pending" value={tasks.myPending} /><MiniStat label="Due today" value={tasks.dueToday} /><MiniStat label="Overdue" value={tasks.overdue} tone={tasks.overdue > 0 ? "alert" : "default"} /><MiniStat label="Completed today" value={tasks.completedToday} tone="ok" />{tasks.teamPending !== undefined && <MiniStat label="Team pending" value={tasks.teamPending} />}</div>
      {tasks.dueToday === 0 && tasks.overdue === 0 && <p className="mt-4 flex items-center gap-2 text-label text-muted"><CheckCircle2 className="h-4 w-4 text-ok-ink" />Nothing is due or overdue today.</p>}
    </Panel>
  );
}

function ClinicPerformance({ data }: { data: AdminDashboardData }) {
  const rows = data.clinicPerformance ?? [];
  const hasPatients = rows.some((row) => row.patients !== undefined);
  const hasAppointments = rows.some((row) => row.appointments !== undefined);
  const hasDoctors = rows.some((row) => row.doctors !== undefined);
  const hasRevenue = rows.some((row) => row.revenue !== undefined);
  return (
    <Panel title="Clinic performance" description="Only clinics and metrics permitted for this role" isFlush hasDivider>
      {rows.length === 0 ? <NoData icon={<UsersRound className="h-5 w-5" />} title="No clinic comparison available" guidance="This widget appears when more than one accessible clinic can be compared." /> : <div className="overflow-x-auto"><Table caption="Clinic performance comparison" className="min-w-[680px] rounded-none border-0 shadow-none"><THead><TH>Clinic</TH>{hasPatients && <TH align="end">Patients</TH>}{hasAppointments && <TH align="end">Appointments</TH>}{hasDoctors && <TH align="end">Doctors</TH>}{hasRevenue && <TH align="end">Revenue</TH>}</THead><TBody>
        {rows.map((row) => <TR key={row.clinicId}><TD isPrimary>{row.clinicName}</TD>{hasPatients && <TD align="end" className="tnum">{row.patients ?? "—"}</TD>}{hasAppointments && <TD align="end" className="tnum">{row.appointments ?? "—"}</TD>}{hasDoctors && <TD align="end" className="tnum">{row.doctors ?? "—"}</TD>}{hasRevenue && <TD align="end" className="tnum">{row.revenue === undefined ? "—" : formatRupeesCompact(row.revenue)}</TD>}</TR>)}
      </TBody></Table></div>}
    </Panel>
  );
}
