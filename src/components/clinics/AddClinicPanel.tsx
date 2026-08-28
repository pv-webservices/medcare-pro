"use client";

import { useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import ClinicForm from "@/components/clinics/ClinicForm";
import Button from "@/components/ui/Button";
import Drawer from "@/components/ui/Drawer";
import PageHeader from "@/components/ui/PageHeader";

/**
 * The "Add clinic" control on the clinic list — PRD §6.2 (FR-2.1).
 *
 * A DRAWER, matching the doctor and service equivalents. Opening the form in
 * place used to push the list down the page, so the rows the reader was
 * checking moved the moment they reached for the button.
 *
 * It owns the page header as well, because the button belongs beside the title
 * and the header needs to know whether the form is open.
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
        description="Every clinic in this account, with its doctors and patients."
        meta={meta}
        actions={
          <Button variant="primary" onClick={() => setIsOpen(true)}>
            <Plus aria-hidden="true" strokeWidth={2.5} className="h-4 w-4" />
            Add clinic
          </Button>
        }
      />

      <Drawer
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title="Add a clinic"
        description="Doctors, patients and revenue are all recorded against a clinic, so this comes first."
      >
        <ClinicForm onCancel={() => setIsOpen(false)} />
      </Drawer>
    </>
  );
}
