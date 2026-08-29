import { z } from "zod";
import { MODULE_FEATURES, type ModuleFeatureKey } from "@/lib/moduleFeatures";

export const DASHBOARD_LAYOUT_VERSION = 1 as const;

export const DASHBOARD_WIDGET_SIZES = ["small", "medium", "large", "full"] as const;
export type DashboardWidgetSize = (typeof DASHBOARD_WIDGET_SIZES)[number];

export const DASHBOARD_WIDGET_CATEGORIES = [
  "summary",
  "patients",
  "appointments",
  "revenue",
  "doctors",
  "tasks",
  "messages",
  "activity",
] as const;
export type DashboardWidgetCategory = (typeof DASHBOARD_WIDGET_CATEGORIES)[number];

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
  defaultVisible: boolean;
  defaultSize: DashboardWidgetSize;
  allowedSizes: readonly DashboardWidgetSize[];
  category: DashboardWidgetCategory;
  /** Desktop grid columns out of twelve. Sizes remain semantic per widget. */
  spans: Readonly<Partial<Record<DashboardWidgetSize, number>>>;
}

const kpi = (
  id: DashboardWidgetId,
  title: string,
  description: string,
  requiredPermission: string,
  requiredModule: ModuleFeatureKey,
  dataGroup: DashboardWidgetDataGroup,
  category: DashboardWidgetCategory,
): DashboardWidgetDefinition => ({
  id,
  title,
  description,
  requiredPermission,
  requiredModule,
  dataGroup,
  defaultVisible: true,
  defaultSize: "small",
  allowedSizes: ["small"],
  category,
  spans: { small: 3 },
});

export const DASHBOARD_WIDGET_LIST = [
  kpi("total-patients", "Total patients", "Patient count and period growth.", "dashboard:patients:view", MODULE_FEATURES.registrations, "patients", "summary"),
  kpi("todays-appointments", "Today's appointments", "Today's booked clinical workload.", "dashboard:appointments:view", MODULE_FEATURES.appointments, "appointments", "summary"),
  kpi("todays-collection", "Today's collection", "Registration-backed collections today.", "dashboard:revenue:view", MODULE_FEATURES.reports, "revenue", "summary"),
  kpi("month-revenue", "Month-to-date revenue", "Collections recorded this month.", "dashboard:revenue:view", MODULE_FEATURES.reports, "revenue", "summary"),
  kpi("active-doctors", "Active doctors", "Current doctor coverage and availability.", "dashboard:doctors:view", MODULE_FEATURES.doctors, "doctors", "summary"),
  kpi("pending-tasks", "Pending tasks", "Personal pending and overdue work.", "dashboard:tasks:view", MODULE_FEATURES.tasks, "tasks", "summary"),
  { ...kpi("message-acceptance", "Message acceptance", "Today's stored messaging outcomes.", "dashboard:messages:view", MODULE_FEATURES.whatsapp, "messages", "summary"), spans: { small: 6 } },
  {
    id: "patient-overview",
    title: "Patient overview",
    description: "Patient growth, visit mix, and recent registrations.",
    requiredPermission: "dashboard:patients:view",
    requiredModule: MODULE_FEATURES.registrations,
    dataGroup: "patients",
    defaultVisible: true,
    defaultSize: "medium",
    allowedSizes: ["medium", "large", "full"],
    category: "patients",
    spans: { medium: 6, large: 8, full: 12 },
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
    allowedSizes: ["medium", "large", "full"],
    category: "appointments",
    spans: { medium: 6, large: 8, full: 12 },
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
    allowedSizes: ["medium", "large", "full"],
    category: "revenue",
    spans: { medium: 6, large: 8, full: 12 },
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
    allowedSizes: ["small", "medium"],
    category: "revenue",
    spans: { small: 4, medium: 6 },
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
    allowedSizes: ["large", "full"],
    category: "revenue",
    spans: { large: 8, full: 12 },
  },
  {
    id: "today-schedule",
    title: "Today's schedule",
    description: "Next appointments in chronological order.",
    requiredPermission: "dashboard:schedule:view",
    requiredModule: MODULE_FEATURES.appointments,
    dataGroup: "schedule",
    defaultVisible: true,
    defaultSize: "large",
    allowedSizes: ["medium", "large", "full"],
    category: "appointments",
    spans: { medium: 6, large: 8, full: 12 },
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
    allowedSizes: ["small", "medium", "large"],
    category: "activity",
    spans: { small: 4, medium: 4, large: 8 },
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
    allowedSizes: ["large", "full"],
    category: "doctors",
    spans: { large: 8, full: 12 },
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
    allowedSizes: ["medium", "large", "full"],
    category: "messages",
    spans: { medium: 6, large: 8, full: 12 },
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
    allowedSizes: ["medium", "large", "full"],
    category: "tasks",
    spans: { medium: 6, large: 8, full: 12 },
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
    allowedSizes: ["large", "full"],
    category: "summary",
    spans: { large: 8, full: 12 },
  },
] as const satisfies readonly DashboardWidgetDefinition[];

export const DASHBOARD_WIDGETS = new Map<DashboardWidgetId, DashboardWidgetDefinition>(
  DASHBOARD_WIDGET_LIST.map((widget) => [widget.id, widget]),
);

export interface DashboardWidgetPreference {
  widgetId: DashboardWidgetId;
  order: number;
  visible: boolean;
  size: DashboardWidgetSize;
}

