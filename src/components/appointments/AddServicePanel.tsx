"use client";

import { useState } from "react";
import AppointmentTypeForm, {
  type ClinicOption,
} from "@/components/appointments/AppointmentTypeForm";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";

/**
 * The "Add Service" control on the price list — AP-7.
 *
 * Collapsed by default, the same shape as AddDoctorPanel: the list is what the
 * reader came for, and a form standing open above it pushes the thing they are
 * checking off the screen.
 */

interface AddServicePanelProps {
  /** Only the clinics this actor may actually add a service to. */
  clinics: readonly ClinicOption[];
  canScopeTenantWide: boolean;
}

export default function AddServicePanel({
  clinics,
  canScopeTenantWide,
}: AddServicePanelProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Nothing to attach a service to. A tenant-wide service needs no clinic, so
  // this only bites someone who is scoped to clinics and has none.
  if (clinics.length === 0 && !canScopeTenantWide) {
    return (
      <p className="rounded-xl bg-canvas-deep px-5 py-4 text-sm font-medium text-muted">
        Add a clinic before adding services — every service is offered at one,
        or at all of them.
      </p>
    );
  }

  if (!isOpen) {
    return (
      <div className="flex">
        <Button variant="commit" onClick={() => setIsOpen(true)}>
          Add Service
        </Button>
      </div>
    );
  }

  return (
    <Panel
      title="Add a service"
      description="Its length divides the doctor's day into slots, and its price is what the desk quotes at booking."
      className="max-w-3xl"
    >
      <AppointmentTypeForm
        clinics={clinics}
        canScopeTenantWide={canScopeTenantWide}
        onCancel={() => setIsOpen(false)}
      />
    </Panel>
  );
}
