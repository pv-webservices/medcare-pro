"use client";

import { useState } from "react";
import DoctorForm, { type ClinicOption } from "@/components/doctors/DoctorForm";

/**
 * The "Add Doctor" control on the doctor list — PRD §6.4 (FR-4.2).
 *
 * Collapsed by default so the list stays the focus of the page.
 */

interface AddDoctorPanelProps {
  clinics: readonly ClinicOption[];
}

export default function AddDoctorPanel({ clinics }: AddDoctorPanelProps) {
  const [isOpen, setIsOpen] = useState(false);

  // A doctor must belong to a clinic (FR-4.2), so with none created there is
  // nothing to add them to. Say so rather than opening a form that cannot save.
  if (clinics.length === 0) {
    return (
      <p className="rounded border border-black/15 px-4 py-3 text-sm text-black/60 dark:border-white/20 dark:text-white/60">
        Add a clinic before adding doctors — every doctor belongs to one.
      </p>
    );
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="min-h-11 rounded bg-foreground px-5 text-base font-medium text-background"
      >
        Add Doctor
      </button>
    );
  }

  return (
    <section
      aria-label="Add a doctor"
      className="rounded border border-black/15 p-4 dark:border-white/20"
    >
      <h2 className="mb-4 text-lg font-semibold">Add a doctor</h2>
      <DoctorForm clinics={clinics} onCancel={() => setIsOpen(false)} />
    </section>
  );
}
