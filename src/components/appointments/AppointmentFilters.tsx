"use client";

import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState, type FormEvent } from "react";
import {
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_STATUS_ORDER,
} from "@/components/appointments/status";
import Button from "@/components/ui/Button";
import DatePicker from "@/components/ui/DatePicker";
import FilterBar from "@/components/ui/FilterBar";
import IconButton from "@/components/ui/IconButton";
import Select from "@/components/ui/Select";
import { cx } from "@/components/ui/cx";

/**
 * The board's controls — AP-6.
 *
 * TWO SURFACES, TWO JOBS. The day strip is the control a front desk touches
 * every few minutes — yesterday, today, tomorrow — so it sits above the board,
 * always visible, one tap per move. The narrowing filters (doctor, state,
 * history) are opened occasionally, so they live in the shared FilterBar, which
 * collapses to a sheet on a phone.
 *
 * The clinic filter is deliberately absent, exactly as on the registration
 * list: the header switcher already chooses the clinic for every module, and a
 * second clinic control here would let the two disagree.
 *
 * APPLYING A FILTER NAVIGATES rather than fetching, so the resulting board is
 * shareable and survives a refresh — a receptionist can leave "today, Dr Rao"
 * open all morning and it is still right after a reload.
 *
 * "Show past outcomes" is a checkbox rather than three more status options
 * because it answers a different question. The status select narrows to one
 * state; this widens the board from "what is still going to happen" to "what
 * happened as well", which is what `includeHistory` means on the server.
 */

export interface DoctorFilterOption {
  id: string;
  name: string;
}

export interface AppointmentFilterValues {
  view: "day" | "upcoming";
  date: string;
  doctorId: string;
  status: string;
  includeHistory: boolean;
}

interface AppointmentFiltersProps {
  doctors: readonly DoctorFilterOption[];
  initial: AppointmentFilterValues;
  /** Offered as the one-click way back to the day in front of the desk. */
  today: string;
  initialIndicators?: Record<string, { count: number }>;
  clinicId?: string;
}

/** Blank values are left out entirely, so the URL shows only what is applied. */
function toQueryString(values: AppointmentFilterValues): string {
  const params = new URLSearchParams();

  if (values.view === "upcoming") {
    params.set("view", "upcoming");
  } else {
    params.set("view", "day");
    if (values.date.trim() !== "") params.set("date", values.date.trim());
  }

  if (values.doctorId.trim() !== "") params.set("doctorId", values.doctorId.trim());
  if (values.status.trim() !== "") params.set("status", values.status.trim());
  if (values.includeHistory) params.set("includeHistory", "true");

  return params.toString();
}

/**
 * Shifts a YYYY-MM-DD string by whole days.
 *
 * UTC MATH ON PURPOSE. `new Date("2026-08-24")` is parsed as midnight UTC, and
 * doing the arithmetic in local time would land on the previous day for any
 * clinic west of Greenwich. The value here is a calendar date, not an instant.
 */
function shiftDate(date: string, days: number): string {
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed)) {
    return date;
  }
  return new Date(parsed + days * 86_400_000).toISOString().slice(0, 10);
}

