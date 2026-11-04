import { describe, expect, it } from "vitest";
import { DASHBOARD_WIDGET_LIST, type DashboardWidgetId } from "@/lib/dashboardWidgets";
import {
  DOCTOR_DASHBOARD_WIDGETS,
  STANDARD_DASHBOARD_WIDGETS,
  fixedDashboardWidgets,
} from "@/lib/dashboardWidgetOrder";

const all = new Set<DashboardWidgetId>(DASHBOARD_WIDGET_LIST.map((widget) => widget.id));

describe("fixed dashboard order", () => {
  it("shows the standard default exactly as a user with no saved layout saw it", () => {
    expect(fixedDashboardWidgets("standard", all)).toEqual([
      { widgetId: "total-patients", size: "small" },
      { widgetId: "todays-appointments", size: "small" },
      { widgetId: "todays-collection", size: "small" },
      { widgetId: "month-revenue", size: "small" },
      { widgetId: "active-doctors", size: "small" },
      { widgetId: "pending-tasks", size: "small" },
      { widgetId: "message-acceptance", size: "small" },
      { widgetId: "patient-overview", size: "medium" },
      { widgetId: "appointment-overview", size: "medium" },
      { widgetId: "revenue-trend", size: "large" },
      { widgetId: "revenue-summary", size: "small" },
      { widgetId: "revenue-by-doctor", size: "full" },
      { widgetId: "today-schedule", size: "large" },
      { widgetId: "recent-patient-activity", size: "medium" },
      { widgetId: "doctor-overview", size: "full" },
      { widgetId: "message-health", size: "medium" },
      { widgetId: "task-overview", size: "medium" },
      { widgetId: "clinic-performance", size: "full" },
    ]);
  });

  it("keeps the Doctor My Day order and sizes", () => {
    expect(fixedDashboardWidgets("doctor", all)).toEqual([
      { widgetId: "todays-appointments", size: "small" },
      { widgetId: "waiting-now", size: "small" },
      { widgetId: "upcoming-appointments-count", size: "small" },
      { widgetId: "completed-today", size: "small" },
      { widgetId: "next-patient", size: "medium" },
      { widgetId: "today-schedule", size: "full" },
      { widgetId: "upcoming-schedule", size: "full" },
      { widgetId: "task-overview", size: "medium" },
    ]);
    const ids = DOCTOR_DASHBOARD_WIDGETS.map((widget) => widget.widgetId);
    expect(ids).not.toContain("revenue-by-doctor");
    expect(ids).not.toContain("message-health");
    expect(ids).not.toContain("clinic-performance");
  });

  it("never shows a widget the user is not eligible for", () => {
    const eligible = new Set<DashboardWidgetId>(["task-overview", "patient-overview", "waiting-now"]);
    expect(fixedDashboardWidgets("standard", eligible).map((widget) => widget.widgetId)).toEqual([
      "patient-overview",
      "task-overview",
    ]);
    expect(fixedDashboardWidgets("doctor", eligible).map((widget) => widget.widgetId)).toEqual([
      "waiting-now",
      "task-overview",
    ]);
    expect(fixedDashboardWidgets("standard", new Set())).toEqual([]);
  });

  it("lists every widget at most once", () => {
    for (const order of [STANDARD_DASHBOARD_WIDGETS, DOCTOR_DASHBOARD_WIDGETS]) {
      const ids = order.map((widget) => widget.widgetId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
