import Link from "next/link";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  IndianRupee,
  ListChecks,
  Users,
} from "lucide-react";
import AreaChart, { type AreaPoint } from "@/components/dashboard/AreaChart";
import {
  Avatar,
  Card,
  StatusPill,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  cx,
  type StatusTone,
} from "@/components/ui";

/*
 * Dashboard overview — PRD §6.4 (FR-4.1 … FR-4.3).
 *
 * STILL STATIC. Every figure below is placeholder data, exactly as it was
 * before this redesign; wiring the panels to real queries is its own stage and
 * is deliberately not smuggled in with a restyle. The shapes are what matter
 * here — each panel takes the form the real data will arrive in, so the swap is
 * a data change rather than a layout one.
 *
 * The page carries no heading of its own. The greeting lives in the shell's
 * topbar (see the dashboard layout), so repeating it here would give the screen
 * two competing first lines.
 */

interface Kpi {
  label: string;
  value: string;
  delta: number;
  icon: typeof Users;
}

const KPIS: readonly Kpi[] = [
  { label: "Total patients", value: "1,843", delta: 12.5, icon: Users },
  { label: "Appointments today", value: "18", delta: 8.2, icon: CalendarDays },
  { label: "Monthly revenue", value: "₹4,52,300", delta: 15.4, icon: IndianRupee },
  { label: "Pending tasks", value: "12", delta: -4.1, icon: ListChecks },
];

const PATIENT_TREND: readonly AreaPoint[] = [
  { label: "Feb", value: 210 },
  { label: "Mar", value: 285 },
  { label: "Apr", value: 262 },
  { label: "May", value: 340 },
  { label: "Jun", value: 315 },
  { label: "Jul", value: 402 },
  { label: "Aug", value: 448 },
];

interface ScheduleRow {
  time: string;
  name: string;
  visit: string;
  status: string;
  tone: StatusTone;
}

const SCHEDULE: readonly ScheduleRow[] = [
  { time: "09:30", name: "Anita Rao", visit: "Follow-up", status: "Confirmed", tone: "accent" },
  { time: "10:15", name: "Vikram Shah", visit: "New consult", status: "Confirmed", tone: "accent" },
  { time: "11:00", name: "Priya Nair", visit: "Root canal", status: "Waiting", tone: "warn" },
  { time: "12:30", name: "Rahul Menon", visit: "Cleaning", status: "Confirmed", tone: "accent" },
  { time: "14:00", name: "Sneha Kulkarni", visit: "Follow-up", status: "Waiting", tone: "warn" },
];

interface ActivityRow {
  name: string;
  activity: string;
  date: string;
  status: string;
  tone: StatusTone;
}

const ACTIVITY: readonly ActivityRow[] = [
  { name: "Anita Rao", activity: "Registration created", date: "24 Aug 2026", status: "Paid", tone: "ok" },
  { name: "Vikram Shah", activity: "Contact number edited", date: "24 Aug 2026", status: "Updated", tone: "neutral" },
  { name: "Priya Nair", activity: "Visit completed", date: "23 Aug 2026", status: "Completed", tone: "ok" },
  { name: "Rahul Menon", activity: "Appointment booked", date: "23 Aug 2026", status: "Confirmed", tone: "accent" },
  { name: "Sneha Kulkarni", activity: "Payment pending", date: "22 Aug 2026", status: "Waiting", tone: "warn" },
];

interface Task {
  title: string;
  meta: string;
  isDone: boolean;
}

const TASKS: readonly Task[] = [
  { title: "Confirm tomorrow's appointments", meta: "Due by 5:00 PM", isDone: false },
  { title: "File Priya Nair's lab report", meta: "Due by 6:00 PM", isDone: false },
  { title: "Reconcile today's cash payments", meta: "Due by 8:00 PM", isDone: false },
  { title: "Send Dr. Iyer the weekly roster", meta: "Completed 11:20 AM", isDone: true },
];

