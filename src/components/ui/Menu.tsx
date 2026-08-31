"use client";

import {
  useCallback,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cx } from "@/components/ui/cx";
import { useFloatingPopover } from "@/components/ui/useFloatingPopover";

const emptySubscribe = () => () => {};

function useMounted() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

interface MenuProps {
  /** The control that opens the panel. Receives the open state for its chevron. */
  trigger: (state: { isOpen: boolean }) => ReactNode;
  /** Announced as the panel's name, e.g. "Switch clinic". */
  label: string;
  /** Which edge of the trigger the panel lines up with. */
  align?: "start" | "end";
  /**
   * When true, renders the panel via createPortal into document.body with fixed positioning
   * to escape overflow clipping in scrollable tables and cards, with automatic flip & collision handling.
   */
  usePortal?: boolean;
  /** Panel width. Defaults to a comfortable menu measure. */
  panelClassName?: string;
  className?: string;
  children: ReactNode;
}

export default function Menu({
  trigger,
  label,
  align = "start",
  usePortal = false,
  panelClassName,
  className,
  children,
}: MenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const mounted = useMounted();
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const handleClose = useCallback((options?: { restoreFocus?: boolean }) => {
    setIsOpen(false);
    if (options?.restoreFocus) {
      triggerRef.current?.focus();
    }
  }, []);

  const {
    position,
    dispatchOpenEvent,
    shouldIgnoreTriggerClick,
  } = useFloatingPopover({
    isOpen: isOpen && usePortal,
    onClose: handleClose,
    popoverId: panelId,
    triggerRef,
    panelRef,
    align,
    defaultWidth: 240,
    defaultHeight: 180,
  });

  /** Anything focusable inside the panel, in DOM order. */
  function items(): HTMLElement[] {
    const panel = panelRef.current;
    if (!panel) return [];
    return Array.from(
      panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
  }

  function handleTriggerClick() {
    if (shouldIgnoreTriggerClick()) {
      return;
    }
    const next = !isOpen;
    if (next) {
      dispatchOpenEvent();
    }
    setIsOpen(next);
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      if (!isOpen) {
        event.preventDefault();
        dispatchOpenEvent();
        setIsOpen(true);
        requestAnimationFrame(() => items()[0]?.focus());
      }
    }
  }

  function handlePanelKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      handleClose({ restoreFocus: true });
      return;
    }

    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }

    event.preventDefault();
    const focusable = items();
    if (focusable.length === 0) return;
    const current = focusable.indexOf(document.activeElement as HTMLElement);
    const step = event.key === "ArrowDown" ? 1 : focusable.length - 1;
    const next = (current + step + focusable.length) % focusable.length;
    focusable[next]?.focus();
  }

  const panelElement = (
    <div
      ref={panelRef}
      id={panelId}
      role="menu"
      aria-label={label}
      onKeyDown={handlePanelKeyDown}
      onClick={() => setIsOpen(false)}
      style={
        usePortal
          ? {
              position: "fixed",
              top: position?.top ?? 0,
              left: position?.left ?? 0,
              maxHeight: position?.maxHeight ? `${position.maxHeight}px` : undefined,
              zIndex: 9999,
              visibility: position ? "visible" : "hidden",
            }
          : undefined
      }
      className={cx(
        "panel-in z-50 min-w-[15rem] overflow-y-auto rounded-2xl",
        "border border-line bg-canvas p-1.5 shadow-float",
        usePortal
          ? ""
          : cx("absolute mt-2", align === "end" ? "right-0" : "left-0"),
        panelClassName,
      )}
    >
      {children}
    </div>
  );

  return (
    <div ref={rootRef} className={cx("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? panelId : undefined}
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
        className="w-full rounded-2xl text-left"
      >
        {trigger({ isOpen })}
      </button>

      {isOpen &&
        (usePortal && mounted && typeof document !== "undefined"
          ? createPortal(panelElement, document.body)
          : panelElement)}
    </div>
  );
}

/** A caption above a group of items. Not focusable, not a heading. */
export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-3 pb-1.5 pt-2 text-micro font-semibold uppercase text-faint">
      {children}
    </p>
  );
}

export function MenuSeparator() {
  return <hr className="my-1.5 border-0 border-t border-line" />;
}

/**
 * The row inside a menu. Rendered as whatever the caller passes as `as` — a
 * `<Link>` for navigation, a `<button>` for an action — so the element matches
 * the behaviour rather than everything being a div with a click handler.
 */
export function menuItemClasses(isActive = false, tone: "default" | "danger" = "default") {
  return cx(
    "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-body font-medium",
    "transition-colors duration-150",
    tone === "danger"
      ? "text-alert-ink hover:bg-alert-bg"
      : isActive
        ? "bg-accent-soft text-accent-soft-ink"
        : "text-ink-soft hover:bg-canvas-deep hover:text-ink",
  );
}