export interface DashboardLayoutConfig {
  version: typeof DASHBOARD_LAYOUT_VERSION;
  widgets: DashboardWidgetPreference[];
}

const preferenceSchema = z.object({
  widgetId: z.string().min(1),
  order: z.number().int().min(0).max(10_000),
  visible: z.boolean(),
  size: z.enum(DASHBOARD_WIDGET_SIZES),
}).strict();

const dashboardPreferenceInputSchema = preferenceSchema.extend({
  widgetId: z.enum(DASHBOARD_WIDGET_IDS),
});

export const dashboardLayoutInputSchema = z.object({
  version: z.literal(DASHBOARD_LAYOUT_VERSION),
  widgets: z.array(dashboardPreferenceInputSchema).max(50, "Too many dashboard widgets."),
}).strict().superRefine((layout, context) => {
  const seen = new Set<string>();
  for (const [index, preference] of layout.widgets.entries()) {
    if (seen.has(preference.widgetId)) {
      context.addIssue({ code: "custom", message: "A dashboard widget cannot appear twice.", path: ["widgets", index, "widgetId"] });
      continue;
    }
    seen.add(preference.widgetId);

    const widget = DASHBOARD_WIDGETS.get(preference.widgetId as DashboardWidgetId);
    if (!widget) {
      context.addIssue({ code: "custom", message: "Unknown dashboard widget.", path: ["widgets", index, "widgetId"] });
    } else if (!widget.allowedSizes.includes(preference.size)) {
      context.addIssue({ code: "custom", message: `“${widget.title}” does not support that size.`, path: ["widgets", index, "size"] });
    }
  }
});

export function systemDashboardLayout(): DashboardLayoutConfig {
  return {
    version: DASHBOARD_LAYOUT_VERSION,
    widgets: DASHBOARD_WIDGET_LIST.map((widget, order) => ({
      widgetId: widget.id,
      order,
      visible: widget.defaultVisible,
      size: widget.defaultSize,
    })),
  };
}

/** Stored JSON is untrusted and may come from an older widget catalogue. */
export function normalizeDashboardLayout(value: unknown): DashboardLayoutConfig {
  const raw = value && typeof value === "object" && "widgets" in value
    ? (value as { widgets?: unknown }).widgets
    : undefined;
  const stored = Array.isArray(raw) ? raw : [];
  const preferences = new Map<DashboardWidgetId, DashboardWidgetPreference>();

  for (const candidate of stored) {
    const parsed = preferenceSchema.safeParse(candidate);
    if (!parsed.success) continue;
    const widget = DASHBOARD_WIDGETS.get(parsed.data.widgetId as DashboardWidgetId);
    if (!widget || preferences.has(widget.id)) continue;
    preferences.set(widget.id, {
      widgetId: widget.id,
      order: parsed.data.order,
      visible: parsed.data.visible,
      size: widget.allowedSizes.includes(parsed.data.size) ? parsed.data.size : widget.defaultSize,
    });
  }

  const ordered = [...preferences.values()].sort((a, b) => a.order - b.order);
  for (const fallback of systemDashboardLayout().widgets) {
    if (!preferences.has(fallback.widgetId)) ordered.push(fallback);
  }

  return {
    version: DASHBOARD_LAYOUT_VERSION,
    widgets: ordered.map((preference, order) => ({ ...preference, order })),
  };
}

export function filterDashboardLayout(
  layout: DashboardLayoutConfig,
  eligibleWidgetIds: ReadonlySet<DashboardWidgetId>,
): DashboardLayoutConfig {
  return {
    version: DASHBOARD_LAYOUT_VERSION,
    widgets: layout.widgets
      .filter((preference) => eligibleWidgetIds.has(preference.widgetId))
      .map((preference, order) => ({ ...preference, order })),
  };
}

export function resolveDashboardLayoutLayers(options: {
  personal?: unknown;
  roleDefault?: unknown;
  eligibleWidgetIds: ReadonlySet<DashboardWidgetId>;
}): { layout: DashboardLayoutConfig; source: "personal" | "role" | "system" } {
  const source = options.personal !== undefined
    ? "personal"
    : options.roleDefault !== undefined
      ? "role"
      : "system";
  const raw = source === "personal"
    ? options.personal
    : source === "role"
      ? options.roleDefault
      : systemDashboardLayout();
  return {
    source,
    layout: filterDashboardLayout(normalizeDashboardLayout(raw), options.eligibleWidgetIds),
  };
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

export function visibleDashboardWidgetIds(layout: DashboardLayoutConfig): Set<DashboardWidgetId> {
  return new Set(layout.widgets.filter((widget) => widget.visible).map((widget) => widget.widgetId));
}

export function widgetGridClass(widgetId: DashboardWidgetId, size: DashboardWidgetSize): string {
  const span = DASHBOARD_WIDGETS.get(widgetId)?.spans[size] ?? 12;
  const desktop = {
    3: "xl:col-span-3",
    4: "xl:col-span-4",
    6: "xl:col-span-6",
    8: "xl:col-span-8",
    12: "xl:col-span-12",
  }[span] ?? "xl:col-span-12";
  const laptop = span <= 6 ? "lg:col-span-6" : "lg:col-span-12";
  return `${laptop} ${desktop}`;
}
