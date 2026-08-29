"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  Check,
  Eye,
  EyeOff,
  GripVertical,
  LayoutGrid,
  RotateCcw,
  Save,
  Settings2,
  X,
} from "lucide-react";
import { Button, cx } from "@/components/ui";
import {
  DASHBOARD_WIDGET_CATEGORIES,
  DASHBOARD_WIDGETS,
  widgetGridClass,
  type DashboardLayoutConfig,
  type DashboardWidgetCategory,
  type DashboardWidgetId,
  type DashboardWidgetPreference,
} from "@/lib/dashboardWidgets";
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
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.widgetId });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cx(
        "min-w-0 rounded-2xl border border-dashed border-accent/35 bg-accent-soft/20 p-1.5 motion-reduce:transition-none",
        widgetGridClass(item.widgetId, item.size),
        isDragging && "relative z-30 border-accent bg-canvas shadow-float",
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
          <label className="sr-only" htmlFor={`widget-size-${item.widgetId}`}>Size for {definition.title}</label>
        )}
        {definition.allowedSizes.length > 1 && (
          <select
            id={`widget-size-${item.widgetId}`}
            value={item.size}
            onChange={(event) => onChangeSize(event.target.value as DashboardWidgetPreference["size"])}
            className="h-8 rounded-lg border border-line bg-canvas px-2 text-meta font-medium capitalize text-muted"
          >
            {definition.allowedSizes.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
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
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const slots = useMemo(() => new Map(widgets.map((widget) => [widget.id, widget.content])), [widgets]);
  const changed = JSON.stringify(items) !== JSON.stringify(persisted);
  const visible = items.filter((item) => item.visible);

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

  function move(widgetId: DashboardWidgetId, to: number) {
    setItems((current) => {
      const from = current.findIndex((item) => item.widgetId === widgetId);
      return from < 0 ? current : ordered(arrayMove(current, from, Math.max(0, Math.min(to, current.length - 1))));
    });
    setMessage(null);
  }

  function onDragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const from = items.findIndex((item) => item.widgetId === event.active.id);
    const to = items.findIndex((item) => item.widgetId === event.over!.id);
    if (from >= 0 && to >= 0) setItems(ordered(arrayMove(items, from, to)));
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
          <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-12">
            {visible.map((item) => <div key={item.widgetId} className={cx("min-w-0", widgetGridClass(item.widgetId, item.size))}>{slots.get(item.widgetId)}</div>)}
          </div>
        )}
      </div>
    );
  }

  return (
    <section aria-label="Dashboard layout editor" className="space-y-4">
      <div className="sticky top-[76px] z-10 rounded-2xl border border-accent/25 bg-canvas p-4 shadow-raised">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-section font-semibold text-ink">{editorTitle}</h2>
            <p className="mt-0.5 text-label text-muted">Drag by the handle or use the move buttons. Based on: {sourceLabel}.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {changed && <span className="mr-1 inline-flex items-center gap-1.5 text-meta font-semibold text-warn-ink"><span className="h-1.5 w-1.5 rounded-full bg-warn-mark" />Unsaved changes</span>}
            <Button size="sm" variant="ghost" onClick={reset} disabled={isSaving}><RotateCcw className="h-4 w-4" />Reset</Button>
            {!startInEditMode && <Button size="sm" variant="secondary" onClick={() => { setItems(persisted); setIsEditing(false); setMessage(null); }} disabled={isSaving}><X className="h-4 w-4" />Cancel</Button>}
            <Button size="sm" variant="primary" onClick={save} isBusy={isSaving} busyLabel="Saving" disabled={!changed}><Save className="h-4 w-4" />Save layout</Button>
          </div>
        </div>
        {message && <p role="status" className={cx("mt-3 flex items-center gap-2 text-label", message.includes("saved") || message.includes("restored") ? "text-ok-ink" : "text-alert-ink")}>{message.includes("saved") && <Check className="h-4 w-4" />}{message}</p>}
      </div>

      <aside className="rounded-2xl border border-line bg-canvas p-4 shadow-card">
        <div className="flex items-center gap-2"><Eye className="h-4 w-4 text-accent" /><h3 className="text-label font-semibold text-ink">Available widgets</h3></div>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {DASHBOARD_WIDGET_CATEGORIES.map((category) => {
            const categoryItems = items.filter((item) => DASHBOARD_WIDGETS.get(item.widgetId)?.category === category);
            if (categoryItems.length === 0) return null;
            return (
              <div key={category}>
                <p className="text-micro font-semibold uppercase text-faint">{CATEGORY_LABELS[category]}</p>
                <div className="mt-1.5 space-y-1">
                  {categoryItems.map((item) => {
                    const definition = DASHBOARD_WIDGETS.get(item.widgetId)!;
                    return <button key={item.widgetId} type="button" onClick={() => update(item.widgetId, { visible: !item.visible })} className="flex min-h-12 w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-meta text-muted hover:bg-canvas-deep hover:text-ink"><span className={cx("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md", item.visible ? "bg-ok-bg text-ok-ink" : "bg-canvas-deep text-faint")}>{item.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}</span><span className="min-w-0"><span className="block truncate font-semibold text-ink">{definition.title}</span><span className="mt-0.5 block text-micro leading-4 text-muted">{definition.description}</span></span></button>;
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </aside>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={visible.map((item) => item.widgetId)} strategy={rectSortingStrategy}>
          <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-12">
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
                  const to = targetId ? items.findIndex((candidate) => candidate.widgetId === targetId) : items.length - 1;
                  move(item.widgetId, to);
                }}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </section>
  );
}
