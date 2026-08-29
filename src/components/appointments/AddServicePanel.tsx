"use client";

import { useState } from "react";
import AppointmentTypeForm, {
  type ClinicOption,
} from "@/components/appointments/AppointmentTypeForm";
import { Plus } from "lucide-react";
import Button from "@/components/ui/Button";
import Drawer from "@/components/ui/Drawer";

/**
 * The "Add service" control on the price list — AP-7.
 *
 * A DRAWER, the same shape as AddDoctorPanel. The price list is what the reader
 * came for, and a form standing open above it pushes the row they are checking
 * off the screen. The drawer leaves the list in place and takes focus.
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
      <p className="rounded-2xl border border-line bg-canvas-deep px-5 py-4 text-body text-muted">
        Add a clinic before adding services — every service is offered at one,
        or at all of them.
      </p>
    );
  }

  return (
    <>
      <Button variant="primary" onClick={() => setIsOpen(true)}>
        <Plus aria-hidden="true" strokeWidth={2.5} className="h-4 w-4" />
        Add service
      </Button>

      <Drawer
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title="Add a service"
        description="Define what the desk can book, how long it runs, and the price quoted."
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" form="add-service-form">
              Add service
            </Button>
          </>
        }
      >
        <AppointmentTypeForm
          clinics={clinics}
          canScopeTenantWide={canScopeTenantWide}
          hideActions
          onDone={() => setIsOpen(false)}
        />
      </Drawer>
    </>
  );
}
