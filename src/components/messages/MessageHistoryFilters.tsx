"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, X } from "lucide-react";
import DatePicker from "@/components/ui/DatePicker";
import { cx } from "@/components/ui/cx";
import type { MessageHistoryRange } from "@/lib/messageHistoryFilter";

interface MessageHistoryFiltersProps {
  currentRange: MessageHistoryRange;
  currentFrom?: string;
  currentTo?: string;
  totalCount: number;
  error?: string;
}

const QUICK_FILTERS: Array<{ id: MessageHistoryRange; label: string }> = [
  { id: "all", label: "All" },
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "this-week", label: "This Week" },
];

function formatDisplayDate(dateStr?: string): string {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function MessageHistoryFilters({
  currentRange,
  currentFrom = "",
  currentTo = "",
  totalCount,
  error,
}: MessageHistoryFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const hasActiveFilter =
    currentRange !== "all" || Boolean(currentFrom) || Boolean(currentTo);

  const applyParams = (updater: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    updater(params);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const handleQuickFilter = (range: MessageHistoryRange) => {
    applyParams((params) => {
      if (range === "all") {
        params.delete("historyRange");
        params.delete("historyFrom");
        params.delete("historyTo");
      } else {
        params.set("historyRange", range);
        params.delete("historyFrom");
        params.delete("historyTo");
      }
    });
  };

  const handleFromChange = (newFrom: string) => {
    applyParams((params) => {
      params.set("historyRange", "custom");
      if (newFrom.trim()) {
        params.set("historyFrom", newFrom.trim());
      } else {
        params.delete("historyFrom");
      }
    });
  };

  const handleToChange = (newTo: string) => {
    applyParams((params) => {
      params.set("historyRange", "custom");
      if (newTo.trim()) {
        params.set("historyTo", newTo.trim());
      } else {
        params.delete("historyTo");
      }
    });
  };

  const handleClear = () => {
    applyParams((params) => {
      params.delete("historyRange");
      params.delete("historyFrom");
      params.delete("historyTo");
    });
  };

  let summary = "";
  if (currentRange === "custom") {
    if (currentFrom && currentTo) {
      summary = `${formatDisplayDate(currentFrom)} – ${formatDisplayDate(currentTo)}`;
    } else if (currentFrom) {
      summary = `From ${formatDisplayDate(currentFrom)}`;
    } else if (currentTo) {
      summary = `Through ${formatDisplayDate(currentTo)}`;
    }
  }

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Quick Filter Buttons */}
        <div
          role="group"
          aria-label="Message history date filter"
          className="inline-flex flex-wrap items-center gap-1 rounded-2xl border border-line bg-canvas-deep/40 p-1"
        >
          {QUICK_FILTERS.map((filter) => {
            const isSelected = currentRange === filter.id;
            return (
              <button
                key={filter.id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => handleQuickFilter(filter.id)}
                className={cx(
                  "min-h-9 rounded-xl px-3.5 py-1.5 text-label font-semibold transition-all duration-150 border",
                  isSelected
                    ? "bg-canvas text-ink shadow-card border-line"
                    : "border-transparent text-muted hover:text-ink hover:bg-canvas-deep/80",
                )}
              >
                {filter.label}
              </button>
            );
          })}
        </div>

        {/* Date Pickers & Clear */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-36 sm:w-40">
            <DatePicker
              id="history-filter-from"
              label="From"
              isLabelHidden
              value={currentFrom}
              maxDate={currentTo || undefined}
              onChange={handleFromChange}
              placeholder="From date"
              className="!min-h-9 !py-1.5 !rounded-xl !text-label"
              showToday={false}
              showClear={false}
            />
          </div>

          <div className="w-36 sm:w-40">
            <DatePicker
              id="history-filter-to"
              label="To"
              isLabelHidden
              value={currentTo}
              minDate={currentFrom || undefined}
              onChange={handleToChange}
              placeholder="To date"
              className="!min-h-9 !py-1.5 !rounded-xl !text-label"
              showToday={false}
              showClear={false}
            />
          </div>

          {hasActiveFilter && (
            <button
              type="button"
              onClick={handleClear}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-line bg-canvas px-3 py-1.5 text-label font-semibold text-muted hover:text-ink hover:bg-canvas-deep transition-colors shadow-sm"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Clear filters</span>
            </button>
          )}
        </div>
      </div>

      {/* Summary and Count Info */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-micro text-muted px-0.5">
        <span className="font-medium">
          {summary ? <span>{summary} &middot; </span> : null}
          <span className="tnum">
            {totalCount} {totalCount === 1 ? "message" : "messages"}
          </span>
        </span>
      </div>

      {/* Validation Error Banner */}
      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-xl border border-alert-line bg-alert-bg px-3.5 py-2 text-label font-medium text-alert-ink"
        >
          <AlertCircle className="h-4 w-4 shrink-0 text-alert-ink" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
