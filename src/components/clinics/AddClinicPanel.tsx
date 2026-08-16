"use client";

import { useState, type ReactNode } from "react";
import ClinicForm from "@/components/clinics/ClinicForm";
import Button from "@/components/ui/Button";
import PageHeader from "@/components/ui/PageHeader";
import Panel from "@/components/ui/Panel";

/**
 * The "Add Clinic" control on the clinic list — PRD §6.2 (FR-2.1).
 *
 * Collapsed by default so the list itself stays the focus of the page. It owns
 * the page header too, because the button belongs beside the title while the
 * form it opens needs the full column width below it.
 *
 * The button is the `commit` variant: it carries the selected clinic's colour,
 * which on this page is a standing reminder of which clinic the switcher is
 * pointed at while you add another one.
 */

interface AddClinicPanelProps {
  /** The page's meta line, rendered under the title. */
  meta: ReactNode;
}

export default function AddClinicPanel({ meta }: AddClinicPanelProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <PageHeader
        title="Clinics"
        meta={meta}
        actions={
          !isOpen && (
            <Button variant="commit" onClick={() => setIsOpen(true)}>
              Add Clinic
            </Button>
          )
        }
      />

      {isOpen && (
        <Panel
          title="Add a clinic"
          description="Doctors, patients and revenue are all recorded against a clinic, so this comes first."
          className="mb-5"
        >
          <ClinicForm onCancel={() => setIsOpen(false)} />
        </Panel>
      )}
    </>
  );
}
