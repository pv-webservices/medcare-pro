import { describe, expect, it } from "vitest";
import { reorderVisibleDashboardWidgets } from "@/lib/dashboardWidgetOrder";
import type { DashboardWidgetId, DashboardWidgetPreference } from "@/lib/dashboardWidgets";

function preference(
  widgetId: DashboardWidgetId,
  order: number,
  visible = true,
): DashboardWidgetPreference {
  return { widgetId, order, visible, size: "small" };
}

describe("visible dashboard widget ordering", () => {
  it("moves a trailing widget before an earlier visible widget and normalizes orders", () => {
    const current = [
      preference("total-patients", 0),
      preference("todays-appointments", 1),
      preference("todays-collection", 2),
      preference("month-revenue", 3),
    ];

    const result = reorderVisibleDashboardWidgets(
      current,
      "month-revenue",
      "todays-appointments",
    );

    expect(result.map((item) => item.widgetId)).toEqual([
      "total-patients",
      "month-revenue",
      "todays-appointments",
      "todays-collection",
    ]);
    expect(result.map((item) => item.order)).toEqual([0, 1, 2, 3]);
  });

  it("reorders visible slots deterministically without using a hidden widget index", () => {
    const current = [
      preference("total-patients", 0),
      preference("todays-appointments", 1, false),
      preference("todays-collection", 2),
      preference("month-revenue", 3),
    ];

    const result = reorderVisibleDashboardWidgets(
      current,
      "month-revenue",
      "total-patients",
    );

    expect(result.map((item) => [item.widgetId, item.visible])).toEqual([
      ["month-revenue", true],
      ["todays-appointments", false],
      ["total-patients", true],
      ["todays-collection", true],
    ]);
    expect(result.filter((item) => item.visible).map((item) => item.widgetId)).toEqual([
      "month-revenue",
      "total-patients",
      "todays-collection",
    ]);
    expect(result.map((item) => item.order)).toEqual([0, 1, 2, 3]);
  });

  it("leaves state untouched when either drag id is outside the visible collection", () => {
    const current = [
      preference("total-patients", 0),
      preference("todays-appointments", 1, false),
    ];
    expect(reorderVisibleDashboardWidgets(current, "todays-appointments", "total-patients")).toBe(current);
    expect(reorderVisibleDashboardWidgets(current, "total-patients", "todays-appointments")).toBe(current);
  });
});