/** A card title with its muted subtitle — the section signature, repeated. */
function PanelHeading({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-section font-bold text-ink">{title}</h3>
        <p className="mt-1 text-label font-medium text-muted">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6 pb-2">
      {/* --- KPI row ------------------------------------------------------ */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        {KPIS.map((kpi) => {
          const Icon = kpi.icon;
          const isUp = kpi.delta >= 0;
          const Arrow = isUp ? ArrowUpRight : ArrowDownRight;

          return (
            <Card key={kpi.label}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-label font-medium text-muted">{kpi.label}</p>
                  <p className="tnum mt-2 text-metric font-extrabold text-ink">
                    {kpi.value}
                  </p>
                </div>

                {/*
                  A sunken tile, not a raised one. The number is the object on
                  this card; the icon is a category marker behind it, and giving
                  it the same elevation as a button would promise a press.
                */}
                <span
                  aria-hidden="true"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-canvas text-accent shadow-neu-inset"
                >
                  <Icon strokeWidth={2} className="h-5 w-5" />
                </span>
              </div>

              <p
                className={cx(
                  "mt-4 flex items-center gap-1 text-meta font-semibold",
                  isUp ? "text-ok-ink" : "text-alert-ink",
                )}
              >
                <Arrow aria-hidden="true" strokeWidth={2.5} className="h-3.5 w-3.5" />
                <span className="tnum">{Math.abs(kpi.delta)}%</span>
                <span className="font-medium text-muted">vs last month</span>
              </p>
            </Card>
          );
        })}
      </div>

      {/* --- Trend + today ------------------------------------------------ */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <PanelHeading
            title="Patient overview"
            subtitle="New and returning patients over time"
            action={
              <span className="rounded-full bg-canvas px-4 py-2 text-meta font-semibold text-muted shadow-neu-inset">
                Last 7 months
              </span>
            }
          />
          <AreaChart
            points={PATIENT_TREND}
            caption="Patients seen per month over the last seven months."
          />
        </Card>

        <Card>
          <PanelHeading
            title="Today's schedule"
            subtitle="5 appointments remaining"
            action={
              <Link
                href="/appointments"
                className="rounded-2xl text-label font-semibold text-accent hover:text-accent-strong"
              >
                View all
              </Link>
            }
          />

          <ul className="flex flex-col gap-4">
            {SCHEDULE.map((row) => (
              <li key={row.time} className="flex items-center gap-3">
                <span className="tnum w-12 shrink-0 text-label font-medium text-muted">
                  {row.time}
                </span>
                <Avatar name={row.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-semibold text-ink">
                    {row.name}
                  </p>
                  <p className="truncate text-meta font-medium text-muted">
                    {row.visit}
                  </p>
                </div>
                <StatusPill tone={row.tone} hasDot={false}>
                  {row.status}
                </StatusPill>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* --- Activity + tasks --------------------------------------------- */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card isFlush>
            <div className="p-6 pb-0">
              <PanelHeading
                title="Recent patient activity"
                subtitle="Registrations, edits and payments across this clinic"
                action={
                  <Link
                    href="/registration"
                    className="rounded-2xl text-label font-semibold text-accent hover:text-accent-strong"
                  >
                    View all
                  </Link>
                }
              />
            </div>

            {/*
              The table primitive brings its own raised shell, which would be a
              second card inside this one. `shadow-none` strips it; the Card is
              the object here and the table is its contents.
            */}
            <Table
              caption="Recent patient activity across this clinic"
              className="rounded-none shadow-none"
            >
              <THead>
                <TH>Patient</TH>
                <TH>Activity</TH>
                <TH>Date</TH>
                <TH align="end">Status</TH>
              </THead>
              <TBody>
                {ACTIVITY.map((row) => (
                  <TR key={`${row.name}-${row.activity}`}>
                    <TD>
                      <span className="flex items-center gap-3">
                        <Avatar name={row.name} size="sm" />
                        <span className="font-semibold">{row.name}</span>
                      </span>
                    </TD>
                    <TD className="text-muted">{row.activity}</TD>
                    <TD className="tnum text-muted">{row.date}</TD>
                    <TD align="end">
                      <StatusPill tone={row.tone} hasDot={false}>
                        {row.status}
                      </StatusPill>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        </div>

        <Card>
          <PanelHeading
            title="Pending tasks"
            subtitle="Yours and the front desk's, for today"
            action={
              <span className="text-label font-semibold text-accent">12 total</span>
            }
          />

          <ul className="flex flex-col gap-4">
            {TASKS.map((task) => (
              <li key={task.title} className="flex items-start gap-3">
                {/*
                  A SPAN, NOT A CHECKBOX. There is no task store behind this
                  panel yet, and an input that accepts a click and then forgets
                  it is worse than a picture of one. The state is announced for
                  screen readers rather than implied by the tick alone.
                */}
                <span
                  className={cx(
                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                    task.isDone
                      ? "bg-accent text-accent-ink"
                      : "bg-canvas shadow-neu-inset",
                  )}
                >
                  {task.isDone && (
                    <Check aria-hidden="true" strokeWidth={3} className="h-3 w-3" />
                  )}
                  <span className="sr-only">
                    {task.isDone ? "Completed:" : "Not started:"}
                  </span>
                </span>

                <div className="min-w-0 flex-1">
                  <p
                    className={cx(
                      "text-body font-semibold",
                      task.isDone ? "text-muted line-through" : "text-ink",
                    )}
                  >
                    {task.title}
                  </p>
                  <p className="mt-0.5 text-meta font-medium text-muted">
                    {task.meta}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
