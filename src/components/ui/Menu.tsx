"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cx } from "@/components/ui/cx";

const emptySubscribe = () => () => {};

function useMounted() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

/**
 * A dropdown: a trigger, and a panel of choices under it.
 *
 * Used by the clinic switcher, the account menu and every row-level "more
 * actions" control, so those three cannot drift into behaving differently.
 *
 * THE KEYBOARD CONTRACT IS THE WHOLE COMPONENT. A menu that only answers the
 * mouse is a menu a front-desk user cannot reach while their hands are on the
 * keyboard: Escape closes and returns focus to the trigger, Tab or a click
 * outside closes, ArrowDown from the trigger opens and lands on the first item,
 * and the arrows move between items once inside. `aria-expanded` and
 * `aria-haspopup` on the trigger say what will happen before it happens.
 *
 * IT IS NOT A `<select>` REPLACEMENT. Where the choice is a form value, use the
 * native select — the OS picker on a tablet beats anything built here. This is
 * for navigation and actions.
 */

interface PositionStyle {
  top: number;
  left: number;
  maxHeight?: number;
}

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

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
  const [position, setPosition] = useState<PositionStyle | null>(null);

  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  /** Computes fixed position and collision/flip when usePortal is active. */
  useIsomorphicLayoutEffect(() => {
    if (!isOpen || !usePortal) {
      setPosition(null);
      return;
    }

    function updatePosition() {
      if (!triggerRef.current) return;
      const triggerRect = triggerRef.current.getBoundingClientRect();
      if (triggerRect.width === 0 && triggerRect.height === 0) return;

      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      // Close if trigger scrolled out of viewport
      if (triggerRect.bottom < 0 || triggerRect.top > viewportHeight) {
        setIsOpen(false);
        return;
      }

      const panelEl = panelRef.current;
      const panelWidth = panelEl?.offsetWidth || 240;
      const panelHeight = panelEl?.offsetHeight || 160;

      const spaceBelow = viewportHeight - triggerRect.bottom - 8;
      const spaceAbove = triggerRect.top - 8;

      let top: number;
      let openUpward = false;

      if (spaceBelow < panelHeight && spaceAbove > spaceBelow) {
        openUpward = true;
        top = triggerRect.top - 8 - panelHeight;
        if (top < 8) {
          top = 8;
        }
      } else {
        top = triggerRect.bottom + 8;
        if (top + panelHeight > viewportHeight - 8) {
          top = Math.max(8, viewportHeight - 8 - panelHeight);
        }
      }

      let left: number;
      if (align === "end") {
        left = triggerRect.right - panelWidth;
      } else {
        left = triggerRect.left;
      }

      if (left + panelWidth > viewportWidth - 8) {
        left = viewportWidth - 8 - panelWidth;
      }
      if (left < 8) {
        left = 8;
      }

      setPosition({
        top: Math.round(top),
        left: Math.round(left),
        maxHeight: Math.floor(Math.max(120, openUpward ? spaceAbove : spaceBelow)),
      });
    }

    updatePosition();
    const rafId = requestAnimationFrame(updatePosition);

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen, usePortal, align]);

  /** Anything focusable inside the panel, in DOM order. */
  function items(): HTMLElement[] {
    const panel = panelRef.current;
    if (!panel) {
      return [];
    }
    return Array.from(
      panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
  }

  function close(options: { restoreFocus?: boolean } = {}) {
    setIsOpen(false);
    if (options.restoreFocus) {
      triggerRef.current?.focus();
    }
  }

  // Listen for global popover closure events so only one menu/dropdown is open at a time
  useEffect(() => {
    function handleCloseOthers(e: Event) {
      const customEvent = e as CustomEvent<{ sourceId: string }>;
      if (customEvent.detail?.sourceId !== panelId) {
        setIsOpen(false);
      }
    }

    window.addEventListener("medcare:close-popovers", handleCloseOthers);
    return () => {
      window.removeEventListener("medcare:close-popovers", handleCloseOthers);
    };
  }, [panelId]);

  /** A click or a focus move outside the menu closes it. */
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target as Node;
      if (
        rootRef.current?.contains(target) ||
        panelRef.current?.contains(target)
      ) {
        return;
      }
      setIsOpen(false);
    }

    function handleFocusIn(event: FocusEvent) {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("focusin", handleFocusIn);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("focusin", handleFocusIn);
    };
  }, [isOpen]);

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      if (!isOpen) {
        event.preventDefault();
        setIsOpen(true);
        // The panel has not rendered yet; focus lands on the next frame.
        requestAnimationFrame(() => items()[0]?.focus());
      }
    }
  }

  function handlePanelKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close({ restoreFocus: true });
      return;
    }

    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }

    event.preventDefault();
    const focusable = items();
    if (focusable.length === 0) {
      return;
    }
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
              top: position ? `${position.top}px` : undefined,
              left: position ? `${position.left}px` : undefined,
              maxHeight: position?.maxHeight ? `${position.maxHeight}px` : undefined,
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
        onClick={() => {
          setIsOpen((current) => {
            const next = !current;
            if (next && typeof window !== "undefined") {
              window.dispatchEvent(
                new CustomEvent("medcare:close-popovers", { detail: { sourceId: panelId } }),
              );
            }
            return next;
          });
        }}
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
