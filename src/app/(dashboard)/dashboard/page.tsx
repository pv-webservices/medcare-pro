import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  Check,
  IndianRupee,
  ListChecks,
  Users,
} from "lucide-react";
import AreaChart, { type AreaPoint } from "@/components/dashboard/AreaChart";
import {
  Avatar,
  MetricCard,
  PageHeader,
  Panel,
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
import { prisma } from "@/lib/prisma";
import { resolveSelectedClinicId } from "@/lib/selectedClinic";
import { requireActor } from "@/lib/session";

/*
 * Dashboard overview — PRD §6.4 (FR-4.1 … FR-4.3).
 *
 * STILL STATIC, DELIBERATELY. Every figure in the panels below is placeholder
 * data, exactly as it was before this redesign; wiring them to real queries is
 * its own stage and is not smuggled in with a restyle. The SHAPES are what
 * matter here — each panel takes the form the real data will arrive in, so the
 * swap is a data change rather than a layout one.
 *
 * The only live values on this page are the greeting and the scope line, which
 * come from the session rather than from any of the panels.
 */

interface Kpi {
  label: string;
  value: string;
  delta: number;
  icon: typeof Users;
  /** Whether a rise is a good outcome. Rising pending tasks is not. */
  isUpGood: boolean;
}

const KPIS: readonly Kpi[] = [
  { label: "Total patients", value: "1,843", delta: 12.5, icon: Users, isUpGood: true },
  { label: "Appointments today", value: "18", delta: 8.2, icon: CalendarDays, isUpGood: true },
  { label: "Monthly revenue", value: "₹4,52,300", delta: 15.4, icon: IndianRupee, isUpGood: true },
  { label: "Pending tasks", value: "12", delta: -4.1, icon: ListChecks, isUpGood: false },
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

/**
 * The greeting is cosmetic, so it is derived from the SERVER's clock and may be
 * an hour or two off for a clinic in another timezone. That is an acceptable
 * trade for not shipping a client component purely to say "good afternoon";
 * nothing downstream depends on it.
 */
function greetingFor(hour: number): string {
  if (hour < 12) {
    return "Good morning";
  }
  if (hour < 17) {
    return "Good afternoon";
  }
  return "Good evening";
}

/** "Dr Amelia Rao" becomes "Amelia" — a greeting uses a first name. */
function firstNameOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const skip = new Set(["dr", "dr.", "mr", "mr.", "mrs", "mrs.", "ms", "ms."]);
  const first = words.find((word) => !skip.has(word.toLowerCase()));
  return first ?? name;
}

/** A section link that reads as a continuation rather than as a button. */
function ViewAll({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 rounded-lg text-label font-medium text-accent transition-colors duration-150 hover:text-accent-strong"
    >
      {label}
      <ArrowRight aria-hidden="true" strokeWidth={2} className="h-3.5 w-3.5" />
    </Link>
  );
}

export default async function DashboardPage() {
  const actor = await requireActor();
  const selectedClinicId = await resolveSelectedClinicId(actor);

  // Both reads are about WHO and WHERE, not about the panels. The id has
  // already been checked against the actor's own clinic scope by
  // resolveSelectedClinicId, and the tenant filter is belt and braces.
  const [user, clinic] = await Promise.all([
    prisma.user.findFirst({
      where: { id: actor.userId, tenantId: actor.tenantId },
      select: { name: true },
    }),
    selectedClinicId
      ? prisma.clinic.findFirst({
          where: { id: selectedClinicId, tenantId: actor.tenantId },
          select: { name: true },
        })
      : Promise.resolve(null),
  ]);

  const greeting = greetingFor(new Date().getHours());
  const name = firstNameOf(user?.name ?? "there");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={`${greeting}, ${name}`}
        description="A snapshot of the day. These panels still show sample data while the reporting queries are built."
        scope={clinic?.name ?? "All clinics"}
      />

      {/* --- KPI row ------------------------------------------------------ */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {KPIS.map((kpi) => {
          const Icon = kpi.icon;

          return (
            <MetricCard
              key={kpi.label}
              label={kpi.label}
              value={kpi.value}
              delta={kpi.delta}
              isUpGood={kpi.isUpGood}
              deltaCaption="vs last month"
              icon={<Icon strokeWidth={2} className="h-[18px] w-[18px]" />}
            />
          );
        })}
      </div>

      {/* --- Trend + today ------------------------------------------------ */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel
          title="Patient overview"
          description="New and returning patients over time"
          className="xl:col-span-2"
          actions={
            <span className="rounded-full border border-line bg-canvas-deep px-2.5 py-1 text-meta font-medium text-muted">
              Last 7 months
            </span>
          }
        >
          <AreaChart
            points={PATIENT_TREND}
            caption="Patients seen per month over the last seven months."
          />
        </Panel>

        <Panel
          title="Today's schedule"
          description="5 appointments remaining"
          actions={<ViewAll href="/appointments" label="All appointments" />}
        >
          <ul className="flex flex-col">
            {SCHEDULE.map((row) => (
              <li
                key={row.time}
                className="flex items-center gap-3 border-b border-line py-2.5 last:border-b-0 last:pb-0 first:pt-0"
              >
                <span className="tnum w-11 shrink-0 text-label font-medium text-muted">
                  {row.time}
                </span>
                <Avatar name={row.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-medium text-ink">
                    {row.name}
                  </p>
                  <p className="truncate text-meta text-muted">{row.visit}</p>
                </div>
                <StatusPill tone={row.tone}>{row.status}</StatusPill>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {/* --- Activity + tasks --------------------------------------------- */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel
          title="Recent patient activity"
          description="Registrations, edits and payments across this clinic"
          className="xl:col-span-2"
          isFlush
          hasDivider
          actions={<ViewAll href="/registration" label="All registrations" />}
        >
          {/*
            The table primitive brings its own bordered shell, which inside a
            panel would be a second surface around the same rows. Stripping the
            border and radius leaves the panel as the object and the table as
            its contents.
          */}
          <Table
            caption="Recent patient activity across this clinic"
            className="rounded-none border-0 shadow-none"
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
                  <TD isPrimary>
                    <span className="flex items-center gap-2.5">
                      <Avatar name={row.name} size="sm" />
                      {row.name}
                    </span>
                  </TD>
                  <TD>{row.activity}</TD>
                  <TD className="tnum whitespace-nowrap">{row.date}</TD>
                  <TD align="end">
                    <StatusPill tone={row.tone}>{row.status}</StatusPill>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Panel>

        <Panel
          title="Pending tasks"
          description="Yours and the front desk's, for today"
          actions={
            <span className="tnum text-label font-medium text-muted">
              12 open
            </span>
          }
        >
          <ul className="flex flex-col gap-3.5">
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
                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
                    task.isDone
                      ? "border-accent bg-accent text-accent-ink"
                      : "border-line-strong bg-canvas",
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
                      "text-body",
                      task.isDone
                        ? "text-muted line-through"
                        : "font-medium text-ink",
                    )}
                  >
                    {task.title}
                  </p>
                  <p className="mt-0.5 text-meta text-muted">{task.meta}</p>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
