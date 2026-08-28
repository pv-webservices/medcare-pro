"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import DoctorForm, { type ClinicOption } from "@/components/doctors/DoctorForm";
import Button from "@/components/ui/Button";
import Drawer from "@/components/ui/Drawer";

/**
 * The "Add doctor" control on the doctor list — PRD §6.4 (FR-4.2).
 *
 * A DRAWER, NOT AN INLINE PANEL. Adding a doctor is a short, self-contained
 * task done from the list; opening it in place used to push the list itself
 * down the page, so the thing the reader was looking at moved as soon as they
 * reached for the button. The drawer keeps the list where it was and hands
 * focus straight to the form.
 *
 * Not a modal, because the reader often wants to check a name against the list
 * behind it while typing. `DoctorForm` closes it on success through the same
 * `onCancel` callback it already used for its own cancel button — one exit,
 * whichever way the form ends.
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
      <p className="rounded-2xl border border-line bg-canvas-deep px-4 py-2.5 text-body text-muted">
        Add a clinic before adding doctors.
      </p>
    );
  }

  return (
    <>
      <Button variant="primary" onClick={() => setIsOpen(true)}>
        <Plus aria-hidden="true" strokeWidth={2.5} className="h-4 w-4" />
        Add doctor
      </Button>

      <Drawer
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title="Add a doctor"
        description="They will appear on the list and can be given availability straight away."
      >
        <DoctorForm clinics={clinics} onCancel={() => setIsOpen(false)} />
      </Drawer>
    </>
  );
}
