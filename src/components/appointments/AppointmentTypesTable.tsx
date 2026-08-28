"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
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

  if (services.length === 0) {
    return (
      <EmptyState
        title={showsRetired ? "No services yet" : "No bookable services yet"}
        guidance={
          showsRetired
            ? "Add a service — its length and its price — and it becomes bookable straight away."
            : "Add one, or show retired services if you are looking for something you have already stopped offering."
        }
      />
    );
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

      {/* Desktop */}
      <Table
        caption="Bookable services, their length and their price"
        className="hidden md:block"
      >
        <THead>
          <TH>Service</TH>
          <TH>Offered at</TH>
          <TH align="end">Length</TH>
          <TH align="end">Price</TH>
          <TH>Status</TH>
          {canManageAny && (
            <TH>
              <span className="sr-only">Actions</span>
            </TH>
          )}
        </THead>
        <TBody>
          {services.map((service) => {
            const status = serviceStatus(service.isActive);

            return (
              <TR key={service.id} isCurrent={service.id === editingId}>
                {/* No `hasRail`: that bar is the clinic-identity marker the
                    clinic list uses, and a service row is not a clinic — a
                    tenant-wide one belongs to all of them. */}
                <TD>
                  <span className="font-semibold text-ink">
                    {service.name}
                  </span>
                </TD>
                <TD>{scopeLabel(service.clinicName)}</TD>
                <TD isNumeric>{formatDuration(service.durationMinutes)}</TD>
                <TD isNumeric>{formatRupees(service.defaultAmount)}</TD>
                <TD>
                  <StatusPill tone={status.tone}>{status.label}</StatusPill>
                </TD>
                {canManageAny && (
                  <TD align="end">
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

      {/* Below tablet: the same fields, stacked. */}
      <div className="space-y-3 md:hidden">
        {services.map((service) => {
          const status = serviceStatus(service.isActive);

          return (
            <Card key={service.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{service.name}</p>
                  <p className="mt-0.5 text-label text-muted">
                    {scopeLabel(service.clinicName)}
                  </p>
                </div>
                <StatusPill tone={status.tone}>{status.label}</StatusPill>
              </div>

              <p className="mt-3 text-body text-muted">
                <span className="tnum font-semibold text-ink">
                  {formatDuration(service.durationMinutes)}
                </span>{""}
                ·{""}
                <span className="tnum font-semibold text-ink">
                  {formatRupees(service.defaultAmount)}
                </span>
              </p>

              {canManageAny && (
                <div className="mt-4">
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
            </Card>
          );
        })}
      </div>
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
    <div className="flex flex-wrap justify-end gap-2">
      <Button
        variant="secondary"
        size="sm"
        onClick={onEdit}
        disabled={isPending}
      >
        {isEditing ? "Close" : "Edit"}
      </Button>
      <Button
        variant={service.isActive ? "danger" : "secondary"}
        size="sm"
        onClick={onToggle}
        isBusy={isPending}
        busyLabel={service.isActive ? "Retiring…" : "Restoring…"}
      >
        {service.isActive ? "Retire" : "Restore"}
      </Button>
    </div>
  );
}
