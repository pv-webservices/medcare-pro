import {
  DASHBOARD_WIDGET_LIST,
  type DashboardWidgetId,
  type DashboardWidgetPlacement,
} from "@/lib/dashboardWidgets";

/**
 * The dashboard has one fixed order. Nobody can rearrange it (RM-2 retired
 * personal layouts and role defaults); each user simply sees the widgets their
 * permissions and the organisation's modules allow, in this order.
 *
 * Two orders exist because they did before RM-2: every tenant's Doctor role was
 * seeded with a "My Day" role default, so a doctor who never customised saw
 * that, and everybody else saw the catalogue's default. Both are reproduced
 * here exactly so nobody's dashboard changes unless they had customised it.
 */
export type DashboardWidgetOrderProfile = "standard" | "doctor";

/** Catalogue order, default-visible widgets only, at their default sizes. */
export const STANDARD_DASHBOARD_WIDGETS: readonly DashboardWidgetPlacement[] =
  DASHBOARD_WIDGET_LIST.filter((widget) => widget.defaultVisible).map((widget) => ({
    widgetId: widget.id,
    size: widget.defaultSize,
  }));

/** Doctor "My Day": an operational view without admin analytics. */
export const DOCTOR_DASHBOARD_WIDGETS: readonly DashboardWidgetPlacement[] = [
  { widgetId: "todays-appointments", size: "small" },
  { widgetId: "waiting-now", size: "small" },
  { widgetId: "upcoming-appointments-count", size: "small" },
  { widgetId: "completed-today", size: "small" },
  { widgetId: "next-patient", size: "medium" },
  { widgetId: "today-schedule", size: "full" },
  { widgetId: "upcoming-schedule", size: "full" },
  { widgetId: "task-overview", size: "medium" },
];

/** The fixed order for a profile, keeping only widgets the user may see. */
export function fixedDashboardWidgets(
  profile: DashboardWidgetOrderProfile,
  eligibleWidgetIds: ReadonlySet<DashboardWidgetId>,
): DashboardWidgetPlacement[] {
  const order = profile === "doctor" ? DOCTOR_DASHBOARD_WIDGETS : STANDARD_DASHBOARD_WIDGETS;
  return order.filter((widget) => eligibleWidgetIds.has(widget.widgetId));
}
