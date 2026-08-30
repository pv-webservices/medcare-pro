"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Panel from "@/components/ui/Panel";
import StatusPill from "@/components/ui/StatusPill";
import Table, { TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import AppointmentTypeForm, {
  type ClinicOption,
} from "@/components/appointments/AppointmentTypeForm";
import {
  formatDuration,
  scopeLabel,
  serviceStatus,
} from "@/components/appointments/appointmentTypeView";
import { formatRupees } from "@/lib/money";

/**
 * The price list — AP-7.
 *
 * NOTHING HERE DELETES. Appointments point at a service under a Restrict
 * foreign key, so the only way to stop one being booked is to retire it, and
 * the bookings already made stay readable for ever. There is deliberately no
 * DELETE on the API either; retiring is a PATCH of `isActive`, which the audit
 * trail records as its own action rather than folding into a generic update.
 *
 * PER-ROW PERMISSION, NOT PER-PAGE. `canManage` arrives on each row because a
 * tenant-wide service needs the permission tenant-wide, while a clinic's
 * service needs it only at that clinic — so an admin scoped to one site sees
 * their own rows live and the shared ones read-only, on the same screen. The
 * server re-checks each row's scope regardless; this only stops the page
 * offering a button that would be refused.
 */

export interface ServiceRow {
  id: string;
  clinicId: string | null;
  clinicName: string | null;
  name: string;
  durationMinutes: number;
  /** 2-decimal string, straight from the Decimal(10,2) column. */
  defaultAmount: string;
  isActive: boolean;
  /** Whether THIS actor may change THIS row, resolved against its own scope. */
  canManage: boolean;
}

interface AppointmentTypesTableProps {
  services: readonly ServiceRow[];
  clinics: readonly ClinicOption[];
  canScopeTenantWide: boolean;
  /** Retired services are on screen — changes the empty state's wording. */
  showsRetired: boolean;
}

export default function AppointmentTypesTable({
  services,
  clinics,
  canScopeTenantWide,
  showsRetired,
}: AppointmentTypesTableProps) {
  const router = useRouter();
  const showToast = useToast();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const editing = services.find((service) => service.id === editingId) ?? null;

  // Someone who can change nothing gets no actions column at all. Repeating
  // "View only" down every row of a price list the front desk is simply
  // reading tells them nothing they cannot already see.
  const canManageAny = services.some((service) => service.canManage);

  async function toggleRetired(service: ServiceRow) {
    setPendingId(service.id);
    try {
      const response = await fetch(`/api/appointment-types/${service.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !service.isActive }),
      });

      const body: { success?: boolean; error?: string } = await response
        .json()
        .catch(() => ({}));

      if (!response.ok || !body.success) {
        showToast({
          tone: "alert",
          title: "Could not change this service.",
          detail: body.error ?? "Try again.",
        });
        return;
      }

      showToast({
        tone: "ok",
        title: service.isActive ? "Service retired." : "Service restored.",
        detail: service.isActive
          ? "It can no longer be booked. Appointments already booked are unaffected."
          : "It can be booked again.",
      });

      router.refresh();
    } catch {
      showToast({
        tone: "alert",
        title: "Could not reach the server.",
        detail: "Check your connection and try again.",
      });
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {editing && (
        <Panel
          title={`Edit ${editing.name}`}
          description="Re-pricing a service never changes an appointment already booked — those keep the price they were quoted."
          className="max-w-3xl"
        >
          <AppointmentTypeForm
            clinics={clinics}
            canScopeTenantWide={canScopeTenantWide}
            initial={{
              id: editing.id,
              clinicId: editing.clinicId ?? "",
              name: editing.name,
              durationMinutes: String(editing.durationMinutes),
              defaultAmount: editing.defaultAmount,
            }}
            onDone={() => setEditingId(null)}
            onCancel={() => setEditingId(null)}
          />
        </Panel>
      )}

      {/* Services card */}
      <section className="rounded-3xl border border-line bg-canvas p-6 sm:p-7 shadow-card">
        <div className="mb-6">
          <h2 className="text-lg font-bold tracking-tight text-ink">
            {showsRetired ? "All services" : "Bookable services"}
          </h2>
          <p className="mt-1 text-label text-muted">
            Active appointment types, pricing and where each service can be booked.
          </p>
        </div>

        {services.length === 0 ? (
          <EmptyState
            isBare
            title={showsRetired ? "No services yet" : "No bookable services yet"}
            guidance={
              showsRetired
                ? "Add a service — its length and its price — and it becomes bookable straight away."
                : "Add one, or show retired services if you are looking for something you have already stopped offering."
            }
          />
        ) : (
          <>
            {/* Desktop */}
            <Table
              caption="Bookable services, their length and their price"
              className="hidden md:block shadow-none"
            >
              <THead>
                <TH>Service</TH>
                <TH>Offered at</TH>
                <TH>Length</TH>
                <TH align="end">Price</TH>
                <TH>Status</TH>
                {canManageAny && <TH align="end">Action</TH>}
              </THead>
              <TBody>
                {services.map((service) => {
                  const status = serviceStatus(service.isActive);

                  return (
                    <TR key={service.id} isCurrent={service.id === editingId}>
                      <TD className="py-4">
                        <span className="font-semibold text-ink">
                          {service.name}
                        </span>
                      </TD>
                      <TD className="py-4 text-ink-soft">
                        {scopeLabel(service.clinicName)}
                      </TD>
                      <TD className="py-4 font-medium text-ink-soft">
                        {formatDuration(service.durationMinutes)}
                      </TD>
                      <TD align="end" className="py-4 tnum font-semibold text-ink">
                        {formatRupees(service.defaultAmount)}
                      </TD>
                      <TD className="py-4">
                        <StatusPill tone={status.tone}>{status.label}</StatusPill>
                      </TD>
                      {canManageAny && (
                        <TD align="end" className="py-4">
                          <RowActions
                            service={service}
                            isEditing={service.id === editingId}
                            isPending={pendingId === service.id}
                            onEdit={() =>
                              setEditingId(
                                service.id === editingId ? null : service.id,
                              )
                            }
                            onToggle={() => toggleRetired(service)}
                          />
                        </TD>
                      )}
                    </TR>
                  );
                })}
              </TBody>
            </Table>

            {/* Below tablet: stacked cards */}
            <div className="space-y-3 md:hidden">
              {services.map((service) => {
                const status = serviceStatus(service.isActive);

                return (
                  <div
                    key={service.id}
                    className="rounded-2xl border border-line bg-canvas p-4 sm:p-5 shadow-sm space-y-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-ink">{service.name}</p>
                        <p className="mt-0.5 text-label text-muted">
                          {scopeLabel(service.clinicName)}
                        </p>
                      </div>
                      <StatusPill tone={status.tone}>{status.label}</StatusPill>
                    </div>

                    <div className="flex items-center justify-between border-t border-line/60 pt-3 text-body text-muted">
                      <div>
                        <span className="text-micro font-semibold uppercase text-muted block mb-0.5">Length</span>
                        <span className="font-medium text-ink">
                          {formatDuration(service.durationMinutes)}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-micro font-semibold uppercase text-muted block mb-0.5">Price</span>
                        <span className="tnum font-semibold text-ink">
                          {formatRupees(service.defaultAmount)}
                        </span>
                      </div>
                    </div>

                    {canManageAny && (
                      <div className="border-t border-line/60 pt-3 flex items-center justify-end">
                        <RowActions
                          service={service}
                          isEditing={service.id === editingId}
                          isPending={pendingId === service.id}
                          onEdit={() =>
                            setEditingId(service.id === editingId ? null : service.id)
                          }
                          onToggle={() => toggleRetired(service)}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

interface RowActionsProps {
  service: ServiceRow;
  isEditing: boolean;
  isPending: boolean;
  onEdit: () => void;
  onToggle: () => void;
}

function RowActions({
  service,
  isEditing,
  isPending,
  onEdit,
  onToggle,
}: RowActionsProps) {
  if (!service.canManage) {
    // Said rather than left blank: a clinic-scoped admin looking at a shared
    // service should learn why there is no button, not wonder where it went.
    return (
      <span className="text-label text-faint">
        {service.clinicId === null
          ? "Shared — account admin only"
          : "View only"}
      </span>
    );
  }

  return (
    <div className="inline-flex items-center justify-end gap-2">
      <Button
        variant="secondary"
        size="sm"
        onClick={onEdit}
        disabled={isPending}
        className="rounded-xl px-3.5 py-1.5 font-medium shadow-none"
      >
        {isEditing ? "Close" : "Edit"}
      </Button>
      <Button
        variant={service.isActive ? "danger" : "secondary"}
        size="sm"
        onClick={onToggle}
        isBusy={isPending}
        busyLabel={service.isActive ? "Retiring…" : "Restoring…"}
        className="rounded-xl px-3.5 py-1.5 font-medium shadow-none"
      >
        {service.isActive ? "Retire" : "Restore"}
      </Button>
    </div>
  );
}
