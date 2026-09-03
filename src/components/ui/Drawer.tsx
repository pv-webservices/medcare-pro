"use client";

import {
  useEffect,
  useId,
  useRef,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import IconButton from "@/components/ui/IconButton";
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
 * A panel that slides in from the edge.
 *
 * WHERE IT BEATS A MODAL. Filters on a phone, a side-by-side detail preview, a
 * short form the reader wants to fill while still seeing the list behind it. A
 * drawer keeps the context on screen; a modal deliberately removes it. Choose
 * on that basis, not on which looks nicer.
 *
 * It carries the same accessibility contract as `Modal` — labelled dialog,
 * focus moved in and returned on close, Tab trapped, Escape closes, page behind
 * it does not scroll — because from a keyboard the two are the same object with
 * different geometry.
 *
 * On a phone it comes from the bottom and stops short of the top edge, which is
 * where a thumb can reach; from `sm` up it is a right-hand panel.
 */

interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  /** Actions pinned to the bottom, always visible above a scrolling body. */
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}

export default function Drawer({
  isOpen,
  onClose,
  title,
  description,
  footer,
  className,
  children,
}: DrawerProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const mounted = useMounted();

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    openerRef.current = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    (first ?? panel)?.focus();

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = overflow;
      openerRef.current?.focus();
    };
  }, [isOpen]);

  if (!isOpen || !mounted || typeof document === "undefined") {
    return null;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const panel = panelRef.current;
    if (!panel) {
      return;
    }

    const focusable = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );

    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end" onKeyDown={handleKeyDown}>
      <div
        aria-hidden="true"
        onClick={onClose}
        className="overlay-in absolute inset-0 bg-[rgb(12_16_28/0.45)] backdrop-blur-[2px]"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx(
          "relative z-10 flex w-full flex-col border-line bg-canvas shadow-float",
          // Phone: a sheet from the bottom, leaving the top of the page visible.
          "panel-in mt-auto max-h-[85vh] rounded-t-4xl border-t",
          // Tablet and up: a full-height panel from the right edge.
          "sm:drawer-in sm:mt-0 sm:h-full sm:max-h-none sm:w-[26rem] sm:rounded-none sm:border-l sm:border-t-0",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-section font-semibold text-ink">
              {title}
            </h2>
            {description && (
              <p className="mt-1 text-body text-muted">{description}</p>
            )}
          </div>

          <IconButton label="Close" size="sm" onClick={onClose} className="-mr-1">
            <X aria-hidden="true" strokeWidth={2} className="h-4 w-4" />
          </IconButton>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
