"use client";

import { Download, Search, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";

/**
 * Search, filter and export controls — PRD §6.3 (FR-3.2 … FR-3.4).
 *
 * The clinic filter is deliberately absent: the sidebar switcher (FR-2.3)
 * already chooses the clinic for every module, and a second clinic control on
 * this page would let the two disagree.
 *
 * Applying a filter navigates rather than fetching, so the resulting list is
 * shareable and survives a refresh.
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
  clinicId: string | null;
}

const EMPTY: RegistrationFilterValues = {
  search: "",
  doctorId: "",
  department: "",
  from: "",
  to: "",
};

function toQueryString(values: RegistrationFilterValues): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(values)) {
    if (value.trim() !== "") {
      params.set(key, value.trim());
    }
  }

  return params.toString();
}

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
    router.push(query === "" ? "/registration" : `/registration?${query}`);
  }

  function handleClear() {
    setValues(EMPTY);
    router.push("/registration");
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-3xl border border-line bg-canvas p-5 sm:p-6 shadow-card"
    >
      <div className="flex flex-wrap items-end gap-3.5">
        <div className="min-w-[200px] flex-1">
          <Input
            id="registration-search"
            type="search"
            autoComplete="off"
            label="Patient name or phone number"
            placeholder="Priya, or 98765..."
            icon={<Search className="h-4 w-4 text-muted" />}
            value={values.search}
            onChange={(e) => update("search", e.target.value)}
          />
        </div>

        <div className="w-full sm:w-44">
          <Select
            id="registration-filter-doctor"
            label="Doctor"
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
        </div>

        <div className="w-full sm:w-44">
          <Select
            id="registration-filter-department"
            label="Department"
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
        </div>

        <div className="w-full sm:w-36">
          <Input
            id="registration-filter-from"
            type="date"
            label="From"
            value={values.from}
            onChange={(e) => update("from", e.target.value)}
          />
        </div>

        <div className="w-full sm:w-36">
          <Input
            id="registration-filter-to"
            type="date"
            label="To"
            value={values.to}
            onChange={(e) => update("to", e.target.value)}
          />
        </div>

        <div className="flex items-center gap-2 pt-2 sm:pt-0">
          <a
            href={`/api/registrations?${exportQueryString(initial, clinicId)}`}
            className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-canvas px-4 py-2.5 text-label font-semibold text-ink shadow-sm hover:bg-canvas-deep transition-colors whitespace-nowrap"
          >
            <Download aria-hidden="true" strokeWidth={2} className="h-4 w-4 text-muted" />
            <span>Export CSV</span>
          </a>

          <Button
            type="submit"
            variant="primary"
            className="rounded-xl px-5 py-2.5 font-semibold text-body shadow-cta whitespace-nowrap"
          >
            Apply
          </Button>

          {isFiltered && (
            <Button
              type="button"
              variant="ghost"
              onClick={handleClear}
              className="rounded-xl px-3 py-2 text-label text-muted hover:text-ink whitespace-nowrap"
            >
              <X className="h-4 w-4 mr-1" />
              Clear
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
