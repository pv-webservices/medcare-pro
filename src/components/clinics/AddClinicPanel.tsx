"use client";

import { useState } from "react";
import ClinicForm from "@/components/clinics/ClinicForm";

/**
 * The "Add Clinic" control on the clinic list — PRD §6.2 (FR-2.1).
 *
 * Collapsed by default so the list itself stays the focus of the page; the form
 * is only in the way once staff actually want it.
 */
export default function AddClinicPanel() {
  const [isOpen, setIsOpen] = useState(false);

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="min-h-11 rounded bg-foreground px-5 text-base font-medium text-background"
      >
        Add Clinic
      </button>
    );
  }

  return (
    <section
      aria-label="Add a clinic"
      className="rounded border border-black/15 p-4 dark:border-white/20"
    >
      <h2 className="mb-4 text-lg font-semibold">Add a clinic</h2>
      <ClinicForm onCancel={() => setIsOpen(false)} />
    </section>
  );
}
