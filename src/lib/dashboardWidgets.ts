import { MODULE_FEATURES, type ModuleFeatureKey } from "@/lib/moduleFeatures";

export const DASHBOARD_WIDGET_SIZES = ["small", "medium", "large", "full"] as const;
export type DashboardWidgetSize = (typeof DASHBOARD_WIDGET_SIZES)[number];

/** Semantic size is the only source of dashboard width. */
export const DASHBOARD_SIZE_SPANS: Readonly<Record<DashboardWidgetSize, number>> = {
  small: 3,
  medium: 6,
  large: 9,
  full: 12,
};

export type DashboardWidgetDataGroup =
  | "patients"
  | "appointments"
  | "revenue"
  | "doctors"
  | "messages"
  | "tasks"
  | "schedule"
  | "activity"
  | "clinics";

export const DASHBOARD_WIDGET_IDS = [
  "total-patients",
  "todays-appointments",
  "waiting-now",
  "upcoming-appointments-count",
  "completed-today",
  "todays-collection",
  "month-revenue",
  "active-doctors",
  "pending-tasks",
  "message-acceptance",
  "patient-overview",
  "appointment-overview",
  "revenue-trend",
  "revenue-summary",
  "revenue-by-doctor",
  "today-schedule",
  "next-patient",
  "upcoming-schedule",
  "recent-patient-activity",
  "doctor-overview",
  "message-health",
  "task-overview",
  "clinic-performance",
] as const;
export type DashboardWidgetId = (typeof DASHBOARD_WIDGET_IDS)[number];

export interface DashboardWidgetDefinition {
  id: DashboardWidgetId;
  title: string;
  description: string;
  requiredPermission: string;
  requiredModule: ModuleFeatureKey;
  dataGroup: DashboardWidgetDataGroup;
  /** Extra authorized query groups needed to render the widget completely. */
  additionalDataGroups?: readonly DashboardWidgetDataGroup[];
  /** Shown in the standard fixed order (see lib/dashboardWidgetOrder.ts). */
  defaultVisible: boolean;
  defaultSize: DashboardWidgetSize;
}

const kpi = (
  id: DashboardWidgetId,
  title: string,
  description: string,
  requiredPermission: string,
  requiredModule: ModuleFeatureKey,
  dataGroup: DashboardWidgetDataGroup,
): DashboardWidgetDefinition => ({
  id,
  title,
  description,
  requiredPermission,
  requiredModule,
  dataGroup,
  defaultVisible: true,
  defaultSize: "small",
});

