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
 * page or route that reads it must pass it through `resolveSelectedClinicId()`,
 * which re-checks the id against the actor's own clinic scope. Never query on
 * this value directly.
 *
 * It sits at the top of the sidebar as an inset well, because it is the one
 * control up there that changes what every screen below it means. The label is
 * hidden from sight but not from screen readers, and replaced by the caption —
 * "Viewing clinic" twice over would be noise for a sighted reader and the whole
 * context for a blind one.
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
    <div>
      <p
        aria-hidden="true"
        className="mb-2 px-4 text-micro font-semibold uppercase text-muted"
      >
        Viewing clinic
      </p>

      <Select
        id="clinic-switcher"
        label="Viewing clinic"
        isLabelHidden
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
    </div>
  );
}
