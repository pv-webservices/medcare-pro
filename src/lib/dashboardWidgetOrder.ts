import type { DashboardWidgetId, DashboardWidgetPreference } from "@/lib/dashboardWidgets";

/**
 * Reorders only the visible sequence, then places it back into the visible
 * slots of the complete layout. Hidden preferences keep their slot and data,
 * so they cannot corrupt indexes used by the sortable collection.
 */
export function reorderVisibleDashboardWidgets(
  current: readonly DashboardWidgetPreference[],
  activeId: DashboardWidgetId,
  overId: DashboardWidgetId,
): DashboardWidgetPreference[] {
  if (activeId === overId) return current as DashboardWidgetPreference[];

  const logical = [...current].sort((a, b) => a.order - b.order);
  const visible = logical.filter((item) => item.visible);
  const oldIndex = visible.findIndex((item) => item.widgetId === activeId);
  const newIndex = visible.findIndex((item) => item.widgetId === overId);

  if (oldIndex < 0 || newIndex < 0) return current as DashboardWidgetPreference[];

  const reorderedVisible = [...visible];
  const [moved] = reorderedVisible.splice(oldIndex, 1);
  reorderedVisible.splice(newIndex, 0, moved);

  let visibleIndex = 0;
  return logical.map((item, order) => ({
    ...(item.visible ? reorderedVisible[visibleIndex++] : item),
    order,
  }));
}
