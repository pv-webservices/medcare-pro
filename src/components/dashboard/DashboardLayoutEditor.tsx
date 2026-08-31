"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Activity,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  Calendar,
  Check,
  CheckSquare2,
  CircleDollarSign,
  Eye,
  EyeOff,
  GripVertical,
  LayoutGrid,
  MessageSquare,
  PieChart,
  RotateCcw,
  Save,
  Settings2,
  Stethoscope,
  Users,
  X,
} from "lucide-react";
import { Button, cx } from "@/components/ui";
import Select from "@/components/ui/Select";
import {
  DASHBOARD_WIDGET_CATEGORIES,
  DASHBOARD_WIDGETS,
  widgetGridClass,
  type DashboardLayoutConfig,
  type DashboardWidgetCategory,
  type DashboardWidgetId,
  type DashboardWidgetPreference,
} from "@/lib/dashboardWidgets";
import { reorderVisibleDashboardWidgets } from "@/lib/dashboardWidgetOrder";
import type { ApiResponse } from "@/lib/utils";

export interface DashboardWidgetSlot {
  id: DashboardWidgetId;
  content: ReactNode;
}

interface Props {
  initialLayout: DashboardLayoutConfig;
  widgets: readonly DashboardWidgetSlot[];
  canCustomize?: boolean;
  sourceLabel?: string;
  endpoint?: string;
  resetConfirmation?: string;
  startInEditMode?: boolean;
  editorTitle?: string;
  onSaved?: (layout: DashboardLayoutConfig) => void;
}

const CATEGORY_LABELS: Record<DashboardWidgetCategory, string> = {
  summary: "Overview",
  patients: "Patients",
  appointments: "Appointments",
  revenue: "Revenue",
  doctors: "Doctors",
  tasks: "Tasks",
  messages: "Messages",
  activity: "Activity",
};

const CATEGORY_ICONS: Record<DashboardWidgetCategory, typeof PieChart> = {
  summary: PieChart,
  patients: Users,
  appointments: Calendar,
  revenue: CircleDollarSign,
  doctors: Stethoscope,
  tasks: CheckSquare2,
  messages: MessageSquare,
  activity: Activity,
};

const END_DROP_ID = "dashboard-layout-end";

const dashboardCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) return pointerCollisions;

  const intersectingCollisions = rectIntersection(args);
  if (intersectingCollisions.length > 0) return intersectingCollisions;

  return closestCenter(args);
};

function dashboardWidgetId(value: UniqueIdentifier | null | undefined): DashboardWidgetId | null {
  if (value === null || value === undefined) return null;
  const candidate = String(value) as DashboardWidgetId;
  return DASHBOARD_WIDGETS.has(candidate) ? candidate : null;
}

function ordered(items: readonly DashboardWidgetPreference[]): DashboardWidgetPreference[] {
  return [...items]
    .sort((a, b) => a.order - b.order)
    .map((item, order) => ({ ...item, order }));
}

function extractLayout(value: unknown): DashboardLayoutConfig | null {
  if (!value || typeof value !== "object") return null;
  if ("layout" in value) return (value as { layout: DashboardLayoutConfig }).layout;
  if ("widgets" in value) return value as DashboardLayoutConfig;
  return null;
}

