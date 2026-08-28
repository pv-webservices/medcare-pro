"use client";

import { Download, Search, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Button, { buttonClasses } from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import FilterBar from "@/components/ui/FilterBar";
import Select from "@/components/ui/Select";

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
 *
 * "Apply" is the `primary` variant, not `commit`. Commit colour marks a write
 * into a clinic's records; narrowing a list writes nothing, and spending the
 * clinic's colour on it would blunt the one signal that matters.
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

  const activeCount = Object.values(initial).filter((value) => value.trim() !== "").length;

  return (
    <form onSubmit={handleSubmit}>
      <FilterBar
        activeCount={activeCount}
        clearAction={
          isFiltered ? (
            <Button type="button" size="sm" variant="ghost" onClick={handleClear}>
              <X aria-hidden="true" strokeWidth={2} className="h-4 w-4" />
              Clear filters
            </Button>
          ) : null
        }
        actions={
          <>
            {/*
              FR-3.4 — exports exactly the rows currently listed, which is why
              it takes the APPLIED filters rather than what is typed but not yet
              applied.
            */}
            <a
              href={`/api/registrations?${exportQueryString(initial, clinicId)}`}
              className={buttonClasses("secondary", "sm")}
            >
              <Download aria-hidden="true" strokeWidth={2} className="h-4 w-4" />
              Export CSV
            </a>
            <Button type="submit" size="sm" variant="primary">
              <Search aria-hidden="true" strokeWidth={2} className="h-4 w-4" />
              Apply
            </Button>
          </>
        }
      >
        <Input
          id="registration-search"
          type="search"
          autoComplete="off"
          label="Patient name or phone number"
          placeholder="Priya, or 98765..."
          value={values.search}
          onChange={(e) => update("search", e.target.value)}
          fieldClassName="md:w-64"
        />

        <Select
          id="registration-filter-doctor"
          label="Doctor"
          fieldClassName="md:w-48"
          value={values.doctorId}
          onChange={(e) => update("doctorId", e.target.value)}
        >
          <option value="">All doctors</option>
          {doctors.map((doctor) => (
            <option key={doctor.id} value={doctor.id}>
              {doctor.name}
            </option>
          ))}
        </Select>

        <Select
          id="registration-filter-department"
          label="Department"
          fieldClassName="md:w-44"
          value={values.department}
          onChange={(e) => update("department", e.target.value)}
        >
          <option value="">All departments</option>
          {departments.map((department) => (
            <option key={department} value={department}>
              {department}
            </option>
          ))}
        </Select>

        <Input
          id="registration-filter-from"
          type="date"
          label="From"
          fieldClassName="md:w-40"
          value={values.from}
          onChange={(e) => update("from", e.target.value)}
        />
        <Input
          id="registration-filter-to"
          type="date"
          label="To"
          fieldClassName="md:w-40"
          value={values.to}
          onChange={(e) => update("to", e.target.value)}
        />
      </FilterBar>
    </form>
  );
}
