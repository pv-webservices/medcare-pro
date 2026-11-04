import { describe, expect, it } from "vitest";
import {
  DASHBOARD_SIZE_SPANS,
  DASHBOARD_WIDGET_LIST,
  dashboardDataGroupsForWidgetIds,
  visibleDashboardWidgetIds,
  widgetGridClass,
  type DashboardWidgetId,
} from "@/lib/dashboardWidgets";

const all = new Set(DASHBOARD_WIDGET_LIST.map((widget) => widget.id));

describe("dashboard widget registry", () => {
  it("keeps stable unique ids and the approved system order", () => {
    const ids = DASHBOARD_WIDGET_LIST.map((widget) => widget.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.slice(0, 12)).toEqual([
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
    ]);
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

  it("lists the widgets of a fixed dashboard for the data query", () => {
    expect(visibleDashboardWidgetIds([
      { widgetId: "patient-overview", size: "medium" },
      { widgetId: "task-overview", size: "medium" },
    ])).toEqual(new Set(["patient-overview", "task-overview"]));
  });
});
