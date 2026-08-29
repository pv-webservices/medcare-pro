import { describe, expect, it } from "vitest";
import {
  DASHBOARD_LAYOUT_VERSION,
  DASHBOARD_WIDGET_LIST,
  dashboardDataGroupsForWidgetIds,
  dashboardLayoutInputSchema,
  filterDashboardLayout,
  normalizeDashboardLayout,
  resolveDashboardLayoutLayers,
  systemDashboardLayout,
  widgetGridClass,
  type DashboardWidgetId,
} from "@/lib/dashboardWidgets";

const all = new Set(DASHBOARD_WIDGET_LIST.map((widget) => widget.id));

describe("dashboard widget registry", () => {
  it("keeps stable unique ids and the approved system order", () => {
    const ids = DASHBOARD_WIDGET_LIST.map((widget) => widget.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.slice(0, 9)).toEqual([
      "total-patients",
      "todays-appointments",
      "todays-collection",
      "month-revenue",
      "active-doctors",
      "pending-tasks",
      "message-acceptance",
      "patient-overview",
      "appointment-overview",
    ]);
  });

  it("normalizes untrusted stored JSON and appends new registry widgets", () => {
    const layout = normalizeDashboardLayout({
      version: 1,
      widgets: [
        { widgetId: "task-overview", order: 1, visible: false, size: "large" },
        { widgetId: "removed-widget", order: 0, visible: true, size: "full" },
        { widgetId: "task-overview", order: 2, visible: true, size: "medium" },
        { widgetId: "total-patients", order: 3, visible: true, size: "full" },
      ],
    });

    expect(layout.version).toBe(DASHBOARD_LAYOUT_VERSION);
    expect(layout.widgets[0]).toMatchObject({ widgetId: "task-overview", visible: false, size: "large", order: 0 });
    expect(layout.widgets.find((widget) => widget.widgetId === "total-patients")?.size).toBe("small");
    expect(layout.widgets.map((widget) => widget.widgetId)).not.toContain("removed-widget");
    expect(layout.widgets).toHaveLength(DASHBOARD_WIDGET_LIST.length);
  });

  it("rejects injected ids, duplicate widgets, unsupported sizes, and extra identity fields", () => {
    expect(dashboardLayoutInputSchema.safeParse({ version: 1, widgets: [{ widgetId: "not-real", order: 0, visible: true, size: "small" }] }).success).toBe(false);
    expect(dashboardLayoutInputSchema.safeParse({ version: 1, widgets: [
      { widgetId: "total-patients", order: 0, visible: true, size: "small" },
      { widgetId: "total-patients", order: 1, visible: false, size: "small" },
    ] }).success).toBe(false);
    expect(dashboardLayoutInputSchema.safeParse({ version: 1, widgets: [{ widgetId: "total-patients", order: 0, visible: true, size: "full" }] }).success).toBe(false);
    expect(dashboardLayoutInputSchema.safeParse({ version: 1, userId: "someone-else", widgets: [] }).success).toBe(false);
  });

  it("resolves personal over role over system without changing authorization", () => {
    const eligible = new Set<DashboardWidgetId>(["patient-overview", "task-overview"]);
    const role = { version: 1, widgets: [{ widgetId: "task-overview", order: 0, visible: true, size: "medium" }] };
    const personal = { version: 1, widgets: [{ widgetId: "patient-overview", order: 0, visible: false, size: "large" }] };

    expect(resolveDashboardLayoutLayers({ personal, roleDefault: role, eligibleWidgetIds: eligible }).source).toBe("personal");
    expect(resolveDashboardLayoutLayers({ roleDefault: role, eligibleWidgetIds: eligible }).source).toBe("role");
    expect(resolveDashboardLayoutLayers({ eligibleWidgetIds: eligible }).source).toBe("system");
    expect(resolveDashboardLayoutLayers({ personal, roleDefault: role, eligibleWidgetIds: eligible }).layout.widgets.map((widget) => widget.widgetId)).toEqual(["patient-overview", "task-overview"]);
  });

  it("removes unauthorized widgets immediately while keeping the stored source intact", () => {
    const stored = systemDashboardLayout();
    const eligible = new Set<DashboardWidgetId>(["patient-overview"]);
    const filtered = filterDashboardLayout(stored, eligible);
    expect(filtered.widgets.map((widget) => widget.widgetId)).toEqual(["patient-overview"]);
    expect(stored.widgets.some((widget) => widget.widgetId === "revenue-trend")).toBe(true);
    expect(filterDashboardLayout(stored, new Set<DashboardWidgetId>(["patient-overview", "revenue-trend"])).widgets.map((widget) => widget.widgetId)).toEqual(["patient-overview", "revenue-trend"]);
  });

  it("derives query groups only from visible widget ids", () => {
    const groups = dashboardDataGroupsForWidgetIds(new Set<DashboardWidgetId>(["patient-overview", "task-overview"]));
    expect(groups).toEqual(new Set(["patients", "tasks"]));
    expect(groups.has("revenue")).toBe(false);
  });

  it("keeps cross-widget query dependencies in the registry", () => {
    const groups = dashboardDataGroupsForWidgetIds(new Set<DashboardWidgetId>(["doctor-overview"]));
    expect(groups).toEqual(new Set(["doctors", "revenue"]));
  });

  it("uses logical order at every breakpoint and only changes desktop spans", () => {
    const compactClasses = widgetGridClass("total-patients", "small").split(" ");
    expect(compactClasses).toContain("xl:col-span-3");
    expect(compactClasses.every((className) => className.startsWith("lg:") || className.startsWith("xl:"))).toBe(true);
    expect(widgetGridClass("patient-overview", "medium")).toContain("xl:col-span-6");
    expect(widgetGridClass("revenue-trend", "large")).toContain("xl:col-span-8");
    expect(widgetGridClass("doctor-overview", "full")).toContain("xl:col-span-12");
    expect(all.size).toBe(DASHBOARD_WIDGET_LIST.length);
  });
});
