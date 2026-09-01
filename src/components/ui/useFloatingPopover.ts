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
  transformOrigin: "top left" | "top right" | "bottom left" | "bottom right";
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
  /** Keep the floating panel exactly as wide as its trigger. */
  matchTriggerWidth?: boolean;
}

export function resolveFloatingPanelWidth({
  triggerWidth,
  measuredPanelWidth,
  defaultWidth,
  matchTriggerWidth,
}: {
  triggerWidth: number;
  measuredPanelWidth?: number;
  defaultWidth?: number;
  matchTriggerWidth?: boolean;
}) {
  if (matchTriggerWidth) {
    return triggerWidth;
  }

  return measuredPanelWidth || defaultWidth || Math.max(triggerWidth, 240);
}

export function computeFloatingPosition({
  triggerEl,
  panelEl,
  align = "auto",
  offset = 6,
  defaultWidth,
  defaultHeight,
  matchTriggerWidth = false,
  viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1024,
  viewportHeight = typeof window !== "undefined" ? window.innerHeight : 768,
}: {
  triggerEl: {
    getBoundingClientRect(): {
      top: number;
      left: number;
      bottom: number;
      right: number;
      width: number;
      height: number;
    };
  };
  panelEl?: { offsetWidth?: number; offsetHeight?: number } | null;
  align?: "start" | "end" | "auto";
  offset?: number;
  defaultWidth?: number;
  defaultHeight?: number;
  matchTriggerWidth?: boolean;
  viewportWidth?: number;
  viewportHeight?: number;
}): FloatingPosition | null {
  const triggerRect = triggerEl.getBoundingClientRect();

  // Trigger is hidden or unmounted
  if (triggerRect.width === 0 && triggerRect.height === 0) return null;

  const panelWidth = resolveFloatingPanelWidth({
    triggerWidth: triggerRect.width,
    measuredPanelWidth: panelEl?.offsetWidth,
    defaultWidth,
    matchTriggerWidth,
  });
  const panelHeight = panelEl?.offsetHeight || defaultHeight || 280;

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
    left = Math.max(8, viewportWidth - 8 - panelWidth);
  }
  if (left < 8) {
    left = 8;
  }

  const transformOrigin: "top left" | "top right" | "bottom left" | "bottom right" =
    openUpward
      ? effectiveAlign === "end"
        ? "bottom right"
        : "bottom left"
      : effectiveAlign === "end"
        ? "top right"
        : "top left";

  return {
    top: Math.round(top),
    left: Math.round(left),
    width: Math.round(triggerRect.width),
    maxHeight: Math.floor(
      Math.max(140, Math.min(openUpward ? spaceAbove : spaceBelow, 360)),
    ),
    openUpward,
    transformOrigin,
  };
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
  matchTriggerWidth = false,
}: UseFloatingPopoverOptions) {
  const [position, setPosition] = useState<FloatingPosition | null>(null);
  const ignoreNextTriggerClickRef = useRef<number>(0);

  const getImmediatePosition = useCallback(() => {
    if (!triggerRef.current) return null;
    return computeFloatingPosition({
      triggerEl: triggerRef.current,
      panelEl: panelRef.current,
      align,
      offset,
      defaultWidth,
      defaultHeight,
      matchTriggerWidth,
    });
  }, [
    align,
    defaultHeight,
    defaultWidth,
    matchTriggerWidth,
    offset,
    panelRef,
    triggerRef,
  ]);

  const updatePosition = useCallback(() => {
    const nextPos = getImmediatePosition();
    if (nextPos) {
      setPosition(nextPos);
    }
    return nextPos;
  }, [getImmediatePosition]);

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
    setPosition,
    getImmediatePosition,
    dispatchOpenEvent,
    shouldIgnoreTriggerClick,
  };
}