function SortableWidget({
  item,
  content,
  index,
  total,
  onChangeSize,
  onHide,
  onMove,
}: {
  item: DashboardWidgetPreference;
  content: ReactNode;
  index: number;
  total: number;
  onChangeSize: (size: DashboardWidgetPreference["size"]) => void;
  onHide: () => void;
  onMove: (to: number) => void;
}) {
  const definition = DASHBOARD_WIDGETS.get(item.widgetId)!;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({ id: item.widgetId });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cx(
        "min-w-0 rounded-2xl border border-dashed border-accent/35 bg-accent-soft/20 p-1.5 motion-reduce:transition-none",
        widgetGridClass(item.size),
        isOver && !isDragging && "border-accent bg-accent-soft/35 shadow-raised",
        isDragging && "relative z-30 border-accent/70 bg-accent-soft/30 opacity-35 shadow-none",
      )}
    >
      <div className="mb-1.5 flex min-h-10 flex-wrap items-center gap-1 px-1">
        <button
          type="button"
          aria-label={`Drag ${definition.title}`}
          title={`Drag ${definition.title}`}
          className="inline-flex h-9 w-9 cursor-grab touch-none items-center justify-center rounded-xl text-muted hover:bg-canvas hover:text-accent active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" aria-hidden="true" />
        </button>
        <span className="mr-auto min-w-0 truncate px-1 text-label font-semibold text-ink">{definition.title}</span>

        {definition.allowedSizes.length > 1 && (
          <div className="w-24">
            <Select
              id={`widget-size-${item.widgetId}`}
              label={`Size for ${definition.title}`}
              isLabelHidden
              value={item.size}
              onChange={(event) => onChangeSize(event.target.value as DashboardWidgetPreference["size"])}
              className="min-h-8 py-0.5 text-meta font-medium capitalize text-muted"
            >
              {definition.allowedSizes.map((size) => <option key={size} value={size}>{size}</option>)}
            </Select>
          </div>
        )}

        <div className="flex items-center">
          <button type="button" disabled={index === 0} onClick={() => onMove(index - 1)} aria-label={`Move ${definition.title} up`} title="Move up" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-canvas hover:text-ink disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
          <button type="button" disabled={index === total - 1} onClick={() => onMove(index + 1)} aria-label={`Move ${definition.title} down`} title="Move down" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-canvas hover:text-ink disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
          <button type="button" disabled={index === 0} onClick={() => onMove(0)} aria-label={`Move ${definition.title} to top`} title="Move to top" className="hidden h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-canvas hover:text-ink disabled:opacity-30 sm:inline-flex"><ArrowUpToLine className="h-3.5 w-3.5" /></button>
          <button type="button" disabled={index === total - 1} onClick={() => onMove(total - 1)} aria-label={`Move ${definition.title} to bottom`} title="Move to bottom" className="hidden h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-canvas hover:text-ink disabled:opacity-30 sm:inline-flex"><ArrowDownToLine className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={onHide} aria-label={`Hide ${definition.title}`} title="Hide widget" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-alert-bg hover:text-alert-ink"><EyeOff className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      <div className="pointer-events-auto">{content}</div>
    </div>
  );
}

function EndDropZone() {
  const { isOver, setNodeRef } = useDroppable({ id: END_DROP_ID });
  return (
    <div
      ref={setNodeRef}
      className={cx(
        "flex min-h-12 items-center justify-center rounded-2xl border border-dashed text-meta font-semibold transition-colors sm:col-span-2 lg:col-span-12",
        "border-line bg-canvas-deep/50 text-muted",
        isOver && "border-accent bg-accent-soft text-accent-soft-ink",
      )}
    >
      Drop here to move to the end
    </div>
  );
}

function WidgetDragOverlay({ item }: { item: DashboardWidgetPreference | null }) {
  if (!item) return null;
  const definition = DASHBOARD_WIDGETS.get(item.widgetId);
  if (!definition) return null;
  return (
    <div className="flex w-72 max-w-[calc(100vw-2rem)] items-center gap-3 rounded-2xl border border-accent bg-canvas px-4 py-3 shadow-float">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-soft-ink">
        <GripVertical className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-label font-semibold text-ink">{definition.title}</span>
        <span className="block text-meta capitalize text-muted">{item.size}</span>
      </span>
    </div>
  );
}

