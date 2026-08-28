"use client";

import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_STATUS_ORDER,
  formatAppointmentDate,
} from "@/components/appointments/status";
import Button from "@/components/ui/Button";
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
}

/** Blank values are left out entirely, so the URL shows only what is applied. */
function toQueryString(values: AppointmentFilterValues): string {
  const params = new URLSearchParams();

  if (values.date.trim() !== "") params.set("date", values.date.trim());
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

export default function AppointmentFilters({
  doctors,
  initial,
  today,
}: AppointmentFiltersProps) {
  const router = useRouter();
  const [values, setValues] = useState<AppointmentFilterValues>(initial);

  // The board defaults to today, so "narrowed" means anything other than that
  // plain day view — otherwise a Clear button would sit there from first load.
  const activeCount =
    (initial.doctorId !== "" ? 1 : 0) +
    (initial.status !== "" ? 1 : 0) +
    (initial.includeHistory ? 1 : 0);
  const isNarrowed = activeCount > 0 || initial.date !== today;

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
    const next = { ...values, date };
    setValues(next);
    go(next);
  }

  function handleClear() {
    const next: AppointmentFilterValues = {
      date: today,
      doctorId: "",
      status: "",
      includeHistory: false,
    };
    setValues(next);
    go(next);
  }

  const isToday = values.date === today;
  const hasDate = values.date !== "";

  return (
    <div className="space-y-3">
      {/* The day strip. */}
      <div className="flex flex-wrap items-center gap-2 rounded-3xl border border-line bg-canvas p-2 shadow-card">
        <IconButton
          label="Previous day"
          size="sm"
          disabled={!hasDate}
          onClick={() => goToDate(shiftDate(values.date, -1))}
        >
          <ChevronLeft aria-hidden="true" strokeWidth={2} className="h-4 w-4" />
        </IconButton>

        <div className="min-w-0 flex-1 px-1 text-center sm:text-left">
          <p className="truncate text-body font-semibold text-ink">
            {hasDate ? formatAppointmentDate(values.date) : "All upcoming days"}
          </p>
          <p className="truncate text-meta text-muted">
            {hasDate
              ? isToday
                ? "Today"
                : "Selected day"
              : "Every scheduled appointment"}
          </p>
        </div>

        <IconButton
          label="Next day"
          size="sm"
          disabled={!hasDate}
          onClick={() => goToDate(shiftDate(values.date, 1))}
        >
          <ChevronRight aria-hidden="true" strokeWidth={2} className="h-4 w-4" />
        </IconButton>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={isToday ? "primary" : "secondary"}
            onClick={() => goToDate(today)}
          >
            Today
          </Button>

          {/*
            The native date input is the picker. On the front-desk tablet the OS
            wheel beats anything built here, and it is one tab stop rather than
            a grid of forty buttons.
          */}
          <label htmlFor="appointment-filter-date" className="sr-only">
            Jump to date
          </label>
          <input
            id="appointment-filter-date"
            type="date"
            value={values.date}
            onChange={(event) => goToDate(event.target.value)}
            className={cx(
              "h-9 rounded-xl border border-line bg-canvas px-3 text-body text-ink",
              "transition-colors duration-150 hover:border-line-strong",
            )}
          />

          {hasDate && (
            <Button size="sm" variant="ghost" onClick={() => goToDate("")}>
              All days
            </Button>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <FilterBar
          activeCount={activeCount}
          clearAction={
            isNarrowed ? (
              <Button type="button" size="sm" variant="ghost" onClick={handleClear}>
                <X aria-hidden="true" strokeWidth={2} className="h-4 w-4" />
                Clear filters
              </Button>
            ) : null
          }
          actions={
            <Button type="submit" size="sm" variant="primary">
              <Search aria-hidden="true" strokeWidth={2} className="h-4 w-4" />
              Apply
            </Button>
          }
        >
          <Select
            id="appointment-filter-doctor"
            label="Doctor"
            fieldClassName="md:w-56"
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
            fieldClassName="md:w-48"
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
            className="flex min-h-11 cursor-pointer items-center gap-2.5 text-body text-ink-soft"
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
