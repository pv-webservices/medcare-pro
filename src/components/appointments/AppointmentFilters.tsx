"use client";

import { CalendarDays, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_STATUS_ORDER,
} from "@/components/appointments/status";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Panel from "@/components/ui/Panel";
import Select from "@/components/ui/Select";

/**
 * The board's controls — AP-6.
 *
 * The clinic filter is deliberately absent, exactly as on the registration
 * list: the sidebar switcher already chooses the clinic for every module, and a
 * second clinic control here would let the two disagree.
 *
 * Applying a filter NAVIGATES rather than fetching, so the resulting board is
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

export default function AppointmentFilters({
  doctors,
  initial,
  today,
}: AppointmentFiltersProps) {
  const router = useRouter();
  const [values, setValues] = useState<AppointmentFilterValues>(initial);

  // The board defaults to today, so "filtered" means anything other than that
  // plain day view — otherwise a Clear button would sit there from first load.
  const isNarrowed =
    initial.doctorId !== "" ||
    initial.status !== "" ||
    initial.includeHistory ||
    initial.date !== today;

  const go = (next: AppointmentFilterValues) => {
    const query = toQueryString(next);
    router.push(query === "" ? "/appointments" : `/appointments?${query}`);
  };

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // No page parameter: a new filter always starts from the first page.
    go(values);
  }

  function handleToday() {
    const next = { ...values, date: today };
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

  return (
    <Panel
      title="Find an appointment"
      description="Pick a day, then narrow by doctor or state. Clear the date to see every upcoming slot."
      className="mb-5"
      actions={
        <Button size="sm" variant="secondary" onClick={handleToday}>
          <CalendarDays aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
          Today
        </Button>
      }
    >
      <form onSubmit={handleSubmit}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Input
            id="appointment-filter-date"
            type="date"
            label="Date"
            hint="Leave blank to see every day."
            value={values.date}
            onChange={(e) => setValues({ ...values, date: e.target.value })}
          />

          <Select
            id="appointment-filter-doctor"
            label="Doctor"
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
        </div>

        <label
          htmlFor="appointment-filter-history"
          className="mt-4 flex min-h-11 w-fit cursor-pointer items-center gap-2.5 text-sm font-medium text-ink"
        >
          <input
            id="appointment-filter-history"
            type="checkbox"
            checked={values.includeHistory}
            onChange={(e) =>
              setValues({ ...values, includeHistory: e.target.checked })
            }
            className="h-4 w-4 rounded border-line text-primary focus:ring-primary"
          />
          Show cancelled, missed and moved appointments
        </label>

        <div className="mt-5 flex flex-wrap gap-3">
          <Button type="submit" variant="commit">
            <Search aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
            Apply Filters
          </Button>

          {isNarrowed && (
            <Button variant="quiet" onClick={handleClear}>
              <X aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
              Clear Filters
            </Button>
          )}
        </div>
      </form>
    </Panel>
  );
}
