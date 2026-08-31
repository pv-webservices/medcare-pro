"use client";

import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cx } from "@/components/ui/cx";
import { controlClasses, FieldShell } from "@/components/ui/Input";
import {
  isDateOnly,
  todayDateOnly,
} from "@/lib/dates";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export interface DatePickerProps {
  id: string;
  label: string;
  value?: string; // YYYY-MM-DD
  defaultValue?: string; // YYYY-MM-DD
  onChange?: (date: string) => void;
  minDate?: string; // YYYY-MM-DD
  maxDate?: string; // YYYY-MM-DD
  hint?: ReactNode;
  error?: string;
  isLabelHidden?: boolean;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  fieldClassName?: string;
  className?: string;
  name?: string;
  showClear?: boolean;
  showToday?: boolean;
}

interface PositionStyle {
  top: number;
  left: number;
  openUpward: boolean;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const SHORT_MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const WEEKDAY_NAMES = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/** Formats "YYYY-MM-DD" into "30 Aug 2026" without any timezone distortion */
function formatDisplayDate(dateStr: string): string {
  if (!dateStr || !isDateOnly(dateStr)) return "";
  const [yearStr, monthStr, dayStr] = dateStr.split("-");
  const year = parseInt(yearStr, 10);
  const monthIdx = parseInt(monthStr, 10) - 1;
  const day = parseInt(dayStr, 10);

  if (
    Number.isNaN(year) ||
    Number.isNaN(monthIdx) ||
    Number.isNaN(day) ||
    monthIdx < 0 ||
    monthIdx > 11
  ) {
    return dateStr;
  }

  return `${day} ${SHORT_MONTH_NAMES[monthIdx]} ${year}`;
}

export default function DatePicker({
  id,
  label,
  value,
  defaultValue,
  onChange,
  minDate,
  maxDate,
  hint,
  error,
  isLabelHidden = false,
  disabled = false,
  required = false,
  placeholder = "Select date",
  fieldClassName,
  className,
  name,
  showClear = true,
  showToday = true,
}: DatePickerProps) {
  const generatedId = useId();
  const pickerId = `${id}-datepicker-${generatedId.replace(/:/g, "")}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const isControlled = value !== undefined;
  const [internalValue, setInternalValue] = useState<string>(
    defaultValue ?? "",
  );
  const activeValue = isControlled ? (value ?? "") : internalValue;

  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<PositionStyle | null>(null);

  // Current view month & year (0-indexed month)
  const todayStr = todayDateOnly();
  const initialDateStr =
    activeValue && isDateOnly(activeValue) ? activeValue : todayStr;
  const [viewYear, setViewYear] = useState(() => {
    const [y] = initialDateStr.split("-");
    return parseInt(y, 10) || new Date().getFullYear();
  });
  const [viewMonth, setViewMonth] = useState(() => {
    const [, m] = initialDateStr.split("-");
    return (parseInt(m, 10) || 1) - 1;
  });

  // Coordinate with other popovers across the application
  useEffect(() => {
    function handleCloseOthers(e: Event) {
      const customEvent = e as CustomEvent<{ sourceId: string }>;
      if (customEvent.detail?.sourceId !== pickerId) {
        setIsOpen(false);
      }
    }

    window.addEventListener("medcare:close-popovers", handleCloseOthers);
    return () => {
      window.removeEventListener("medcare:close-popovers", handleCloseOthers);
    };
  }, [pickerId]);

  /** Computes fixed position and viewport collision for the floating calendar panel */
  useIsomorphicLayoutEffect(() => {
    if (!isOpen) {
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
      const panelHeight = panelEl?.offsetHeight || 340;
      const panelWidth = panelEl?.offsetWidth || 300;

      const spaceBelow = viewportHeight - triggerRect.bottom - 8;
      const spaceAbove = triggerRect.top - 8;

      let top: number;
      let openUpward = false;

      if (spaceBelow < panelHeight && spaceAbove > spaceBelow) {
        openUpward = true;
        top = triggerRect.top - 6 - panelHeight;
        if (top < 8) {
          top = 8;
        }
      } else {
        top = triggerRect.bottom + 6;
        if (top + panelHeight > viewportHeight - 8) {
          top = Math.max(8, viewportHeight - 8 - panelHeight);
        }
      }

      let left = triggerRect.left;
      if (left + panelWidth > viewportWidth - 8) {
        left = viewportWidth - 8 - panelWidth;
      }
      if (left < 8) {
        left = 8;
      }

      setPosition({
        top: Math.round(top),
        left: Math.round(left),
        openUpward,
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
  }, [isOpen]);

  /** Outside-click dismissal */
  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(e: MouseEvent | TouchEvent) {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        panelRef.current?.contains(target)
      ) {
        return;
      }
      setIsOpen(false);
    }

    function handleFocusIn(e: FocusEvent) {
      const target = e.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("focusin", handleFocusIn as unknown as EventListener);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("focusin", handleFocusIn as unknown as EventListener);
    };
  }, [isOpen]);

  function commitDate(dateStr: string) {
    if (!isControlled) {
      setInternalValue(dateStr);
    }
    onChange?.(dateStr);
    setIsOpen(false);
    triggerRef.current?.focus();
  }

  function handleTriggerClick() {
    if (disabled) return;
    const willOpen = !isOpen;
    if (willOpen) {
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("medcare:close-popovers", {
            detail: { sourceId: pickerId },
          }),
        );
      }
      if (activeValue && isDateOnly(activeValue)) {
        const [y, m] = activeValue.split("-");
        setViewYear(parseInt(y, 10));
        setViewMonth(parseInt(m, 10) - 1);
      } else {
        const [y, m] = todayStr.split("-");
        setViewYear(parseInt(y, 10));
        setViewMonth(parseInt(m, 10) - 1);
      }
      setIsOpen(true);
    } else {
      setIsOpen(false);
    }
  }

  function handlePrevMonth() {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  }

  function handleNextMonth() {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      setIsOpen(false);
      triggerRef.current?.focus();
    }
  }

  // Days calculations for calendar matrix
  const firstDayOfMonth = new Date(viewYear, viewMonth, 1).getDay();
  const daysInCurrentMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

  // Calendar cells
  const cells: Array<{
    dateStr: string;
    dayNum: number;
    isCurrentMonth: boolean;
    isDisabled: boolean;
    isSelected: boolean;
    isToday: boolean;
  }> = [];

  // Previous month trailing days
  for (let i = firstDayOfMonth - 1; i >= 0; i--) {
    const day = daysInPrevMonth - i;
    const prevMonthIdx = viewMonth === 0 ? 11 : viewMonth - 1;
    const prevYear = viewMonth === 0 ? viewYear - 1 : viewYear;
    const dateStr = `${prevYear}-${String(prevMonthIdx + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const isDisabled =
      Boolean(minDate && dateStr < minDate) ||
      Boolean(maxDate && dateStr > maxDate);

    cells.push({
      dateStr,
      dayNum: day,
      isCurrentMonth: false,
      isDisabled,
      isSelected: dateStr === activeValue,
      isToday: dateStr === todayStr,
    });
  }

  // Current month days
  for (let d = 1; d <= daysInCurrentMonth; d++) {
    const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const isDisabled =
      Boolean(minDate && dateStr < minDate) ||
      Boolean(maxDate && dateStr > maxDate);

    cells.push({
      dateStr,
      dayNum: d,
      isCurrentMonth: true,
      isDisabled,
      isSelected: dateStr === activeValue,
      isToday: dateStr === todayStr,
    });
  }

  // Next month leading days to complete grid (up to 42 cells or multiple of 7)
  const remainingCells = (7 - (cells.length % 7)) % 7;
  for (let nextD = 1; nextD <= remainingCells; nextD++) {
    const nextMonthIdx = viewMonth === 11 ? 0 : viewMonth + 1;
    const nextYear = viewMonth === 11 ? viewYear + 1 : viewYear;
    const dateStr = `${nextYear}-${String(nextMonthIdx + 1).padStart(2, "0")}-${String(nextD).padStart(2, "0")}`;
    const isDisabled =
      Boolean(minDate && dateStr < minDate) ||
      Boolean(maxDate && dateStr > maxDate);

    cells.push({
      dateStr,
      dayNum: nextD,
      isCurrentMonth: false,
      isDisabled,
      isSelected: dateStr === activeValue,
      isToday: dateStr === todayStr,
    });
  }

  const isInvalid = Boolean(error);
  const displayLabel = formatDisplayDate(activeValue);

  return (
    <FieldShell
      id={id}
      label={isLabelHidden ? "" : label}
      hint={hint}
      error={error}
      className={cx(fieldClassName, "relative")}
    >
      {/* Hidden input for form data serialization if needed */}
      {name && <input type="hidden" name={name} value={activeValue} />}

      {/* Trigger Button */}
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-controls={isOpen ? pickerId : undefined}
        aria-invalid={isInvalid ? true : undefined}
        aria-describedby={error || hint ? `${id}-message` : undefined}
        aria-label={isLabelHidden ? label : undefined}
        disabled={disabled}
        onClick={handleTriggerClick}
        onKeyDown={handleKeyDown}
        className={controlClasses(
          isInvalid,
          cx(
            "flex min-h-11 w-full items-center justify-between text-left",
            "cursor-pointer select-none pl-3.5 pr-3",
            isOpen && "border-accent ring-1 ring-accent",
            className,
          ),
        )}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <CalendarIcon
            aria-hidden="true"
            strokeWidth={2}
            className={cx(
              "h-4 w-4 shrink-0 transition-colors duration-150",
              isOpen ? "text-accent" : "text-muted",
            )}
          />
          <span
            className={cx(
              "truncate text-input font-normal",
              displayLabel ? "text-ink" : "text-faint",
            )}
          >
            {displayLabel || placeholder}
          </span>
        </div>

        {showClear && activeValue && !disabled && (
          <span
            role="button"
            tabIndex={-1}
            aria-label="Clear date"
            onClick={(e) => {
              e.stopPropagation();
              commitDate("");
            }}
            className="flex h-5 w-5 items-center justify-center rounded-full text-muted hover:bg-canvas-deep hover:text-ink transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </span>
        )}
      </button>

      {/* Floating Calendar Popup */}
      {typeof document !== "undefined" &&
        isOpen &&
        createPortal(
          <div
            ref={panelRef}
            id={pickerId}
            role="dialog"
            aria-label={label}
            tabIndex={-1}
            onKeyDown={handleKeyDown}
            style={{
              position: "fixed",
              top: position?.top ?? 0,
              left: position?.left ?? 0,
              zIndex: 9999,
              visibility: position ? "visible" : "hidden",
            }}
            className={cx(
              "w-[292px] rounded-2xl border border-line bg-canvas p-3.5 shadow-float outline-none select-none",
              "animate-in fade-in-0 zoom-in-95 duration-100",
            )}
          >
            {/* Header: Month Year + Prev / Next navigation */}
            <div className="flex items-center justify-between pb-2 border-b border-line/60">
              <div className="text-label font-semibold text-ink pl-1">
                {MONTH_NAMES[viewMonth]} {viewYear}
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Previous month"
                  onClick={handlePrevMonth}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-canvas-deep hover:text-ink transition-colors"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="Next month"
                  onClick={handleNextMonth}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-canvas-deep hover:text-ink transition-colors"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Days of week header */}
            <div className="grid grid-cols-7 gap-1 pt-2 pb-1 text-center text-meta font-medium text-muted">
              {WEEKDAY_NAMES.map((w) => (
                <div key={w} className="h-7 flex items-center justify-center">
                  {w}
                </div>
              ))}
            </div>

            {/* Calendar grid */}
            <div className="grid grid-cols-7 gap-1">
              {cells.map((cell) => {
                return (
                  <button
                    key={cell.dateStr}
                    type="button"
                    disabled={cell.isDisabled}
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => {
                      if (!cell.isDisabled) {
                        commitDate(cell.dateStr);
                      }
                    }}
                    className={cx(
                      "flex h-8 w-8 items-center justify-center rounded-xl text-input font-medium transition-colors duration-100",
                      cell.isDisabled
                        ? "cursor-not-allowed opacity-30 text-muted"
                        : "cursor-pointer",
                      cell.isSelected
                        ? "bg-accent text-accent-ink font-semibold shadow-sm"
                        : cell.isToday
                          ? "border border-accent/40 text-accent font-semibold hover:bg-accent-soft"
                          : cell.isCurrentMonth
                            ? "text-ink hover:bg-canvas-deep"
                            : "text-muted/50 hover:bg-canvas-deep",
                    )}
                  >
                    {cell.dayNum}
                  </button>
                );
              })}
            </div>

            {/* Footer: Today & Clear actions */}
            <div className="mt-3 flex items-center justify-between border-t border-line/60 pt-2 text-label">
              {showToday ? (
                <button
                  type="button"
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => {
                    const isDisabled =
                      Boolean(minDate && todayStr < minDate) ||
                      Boolean(maxDate && todayStr > maxDate);
                    if (!isDisabled) {
                      commitDate(todayStr);
                    }
                  }}
                  className="font-medium text-accent hover:underline py-1 px-1.5 rounded-lg hover:bg-accent-soft transition-colors"
                >
                  Today
                </button>
              ) : (
                <div />
              )}

              {showClear && !required ? (
                <button
                  type="button"
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => commitDate("")}
                  className="text-muted hover:text-ink py-1 px-1.5 rounded-lg hover:bg-canvas-deep transition-colors"
                >
                  Clear
                </button>
              ) : null}
            </div>
          </div>,
          document.body,
        )}
    </FieldShell>
  );
}
