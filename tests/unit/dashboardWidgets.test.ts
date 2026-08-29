import { describe, expect, it } from "vitest";
import {
  DASHBOARD_LAYOUT_VERSION,
  DASHBOARD_SIZE_SPANS,
  DASHBOARD_WIDGET_LIST,
  DASHBOARD_WIDGET_SIZES,
  DASHBOARD_WIDGETS,
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
    expect(layout.widgets.find((widget) => widget.widgetId === "total-patients")?.size).toBe("full");
    expect(layout.widgets.map((widget) => widget.widgetId)).not.toContain("removed-widget");
    expect(layout.widgets).toHaveLength(DASHBOARD_WIDGET_LIST.length);
  });

  it("rejects injected ids, duplicate widgets, unsupported sizes, and extra identity fields", () => {
    expect(dashboardLayoutInputSchema.safeParse({ version: 1, widgets: [{ widgetId: "not-real", order: 0, visible: true, size: "small" }] }).success).toBe(false);
    expect(dashboardLayoutInputSchema.safeParse({ version: 1, widgets: [
      { widgetId: "total-patients", order: 0, visible: true, size: "small" },
      { widgetId: "total-patients", order: 1, visible: false, size: "small" },
    ] }).success).toBe(false);
    expect(dashboardLayoutInputSchema.safeParse({ version: 1, widgets: [{ widgetId: "patient-overview", order: 0, visible: true, size: "small" }] }).success).toBe(false);
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

  it("maps each semantic size to one global responsive width", () => {
    expect(DASHBOARD_SIZE_SPANS).toEqual({ small: 3, medium: 6, large: 9, full: 12 });
    const compactClasses = widgetGridClass("small").split(" ");
    expect(compactClasses).toContain("xl:col-span-3");
    expect(widgetGridClass("medium")).toContain("xl:col-span-6");
    expect(widgetGridClass("large")).toContain("xl:col-span-9");
    expect(widgetGridClass("full")).toContain("xl:col-span-12");
    expect(all.size).toBe(DASHBOARD_WIDGET_LIST.length);
  });

  it("keeps size options in the shared semantic order", () => {
    const rank = new Map(DASHBOARD_WIDGET_SIZES.map((size, index) => [size, index]));
    for (const widget of DASHBOARD_WIDGET_LIST) {
      expect(widget.allowedSizes).toEqual(
        [...widget.allowedSizes].sort((a, b) => rank.get(a)! - rank.get(b)!),
      );
    }
  });

  it("allows KPI expansion while keeping complex widgets at medium or larger", () => {
    const kpiIds = [
      "total-patients",
      "todays-appointments",
      "todays-collection",
      "month-revenue",
      "active-doctors",
      "pending-tasks",
      "message-acceptance",
      "revenue-summary",
    ] as const;
    for (const widgetId of kpiIds) {
      expect(DASHBOARD_WIDGETS.get(widgetId)?.allowedSizes).toEqual(DASHBOARD_WIDGET_SIZES);
    }

    const complexIds = [
      "patient-overview",
      "appointment-overview",
      "revenue-trend",
      "revenue-by-doctor",
      "today-schedule",
      "recent-patient-activity",
      "doctor-overview",
      "message-health",
      "task-overview",
      "clinic-performance",
    ] as const;
    for (const widgetId of complexIds) {
      const sizes = DASHBOARD_WIDGETS.get(widgetId)?.allowedSizes;
      expect(sizes).toEqual(["medium", "large", "full"]);
      expect(sizes).not.toContain("small");
    }
  });

  it("normalizes a historical size that a complex widget no longer supports", () => {
    const layout = normalizeDashboardLayout({
      version: 1,
      widgets: [{ widgetId: "recent-patient-activity", order: 0, visible: true, size: "small" }],
    });
    expect(layout.widgets[0]).toMatchObject({
      widgetId: "recent-patient-activity",
      size: "medium",
      order: 0,
    });
  });
});