export const DASHBOARD_WIDGET_LIST = [
  kpi("total-patients", "Total patients", "Patient count and period growth.", "dashboard:patients:view", MODULE_FEATURES.registrations, "patients"),
  kpi("todays-appointments", "Today's appointments", "Today's booked clinical workload.", "dashboard:appointments:view", MODULE_FEATURES.appointments, "appointments"),
  {
    ...kpi("waiting-now", "Waiting now", "Patients currently checked in and waiting.", "dashboard:appointments:view", MODULE_FEATURES.appointments, "appointments"),
    defaultVisible: false,
  },
  {
    ...kpi("upcoming-appointments-count", "Upcoming", "Active appointments still ahead.", "dashboard:appointments:view", MODULE_FEATURES.appointments, "appointments"),
    defaultVisible: false,
  },
  {
    ...kpi("completed-today", "Completed", "Appointments converted to visits today.", "dashboard:appointments:view", MODULE_FEATURES.appointments, "appointments"),
    defaultVisible: false,
  },
  kpi("todays-collection", "Today's collection", "Registration-backed collections today.", "dashboard:revenue:view", MODULE_FEATURES.reports, "revenue"),
  kpi("month-revenue", "Month-to-date revenue", "Collections recorded this month.", "dashboard:revenue:view", MODULE_FEATURES.reports, "revenue"),
  kpi("active-doctors", "Active doctors", "Current doctor coverage and availability.", "dashboard:doctors:view", MODULE_FEATURES.doctors, "doctors"),
  kpi("pending-tasks", "Pending tasks", "Personal pending and overdue work.", "dashboard:tasks:view", MODULE_FEATURES.tasks, "tasks"),
  kpi("message-acceptance", "Message acceptance", "Today's stored messaging outcomes.", "dashboard:messages:view", MODULE_FEATURES.whatsapp, "messages"),
  {
    id: "patient-overview",
    title: "Patient overview",
    description: "Patient growth, visit mix, and recent registrations.",
    requiredPermission: "dashboard:patients:view",
    requiredModule: MODULE_FEATURES.registrations,
    dataGroup: "patients",
    defaultVisible: true,
    defaultSize: "medium",
  },
  {
    id: "appointment-overview",
    title: "Appointment overview",
    description: "Demand, arrivals, outcomes, and appointment trends.",
    requiredPermission: "dashboard:appointments:view",
    requiredModule: MODULE_FEATURES.appointments,
    dataGroup: "appointments",
    defaultVisible: true,
    defaultSize: "medium",
  },
  {
    id: "revenue-trend",
    title: "Revenue trend",
    description: "Registration-backed collections over the selected period.",
    requiredPermission: "dashboard:revenue:view",
    requiredModule: MODULE_FEATURES.reports,
    dataGroup: "revenue",
    defaultVisible: true,
    defaultSize: "large",
  },
  {
    id: "revenue-summary",
    title: "Revenue summary",
    description: "Current collection checkpoints and average per visit.",
    requiredPermission: "dashboard:revenue:view",
    requiredModule: MODULE_FEATURES.reports,
    dataGroup: "revenue",
    defaultVisible: true,
    defaultSize: "small",
  },
  {
    id: "revenue-by-doctor",
    title: "Revenue by doctor",
    description: "Attributed registrations and revenue in this period.",
    requiredPermission: "dashboard:revenue:view",
    requiredModule: MODULE_FEATURES.reports,
    dataGroup: "revenue",
    defaultVisible: true,
    defaultSize: "full",
  },
  {
    id: "today-schedule",
    title: "Today's timeline",
    description: "The complete operational day in chronological order.",
    requiredPermission: "dashboard:schedule:view",
    requiredModule: MODULE_FEATURES.appointments,
    dataGroup: "schedule",
    defaultVisible: true,
    defaultSize: "large",
  },
  {
    id: "next-patient",
    title: "Waiting / next patient",
    description: "Prioritises a checked-in patient, then the nearest upcoming booking.",
    requiredPermission: "dashboard:schedule:view",
    requiredModule: MODULE_FEATURES.appointments,
    dataGroup: "schedule",
    defaultVisible: false,
    defaultSize: "medium",
  },
  {
    id: "upcoming-schedule",
    title: "Upcoming appointments",
    description: "The doctor's next seven days grouped by date.",
    requiredPermission: "dashboard:schedule:view",
    requiredModule: MODULE_FEATURES.appointments,
    dataGroup: "schedule",
    defaultVisible: false,
    defaultSize: "full",
  },
  {
    id: "recent-patient-activity",
    title: "Recent patient activity",
    description: "Latest events within the current clinic scope.",
    requiredPermission: "dashboard:activity:view",
    requiredModule: MODULE_FEATURES.registrations,
    dataGroup: "activity",
    defaultVisible: true,
    defaultSize: "medium",
  },
  {
    id: "doctor-overview",
    title: "Doctor overview",
    description: "Coverage, availability, and clinical workload.",
    requiredPermission: "dashboard:doctors:view",
    requiredModule: MODULE_FEATURES.doctors,
    dataGroup: "doctors",
    additionalDataGroups: ["revenue"],
    defaultVisible: true,
    defaultSize: "full",
  },
  {
    id: "message-health",
    title: "Message health",
    description: "Sent, accepted, pending, and failed messages.",
    requiredPermission: "dashboard:messages:view",
    requiredModule: MODULE_FEATURES.whatsapp,
    dataGroup: "messages",
    defaultVisible: true,
    defaultSize: "medium",
  },
  {
    id: "task-overview",
    title: "Task overview",
    description: "Deadlines and current personal or team workload.",
    requiredPermission: "dashboard:tasks:view",
    requiredModule: MODULE_FEATURES.tasks,
    dataGroup: "tasks",
    defaultVisible: true,
    defaultSize: "medium",
  },
  {
    id: "clinic-performance",
    title: "Clinic performance",
    description: "A permitted comparison across accessible clinics.",
    requiredPermission: "dashboard:clinics:view",
    requiredModule: MODULE_FEATURES.clinics,
    dataGroup: "clinics",
    defaultVisible: true,
    defaultSize: "full",
  },
] as const satisfies readonly DashboardWidgetDefinition[];

export const DASHBOARD_WIDGETS = new Map<DashboardWidgetId, DashboardWidgetDefinition>(
  DASHBOARD_WIDGET_LIST.map((widget) => [widget.id, widget]),
);

/** One widget in the fixed dashboard: what it is and how wide it renders. */
export interface DashboardWidgetPlacement {
  widgetId: DashboardWidgetId;
  size: DashboardWidgetSize;
}

export function dashboardDataGroupsForWidgetIds(
  widgetIds: ReadonlySet<DashboardWidgetId>,
): Set<DashboardWidgetDataGroup> {
  const groups = new Set<DashboardWidgetDataGroup>();
  for (const widgetId of widgetIds) {
    const widget = DASHBOARD_WIDGETS.get(widgetId);
    if (!widget) continue;
    groups.add(widget.dataGroup);
    for (const dependency of widget.additionalDataGroups ?? []) groups.add(dependency);
  }
  return groups;
}

export function visibleDashboardWidgetIds(
  widgets: readonly DashboardWidgetPlacement[],
): Set<DashboardWidgetId> {
  return new Set(widgets.map((widget) => widget.widgetId));
}

export function widgetGridClass(size: DashboardWidgetSize): string {
  const responsive = {
    small: "sm:col-span-1 lg:col-span-6",
    medium: "sm:col-span-2 lg:col-span-6",
    large: "sm:col-span-2 lg:col-span-12",
    full: "sm:col-span-2 lg:col-span-12",
  }[size];
  const desktop = {
    3: "xl:col-span-3",
    6: "xl:col-span-6",
    9: "xl:col-span-9",
    12: "xl:col-span-12",
  }[DASHBOARD_SIZE_SPANS[size]];
  return `${responsive} ${desktop}`;
}
