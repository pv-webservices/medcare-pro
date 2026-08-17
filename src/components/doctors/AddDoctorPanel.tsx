"use client";

import { useState } from "react";
import DoctorForm, { type ClinicOption } from "@/components/doctors/DoctorForm";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";

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
      <p className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm font-medium text-slate-500">
        Add a clinic before adding doctors — every doctor belongs to one.
      </p>
    );
  }

  if (!isOpen) {
    return (
      <div className="flex mb-6">
        <Button variant="commit" onClick={() => setIsOpen(true)}>
          Add Doctor
        </Button>
      </div>
    );
  }

  return (
    <div className="mb-6">
      <Panel title="Add a doctor" className="max-w-2xl">
        <DoctorForm clinics={clinics} onCancel={() => setIsOpen(false)} />
      </Panel>
    </div>
  );
}
