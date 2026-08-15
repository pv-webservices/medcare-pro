"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

/**
 * Search, filter and export controls — PRD §6.3 (FR-3.2 … FR-3.4).
 *
 * The clinic filter is deliberately absent: the sidebar switcher (FR-2.3)
 * already chooses the clinic for every module, and a second clinic control on
 * this page would let the two disagree.
 *
 * Applying a filter navigates rather than fetching, so the resulting list is
 * shareable and survives a refresh — a receptionist can leave "today, Dr Rao"
 * open all morning.
 */

export interface DoctorFilterOption {
  id: string;
  name: string;
}

export interface RegistrationFilterValues {
  search: string;
  doctorId: string;
  department: string;
  from: string;
  to: string;
}

interface RegistrationFiltersProps {
  doctors: readonly DoctorFilterOption[];
  departments: readonly string[];
  initial: RegistrationFilterValues;
  /**
   * The clinic the sidebar switcher has selected, already resolved against this
   * user's scope. Not a form control — it only rides along on the export link so
   * the CSV covers the same clinic as the list on screen.
   */
  clinicId: string | null;
}

const INPUT_CLASS =
  "block min-h-11 w-full rounded border border-black/20 bg-transparent px-3 text-base outline-none focus:border-black/60 dark:border-white/25 dark:focus:border-white/60";
const LABEL_CLASS = "mb-1 block text-sm font-medium";

const EMPTY: RegistrationFilterValues = {
  search: "",
  doctorId: "",
  department: "",
  from: "",
  to: "",
};

/** Blank filters are left out entirely, so the URL shows only what is applied. */
function toQueryString(values: RegistrationFilterValues): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(values)) {
    if (value.trim() !== "") {
      params.set(key, value.trim());
    }
  }

  return params.toString();
}

/** The export link mirrors what is on screen, so it takes the APPLIED filters. */
function exportQueryString(
  applied: RegistrationFilterValues,
  clinicId: string | null,
): string {
  const params = new URLSearchParams(toQueryString(applied));

  if (clinicId) {
    params.set("clinicId", clinicId);
  }

  params.set("format", "csv");
  return params.toString();
}

export default function RegistrationFilters({
  doctors,
  departments,
  initial,
  clinicId,
}: RegistrationFiltersProps) {
  const router = useRouter();
  const [values, setValues] = useState<RegistrationFilterValues>(initial);

  const query = toQueryString(values);
  const isFiltered = toQueryString(initial) !== "";

  const update = (field: keyof RegistrationFilterValues, value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // No page parameter: a new filter always starts from the first page.
    router.push(query === "" ? "/registration" : `/registration?${query}`);
  }

  function handleClear() {
    setValues(EMPTY);
    router.push("/registration");
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-6 rounded border border-black/15 p-4 dark:border-white/20"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="lg:col-span-3">
          <label htmlFor="registration-search" className={LABEL_CLASS}>
            Search by patient name or phone number
          </label>
          <input
            id="registration-search"
            type="search"
            autoComplete="off"
            value={values.search}
            onChange={(e) => update("search", e.target.value)}
            className={INPUT_CLASS}
          />
        </div>

        <div>
          <label htmlFor="registration-filter-doctor" className={LABEL_CLASS}>
            Doctor
          </label>
          <select
            id="registration-filter-doctor"
            value={values.doctorId}
            onChange={(e) => update("doctorId", e.target.value)}
            className={INPUT_CLASS}
          >
            <option value="">All doctors</option>
            {doctors.map((doctor) => (
              <option key={doctor.id} value={doctor.id}>
                {doctor.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="registration-filter-department" className={LABEL_CLASS}>
            Department
          </label>
          <select
            id="registration-filter-department"
            value={values.department}
            onChange={(e) => update("department", e.target.value)}
            className={INPUT_CLASS}
          >
            <option value="">All departments</option>
            {departments.map((department) => (
              <option key={department} value={department}>
                {department}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="registration-filter-from" className={LABEL_CLASS}>
              From
            </label>
            <input
              id="registration-filter-from"
              type="date"
              value={values.from}
              onChange={(e) => update("from", e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label htmlFor="registration-filter-to" className={LABEL_CLASS}>
              To
            </label>
            <input
              id="registration-filter-to"
              type="date"
              value={values.to}
              onChange={(e) => update("to", e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="submit"
          className="min-h-11 rounded bg-foreground px-5 text-base font-medium text-background"
        >
          Apply Filters
        </button>

        {isFiltered && (
          <button
            type="button"
            onClick={handleClear}
            className="min-h-11 rounded border border-black/20 px-5 text-base font-medium dark:border-white/25"
          >
            Clear Filters
          </button>
        )}

        {/* FR-3.4 — exports exactly the rows currently listed. */}
        <a
          href={`/api/registrations?${exportQueryString(initial, clinicId)}`}
          className="inline-flex min-h-11 items-center rounded border border-black/20 px-5 text-base font-medium dark:border-white/25"
        >
          Export CSV
        </a>
      </div>
    </form>
  );
}
