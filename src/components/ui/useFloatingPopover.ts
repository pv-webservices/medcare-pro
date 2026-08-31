"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export interface FloatingPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  openUpward: boolean;
}

export interface UseFloatingPopoverOptions {
  isOpen: boolean;
  onClose: (options?: { restoreFocus?: boolean }) => void;
  popoverId: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  align?: "start" | "end" | "auto";
  offset?: number;
  defaultWidth?: number;
  defaultHeight?: number;
}

export function useFloatingPopover({
  isOpen,
  onClose,
  popoverId,
  triggerRef,
  panelRef,
  align = "auto",
  offset = 6,
  defaultWidth,
  defaultHeight,
}: UseFloatingPopoverOptions) {
  const [position, setPosition] = useState<FloatingPosition | null>(null);
  const ignoreNextTriggerClickRef = useRef<number>(0);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const triggerEl = triggerRef.current;
    const triggerRect = triggerEl.getBoundingClientRect();

    // Trigger is hidden or unmounted
    if (triggerRect.width === 0 && triggerRect.height === 0) return;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Trigger scrolled out of viewport
    if (triggerRect.bottom < 0 || triggerRect.top > viewportHeight) {
      onClose();
      return;
    }

    const panelEl = panelRef.current;
    const panelWidth =
      panelEl?.offsetWidth || defaultWidth || Math.max(triggerRect.width, 240);
    const panelHeight =
      panelEl?.offsetHeight || defaultHeight || 280;

    const spaceBelow = viewportHeight - triggerRect.bottom - offset - 8;
    const spaceAbove = triggerRect.top - offset - 8;

    let top: number;
    let openUpward = false;

    if (spaceBelow < Math.min(panelHeight, 180) && spaceAbove > spaceBelow) {
      openUpward = true;
      top = triggerRect.top - offset - panelHeight;
      if (top < 8) top = 8;
    } else {
      top = triggerRect.bottom + offset;
      if (top + panelHeight > viewportHeight - 8) {
        top = Math.max(8, viewportHeight - 8 - panelHeight);
      }
    }

    let left: number;
    const effectiveAlign =
      align === "auto"
        ? triggerRect.left + panelWidth > viewportWidth - 8 &&
          triggerRect.right - panelWidth >= 8
          ? "end"
          : "start"
        : align;

    if (effectiveAlign === "end") {
      left = triggerRect.right - panelWidth;
    } else {
      left = triggerRect.left;
    }

    // Viewport collision clamping
    if (left + panelWidth > viewportWidth - 8) {
      left = viewportWidth - 8 - panelWidth;
    }
    if (left < 8) {
      left = 8;
    }

    setPosition({
      top: Math.round(top),
      left: Math.round(left),
      width: Math.round(triggerRect.width),
      maxHeight: Math.floor(
        Math.max(140, Math.min(openUpward ? spaceAbove : spaceBelow, 360)),
      ),
      openUpward,
    });
  }, [align, defaultHeight, defaultWidth, offset, onClose, panelRef, triggerRef]);

  // Synchronize position when open and attach resize/scroll/mutation observers
  useIsomorphicLayoutEffect(() => {
    if (!isOpen) {
      setPosition(null);
      return;
    }

    // Immediate calculation
    updatePosition();

    // Multi-frame catch for layout shifts or animations
    const raf1 = requestAnimationFrame(() => {
      updatePosition();
      requestAnimationFrame(updatePosition);
    });

    const handleScrollOrResize = () => updatePosition();
    window.addEventListener("resize", handleScrollOrResize);
    window.addEventListener("scroll", handleScrollOrResize, true);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && triggerRef.current) {
      resizeObserver = new ResizeObserver(() => updatePosition());
      resizeObserver.observe(triggerRef.current);
      if (panelRef.current) resizeObserver.observe(panelRef.current);
      if (document.body) resizeObserver.observe(document.body);
    }

    return () => {
      cancelAnimationFrame(raf1);
      window.removeEventListener("resize", handleScrollOrResize);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      resizeObserver?.disconnect();
    };
  }, [isOpen, panelRef, triggerRef, updatePosition]);

  // Global popover coordination: opening one closes all other popovers across the app
  useEffect(() => {
    function handleCloseOthers(e: Event) {
      const customEvent = e as CustomEvent<{ sourceId: string }>;
      if (customEvent.detail?.sourceId !== popoverId) {
        onClose();
      }
    }

    window.addEventListener("medcare:close-popovers", handleCloseOthers);
    return () => {
      window.removeEventListener("medcare:close-popovers", handleCloseOthers);
    };
  }, [onClose, popoverId]);

  // Outside pointerdown and focusin dismissal with double-toggle suppression
  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(e: MouseEvent | TouchEvent) {
      const target = e.target as Node;
      const path = (e.composedPath ? e.composedPath() : []) as Node[];

      const isInsideTrigger =
        triggerRef.current?.contains(target) ||
        (triggerRef.current ? path.includes(triggerRef.current) : false);

      const isInsidePanel =
        panelRef.current?.contains(target) ||
        (panelRef.current ? path.includes(panelRef.current) : false);

      if (isInsidePanel) {
        return;
      }

      if (isInsideTrigger) {
        // Suppress the subsequent click event on the trigger from reopening
        ignoreNextTriggerClickRef.current = Date.now();
        onClose();
        return;
      }

      onClose();
    }

    function handleFocusIn(e: FocusEvent) {
      const target = e.target as Node;
      const isInsideTrigger = triggerRef.current?.contains(target);
      const isInsidePanel = panelRef.current?.contains(target);

      if (!isInsideTrigger && !isInsidePanel) {
        onClose();
      }
    }

    function handleKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose({ restoreFocus: true });
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handlePointerDown, true);
    document.addEventListener("touchstart", handlePointerDown, true);
    document.addEventListener("focusin", handleFocusIn, true);
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown, true);
      document.removeEventListener("touchstart", handlePointerDown, true);
      document.removeEventListener("focusin", handleFocusIn, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isOpen, onClose, panelRef, triggerRef]);

  const dispatchOpenEvent = useCallback(() => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("medcare:close-popovers", {
          detail: { sourceId: popoverId },
        }),
      );
    }
  }, [popoverId]);

  const shouldIgnoreTriggerClick = useCallback(() => {
    return Date.now() - ignoreNextTriggerClickRef.current < 250;
  }, []);

  return {
    position,
    dispatchOpenEvent,
    shouldIgnoreTriggerClick,
  };
}