/** "Sunday, 30 Aug 2026" from a "YYYY-MM-DD" stored instant. */
function formatDayWithWeekday(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }
  return parsed.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function AppointmentFilters({
  doctors,
  initial,
  today,
  initialIndicators,
  clinicId,
}: AppointmentFiltersProps) {
  const router = useRouter();
  const [values, setValues] = useState<AppointmentFilterValues>(initial);
  const [indicators, setIndicators] = useState<
    Record<string, { count: number }>
  >(initialIndicators ?? {});

  const fetchMonthIndicators = useCallback(
    async (year: number, month: number) => {
      try {
        const monthStr = String(month).padStart(2, "0");
        const lastDay = new Date(year, month, 0).getDate();
        const dateFrom = `${year}-${monthStr}-01`;
        const dateTo = `${year}-${monthStr}-${String(lastDay).padStart(2, "0")}`;

        const params = new URLSearchParams({
          dateFrom,
          dateTo,
        });
        if (clinicId) params.set("clinicId", clinicId);
        if (values.doctorId) params.set("doctorId", values.doctorId);
        if (values.status) params.set("status", values.status);
        if (values.includeHistory) params.set("includeHistory", "true");

        const res = await fetch(
          `/api/appointments/indicators?${params.toString()}`,
        );
        if (res.ok) {
          const json = await res.json();
          if (json.data) {
            setIndicators((prev) => ({ ...prev, ...json.data }));
          }
        }
      } catch {
        // Non-critical background enhancement
      }
    },
    [clinicId, values.doctorId, values.status, values.includeHistory],
  );

  const activeCount =
    (initial.doctorId !== "" ? 1 : 0) +
    (initial.status !== "" ? 1 : 0) +
    (initial.includeHistory ? 1 : 0);

  const go = (next: AppointmentFilterValues) => {
    const query = toQueryString(next);
    router.push(query === "" ? "/appointments" : `/appointments?${query}`);
  };

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // No page parameter: a new filter always starts from the first page.
    go(values);
  }

  /** The day strip navigates immediately — it is a view change, not a filter. */
  function goToDate(date: string) {
    const next: AppointmentFilterValues = {
      ...values,
      view: "day",
      date,
    };
    setValues(next);
    go(next);
  }

  function goToView(view: "day" | "upcoming") {
    const targetDate = values.date || today;
    const next: AppointmentFilterValues = {
      ...values,
      view,
      date: view === "day" ? targetDate : "",
    };
    setValues(next);
    go(next);
  }

  function handleClear() {
    const next: AppointmentFilterValues = {
      view: "day",
      date: today,
      doctorId: "",
      status: "",
      includeHistory: false,
    };
    setValues(next);
    go(next);
  }

  const isUpcoming = values.view === "upcoming";
  const isToday = !isUpcoming && values.date === today;
  const currentDayForShift = values.date || today;

  return (
    <div className="space-y-4">
      {/* 2. DATE / VIEW TOOLBAR */}
      <div className="flex flex-col gap-3 rounded-3xl border border-line bg-canvas p-3 shadow-card md:grid md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center lg:p-4">
        {/* Left: Previous day button + Date display */}
        <div className="flex items-center gap-3 min-w-0 justify-self-start">
          <IconButton
            label="Previous day"
            size="sm"
            isOutlined
            disabled={isUpcoming}
            onClick={() => goToDate(shiftDate(currentDayForShift, -1))}
          >
            <ChevronLeft aria-hidden="true" strokeWidth={2} className="h-4 w-4" />
          </IconButton>

          <div className="flex items-center gap-3 min-w-0">
            <Calendar
              aria-hidden="true"
              strokeWidth={2}
              className="h-5 w-5 shrink-0 text-muted"
            />
            <div className="min-w-0">
              <p className="truncate text-body font-semibold text-ink leading-tight">
                {isUpcoming
                  ? "All upcoming days"
                  : formatDayWithWeekday(values.date || today)}
              </p>
              <p
                className={cx(
                  "truncate text-meta font-medium leading-tight mt-0.5",
                  !isUpcoming && isToday ? "text-accent font-semibold" : "text-muted",
                )}
              >
                {isUpcoming
                  ? "Every scheduled appointment"
                  : isToday
                    ? "Today"
                    : "Selected day"}
              </p>
            </div>
          </div>
        </div>

        {/* Center: Day | Upcoming segmented control */}
        <div className="flex items-center justify-center justify-self-center">
          <div
            role="tablist"
            aria-label="View range"
            className="inline-flex items-center rounded-2xl border border-line bg-canvas-deep p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={!isUpcoming}
              onClick={() => goToView("day")}
              className={cx(
                "min-h-9 rounded-xl px-4 text-label font-semibold transition-all duration-150 border",
                !isUpcoming
                  ? "bg-canvas text-ink shadow-card border-line/40"
                  : "border-transparent text-muted hover:text-ink",
              )}
            >
              Day
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isUpcoming}
              onClick={() => goToView("upcoming")}
              className={cx(
                "min-h-9 rounded-xl px-4 text-label font-semibold transition-all duration-150 border",
                isUpcoming
                  ? "bg-canvas text-ink shadow-card border-line/40"
                  : "border-transparent text-muted hover:text-ink",
              )}
            >
              Upcoming
            </button>
          </div>
        </div>

        {/* Right: Today, Date Picker, Next day button */}
        <div className="flex flex-wrap items-center gap-2 justify-self-end">
          <Button
            size="sm"
            variant={!isUpcoming && isToday ? "primary" : "secondary"}
            onClick={() => goToDate(today)}
          >
            Today
          </Button>

          {/* Accessible custom DatePicker styled to MEDCARE PRO system */}
          <div className="w-40 sm:w-44">
            <DatePicker
              id="appointment-filter-date"
              label="Jump to date"
              isLabelHidden
              value={isUpcoming ? "" : values.date}
              onChange={(newDate) => goToDate(newDate)}
              placeholder="Select date"
              className="!min-h-9 !py-1.5 !rounded-xl !text-label"
              showClear={false}
              showToday={false}
              align="end"
              dateIndicators={indicators}
              onMonthChange={fetchMonthIndicators}
            />
          </div>

          <IconButton
            label="Next day"
            size="sm"
            isOutlined
            disabled={isUpcoming}
            onClick={() => goToDate(shiftDate(currentDayForShift, 1))}
          >
            <ChevronRight aria-hidden="true" strokeWidth={2} className="h-4 w-4" />
          </IconButton>
        </div>
      </div>

      {/* 3. FILTER SURFACE */}
      <form onSubmit={handleSubmit}>
        <FilterBar
          activeCount={activeCount}
          hideMobileShowResults={true}
          clearAction={
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleClear}
              className="text-muted hover:text-ink"
            >
              Clear
            </Button>
          }
          actions={
            <Button type="submit" size="sm" variant="primary" className="min-w-20">
              Apply
            </Button>
          }
        >
          <Select
            id="appointment-filter-doctor"
            label="Doctor"
            fieldClassName="w-full sm:w-56"
            value={values.doctorId}
            onChange={(e) => setValues({ ...values, doctorId: e.target.value })}
          >
            <option value="">All doctors</option>
            {doctors.map((doctor) => (
              <option key={doctor.id} value={doctor.id}>
                {doctor.name}
              </option>
            ))}
          </Select>

          <Select
            id="appointment-filter-status"
            label="State"
            fieldClassName="w-full sm:w-48"
            value={values.status}
            onChange={(e) => setValues({ ...values, status: e.target.value })}
          >
            <option value="">All states</option>
            {APPOINTMENT_STATUS_ORDER.map((status) => (
              <option key={status} value={status}>
                {APPOINTMENT_STATUS_LABELS[status]}
              </option>
            ))}
          </Select>

          <label
            htmlFor="appointment-filter-history"
            className="flex min-h-11 cursor-pointer items-center gap-2.5 text-body text-ink-soft whitespace-nowrap"
          >
            <input
              id="appointment-filter-history"
              type="checkbox"
              checked={values.includeHistory}
              onChange={(e) =>
                setValues({ ...values, includeHistory: e.target.checked })
              }
              className="h-4 w-4 rounded-[5px] border-line-strong accent-accent"
            />
            Include cancelled, missed and moved
          </label>
        </FilterBar>
      </form>
    </div>
  );
}
