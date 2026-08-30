"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import Button from "@/components/ui/Button";
import IconButton from "@/components/ui/IconButton";
import { cx } from "@/components/ui/cx";

/**
 * The filter surface every list screen shares.
 *
 * ONE ARCHITECTURE, TWO GEOMETRIES. On a desktop the controls sit inline above
 * the list, where the reader can see what is applied without opening anything.
 * On a phone the same controls become a bottom sheet behind a single button,
 * because six selects stacked above a table means the table starts below the
 * fold.
 *
 * THE CONTROLS ARE RENDERED EXACTLY ONCE. The obvious implementation — an
 * inline copy plus a drawer copy — puts two elements with the same `id` in the
 * document, which silently breaks every `<label for>` in the panel and hands
 * screen readers two of every field. So there is one panel, and the breakpoint
 * decides whether it is a static strip or a sheet.
 *
 * THE ACTIVE COUNT IS THE IMPORTANT PART. The commonest support call on a list
 * screen is "the record is missing" when a filter set twenty minutes ago is
 * still applied. The badge on the button and the "Clear all" beside the
 * controls are what prevent that.
 *
 * The controls themselves belong to the caller — this owns layout and the
 * mobile behaviour, not the fields.
 */

interface FilterBarProps {
  /** The filter controls. Rendered once; positioned by breakpoint. */
  children: ReactNode;
  /** How many filters are currently applied. Drives the badge. */
  activeCount?: number;
  /** Resets every filter — a link for a server-rendered form, or a button. */
  clearAction?: ReactNode;
  /** The submit/apply control, when the filters are a form. */
  actions?: ReactNode;
  /** When true, omits the generic "Show results" button on mobile and shows clear/apply inside the sheet. */
  hideMobileShowResults?: boolean;
  className?: string;
}

export default function FilterBar({
  children,
  activeCount = 0,
  clearAction,
  actions,
  hideMobileShowResults = false,
  className,
}: FilterBarProps) {
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const panelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  /** Escape closes the sheet. Only bound while it is open. */
  useEffect(() => {
    if (!isSheetOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsSheetOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = overflow;
    };
  }, [isSheetOpen]);

  return (
    <div className={cx("mb-4", className)}>
      {/* The opener exists only below `md`, where the panel is a sheet. */}
      <div className="flex items-center justify-between gap-3 md:hidden">
        <Button
          variant="secondary"
          aria-expanded={isSheetOpen}
          aria-controls={panelId}
          onClick={() => setIsSheetOpen(true)}
        >
          <SlidersHorizontal aria-hidden="true" strokeWidth={2} className="h-4 w-4" />
          Filters
          {activeCount > 0 && (
            <span className="tnum ml-1 rounded-full bg-accent px-1.5 py-0.5 text-meta font-semibold text-accent-ink">
              {activeCount}
              <span className="sr-only"> applied</span>
            </span>
          )}
        </Button>
        {clearAction}
      </div>

      {isSheetOpen && (
        <div
          aria-hidden="true"
          onClick={() => setIsSheetOpen(false)}
          className="overlay-in fixed inset-0 z-40 bg-[rgb(12_16_28/0.45)] md:hidden"
        />
      )}

      <div
        ref={panelRef}
        id={panelId}
        // A sheet only while it is open on a phone; a plain region on desktop,
        // where nothing is modal and nothing needs a dialog role.
        role={isSheetOpen ? "dialog" : undefined}
        aria-modal={isSheetOpen ? true : undefined}
        aria-label={isSheetOpen ? "Filters" : undefined}
        className={cx(
          "border-line bg-canvas",
          isSheetOpen
            ? "panel-in fixed inset-x-0 bottom-0 z-50 max-h-[80vh] overflow-y-auto rounded-t-4xl border-t p-5 shadow-float"
            : "hidden",
          "md:static md:block md:max-h-none md:overflow-visible md:rounded-3xl md:border md:p-4 md:shadow-card",
        )}
      >
        <div className="mb-4 flex items-center justify-between md:hidden">
          <p className="text-section font-semibold text-ink">Filters</p>
          <IconButton label="Close" size="sm" onClick={() => setIsSheetOpen(false)}>
            <X aria-hidden="true" strokeWidth={2} className="h-4 w-4" />
          </IconButton>
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
          {children}

          {(actions || clearAction) && (
            <div className="flex items-center gap-2 md:ml-auto">
              <span className={hideMobileShowResults ? "contents" : "hidden md:contents"}>
                {clearAction}
              </span>
              {actions}
            </div>
          )}
        </div>

        {!hideMobileShowResults && (
          <div className="mt-4 md:hidden">
            <Button
              variant="primary"
              className="w-full"
              onClick={() => setIsSheetOpen(false)}
            >
              Show results
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
