"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Select from "@/components/ui/Select";
import { SELECTED_CLINIC_COOKIE } from "@/lib/cookieNames";

/**
 * Clinic switcher — FR-2.3 (every module is scoped by clinic).
 *
 * Records the choice in a cookie and refreshes, so server components re-render
 * against the new selection.
 *
 * The cookie is a CONVENIENCE ONLY and is trivially editable by the user. Any
 * page or route that reads it must pass it through
 * `resolveSelectedClinicId()`, which re-checks the id against the actor's own
 * clinic scope. Never query on this value directly.
 */

interface ClinicOption {
  id: string;
  name: string;
}

interface ClinicSwitcherProps {
  clinics: readonly ClinicOption[];
  selectedClinicId: string | null;
}

/** One year. The selection is a preference, not a credential. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export default function ClinicSwitcher({
  clinics,
  selectedClinicId,
}: ClinicSwitcherProps) {
  const router = useRouter();
  const [value, setValue] = useState(selectedClinicId ?? "");

  // Nothing to switch between.
  if (clinics.length < 2) {
    return null;
  }

  function handleChange(next: string) {
    setValue(next);
    document.cookie = `${SELECTED_CLINIC_COOKIE}=${encodeURIComponent(next)}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
    router.refresh();
  }

  return (
    <Select
      id="clinic-switcher"
      label="Viewing clinic"
      value={value}
      onChange={(e) => handleChange(e.target.value)}
    >
      <option value="">All clinics</option>
      {clinics.map((clinic) => (
        <option key={clinic.id} value={clinic.id}>
          {clinic.name}
        </option>
      ))}
    </Select>
  );
}