export default function DashboardLayoutEditor({
  initialLayout,
  widgets,
  canCustomize = true,
  sourceLabel = "System default",
  endpoint = "/api/dashboard/layout",
  resetConfirmation = "Reset your dashboard layout? Your personal arrangement will be removed and the default layout for your role will be restored.",
  startInEditMode = false,
  editorTitle = "Customize dashboard",
  onSaved,
}: Props) {
  const router = useRouter();
  const [persisted, setPersisted] = useState(() => ordered(initialLayout.widgets));
  const [items, setItems] = useState(() => ordered(initialLayout.widgets));
  const [isEditing, setIsEditing] = useState(startInEditMode);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<DashboardWidgetId | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const slots = useMemo(() => new Map(widgets.map((widget) => [widget.id, widget.content])), [widgets]);
  const changed = JSON.stringify(items) !== JSON.stringify(persisted);
  const visible = items.filter((item) => item.visible);
  const activeItem = activeId ? items.find((item) => item.widgetId === activeId) ?? null : null;

  useEffect(() => {
    if (!changed) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [changed]);

  function update(widgetId: DashboardWidgetId, patch: Partial<DashboardWidgetPreference>) {
    setItems((current) => current.map((item) => item.widgetId === widgetId ? { ...item, ...patch } : item));
    setMessage(null);
  }

  function move(widgetId: DashboardWidgetId, targetId: DashboardWidgetId) {
    setItems((current) => reorderVisibleDashboardWidgets(current, widgetId, targetId));
    setMessage(null);
  }

  function onDragStart(event: DragStartEvent) {
    setActiveId(dashboardWidgetId(event.active.id));
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const activeWidgetId = dashboardWidgetId(event.active.id);
    if (!activeWidgetId || !event.over) return;

    setItems((current) => {
      const visibleCurrent = current.filter((item) => item.visible);
      const overWidgetId = event.over?.id === END_DROP_ID
        ? visibleCurrent.at(-1)?.widgetId ?? null
        : dashboardWidgetId(event.over?.id);
      if (!overWidgetId) return current;
      return reorderVisibleDashboardWidgets(current, activeWidgetId, overWidgetId);
    });
    setMessage(null);
  }

  async function save() {
    setIsSaving(true);
    setMessage(null);
    try {
      const response = await fetch(endpoint, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: initialLayout.version, widgets: ordered(items) }),
      });
      const payload = await response.json() as ApiResponse<unknown>;
      if (!payload.success) throw new Error(payload.error);
      const layout = extractLayout(payload.data);
      if (!layout) throw new Error("The saved layout could not be read.");
      const next = ordered(layout.widgets);
      setPersisted(next);
      setItems(next);
      setMessage("Dashboard saved");
      onSaved?.(layout);
      if (!startInEditMode) setIsEditing(false);
      router.refresh();
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Couldn't save dashboard. Your changes haven't been applied.");
    } finally {
      setIsSaving(false);
    }
  }

  async function reset() {
    if (!window.confirm(resetConfirmation)) return;
    setIsSaving(true);
    setMessage(null);
    try {
      const response = await fetch(endpoint, { method: "DELETE" });
      const payload = await response.json() as ApiResponse<unknown>;
      if (!payload.success) throw new Error(payload.error);
      const layout = extractLayout(payload.data);
      if (!layout) throw new Error("The restored layout could not be read.");
      const next = ordered(layout.widgets);
      setPersisted(next);
      setItems(next);
      setMessage("Default layout restored");
      onSaved?.(layout);
      router.refresh();
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Couldn't reset dashboard.");
    } finally {
      setIsSaving(false);
    }
  }

  if (!isEditing) {
    return (
      <div className="space-y-3">
        {canCustomize && (
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setIsEditing(true)}><Settings2 className="h-4 w-4" />Customize dashboard</Button>
          </div>
        )}
        {visible.length === 0 ? (
          <div className="rounded-2xl border border-line bg-canvas px-5 py-12 text-center shadow-card">
            <LayoutGrid className="mx-auto h-7 w-7 text-faint" />
            <p className="mt-3 text-section font-semibold text-ink">Your dashboard has no visible widgets.</p>
            <p className="mt-1 text-body text-muted">Customize dashboard to add authorized widgets.</p>
          </div>
        ) : (
          <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-12">
            {visible.map((item) => <div key={item.widgetId} className={cx("min-w-0", widgetGridClass(item.size))}>{slots.get(item.widgetId)}</div>)}
          </div>
        )}
      </div>
    );
  }

  const activeCategories = DASHBOARD_WIDGET_CATEGORIES.filter((category) =>
    items.some((item) => DASHBOARD_WIDGETS.get(item.widgetId)?.category === category)
  );
  const hasAll8Categories = activeCategories.length === DASHBOARD_WIDGET_CATEGORIES.length;

  const renderCategoryCard = (category: DashboardWidgetCategory) => {
    const categoryItems = items.filter(
      (item) => DASHBOARD_WIDGETS.get(item.widgetId)?.category === category
    );
    if (categoryItems.length === 0) return null;
    const Icon = CATEGORY_ICONS[category];

    return (
      <div
        key={category}
        className="flex flex-col rounded-2xl border border-line bg-canvas p-3.5 shadow-xs"
      >
        <div className="flex items-center gap-2 border-b border-line/60 pb-2 mb-1.5">
          <Icon className="h-4 w-4 shrink-0 text-accent" />
          <span className="text-xs font-bold uppercase tracking-wider text-accent">
            {CATEGORY_LABELS[category]}
          </span>
        </div>
        <div className="flex-1 divide-y divide-line/40">
          {categoryItems.map((item) => {
            const definition = DASHBOARD_WIDGETS.get(item.widgetId)!;
            return (
              <button
                key={item.widgetId}
                type="button"
                onClick={() => update(item.widgetId, { visible: !item.visible })}
                className="group -mx-1 flex w-[calc(100%+8px)] items-start gap-2.5 rounded-lg px-1 py-2 text-left transition-colors hover:bg-canvas-deep/50"
              >
                <span
                  className={cx(
                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors",
                    item.visible
                      ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"
                      : "bg-slate-100 text-slate-400 dark:bg-canvas-deep dark:text-faint"
                  )}
                >
                  {item.visible ? (
                    <Eye className="h-3 w-3" />
                  ) : (
                    <EyeOff className="h-3 w-3" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-ink transition-colors group-hover:text-accent leading-tight">
                    {definition.title}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-muted">
                    {definition.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const gridColsClass =
    activeCategories.length === 6
      ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
      : activeCategories.length === 5
      ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
      : activeCategories.length === 4
      ? "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4"
      : activeCategories.length === 3
      ? "grid-cols-1 sm:grid-cols-3"
      : activeCategories.length === 2
      ? "grid-cols-1 sm:grid-cols-2"
      : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

  return (
    <section aria-label="Dashboard layout editor" className="space-y-4">
      <div className="sticky top-[76px] z-10 rounded-2xl border border-line bg-canvas p-4 sm:p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-bold text-ink">{editorTitle}</h2>
            <p className="mt-0.5 text-xs text-muted">
              Drag by the handle or use the move buttons. Based on: {sourceLabel}.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {changed && (
              <span className="mr-1 inline-flex items-center gap-1.5 text-meta font-semibold text-warn-ink">
                <span className="h-1.5 w-1.5 rounded-full bg-warn-mark" />
                Unsaved changes
              </span>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={reset}
              disabled={isSaving}
              className="text-muted hover:text-ink font-medium"
            >
              <RotateCcw className="h-4 w-4" />
              Reset
            </Button>
            {!startInEditMode && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setItems(persisted);
                  setIsEditing(false);
                  setMessage(null);
                }}
                disabled={isSaving}
              >
                <X className="h-4 w-4" />
                Cancel
              </Button>
            )}
            <Button
              size="sm"
              variant="primary"
              onClick={save}
              isBusy={isSaving}
              busyLabel="Saving"
              disabled={!changed}
            >
              <Save className="h-4 w-4" />
              Save layout
            </Button>
          </div>
        </div>
        {message && (
          <p
            role="status"
            className={cx(
              "mt-3 flex items-center gap-2 text-label",
              message.includes("saved") || message.includes("restored")
                ? "text-ok-ink"
                : "text-alert-ink"
            )}
          >
            {message.includes("saved") && <Check className="h-4 w-4" />}
            {message}
          </p>
        )}
      </div>

      <aside className="rounded-2xl border border-line bg-canvas p-4 sm:p-5 shadow-card space-y-3.5">
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-accent" />
          <h3 className="text-sm font-bold text-ink">Available widgets</h3>
        </div>

        {hasAll8Categories ? (
          <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-4">
            {/* Column 1: Overview */}
            <div className="xl:col-span-1">
              {renderCategoryCard("summary")}
            </div>

            {/* Columns 2-4: Right side multi-row layout */}
            <div className="flex flex-col gap-3.5 xl:col-span-3">
              {/* Row 1: Patients, Appointments, Revenue */}
              <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
                {renderCategoryCard("patients")}
                {renderCategoryCard("appointments")}
                {renderCategoryCard("revenue")}
              </div>

              {/* Row 2: Doctors, Tasks, Messages, Activity */}
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 md:grid-cols-4">
                {renderCategoryCard("doctors")}
                {renderCategoryCard("tasks")}
                {renderCategoryCard("messages")}
                {renderCategoryCard("activity")}
              </div>
            </div>
          </div>
        ) : (
          <div className={cx("grid gap-3.5", gridColsClass)}>
            {activeCategories.map((category) => renderCategoryCard(category))}
          </div>
        )}
      </aside>

      <DndContext
        sensors={sensors}
        collisionDetection={dashboardCollisionDetection}
        onDragStart={onDragStart}
        onDragCancel={() => setActiveId(null)}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={visible.map((item) => item.widgetId)} strategy={rectSortingStrategy}>
          <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-12">
            {visible.map((item, index) => (
              <SortableWidget
                key={item.widgetId}
                item={item}
                content={slots.get(item.widgetId)}
                index={index}
                total={visible.length}
                onChangeSize={(size) => update(item.widgetId, { size })}
                onHide={() => update(item.widgetId, { visible: false })}
                onMove={(toVisible) => {
                  const targetId = visible[toVisible]?.widgetId;
                  if (targetId) move(item.widgetId, targetId);
                }}
              />
            ))}
            {activeId !== null && visible.length > 1 && <EndDropZone />}
          </div>
        </SortableContext>
        <DragOverlay><WidgetDragOverlay item={activeItem} /></DragOverlay>
      </DndContext>
    </section>
  );
}
