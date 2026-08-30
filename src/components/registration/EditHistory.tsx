import {
  Building2,
  Calendar,
  History,
  Home,
  IndianRupee,
  MapPin,
  Phone,
  Stethoscope,
  User,
  UserCheck,
  Users,
} from "lucide-react";
import { formatRupees } from "@/lib/money";
import type { EditLogEntry } from "@/lib/registrations";
import type { RenderedChange } from "@/lib/registrationAudit";
import EmptyState from "@/components/ui/EmptyState";

/**
 * The registration edit trail — PRD §6.3 (FR-3.6).
 *
 * Newest first, because the question staff bring here is almost always "who
 * changed this just now?". Each entry answers who, in what role, when, and what
 * moved from what to what.
 *
 * This is a read-only view of an append-only table (PRD §9).
 */

interface EditHistoryProps {
  entries: readonly EditLogEntry[];
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const dateStr = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timeStr = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${dateStr}, ${timeStr}`;
}

function getInitials(name: string | null, email: string): string {
  if (name && name.trim().length > 0) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

function Blank() {
  return <span className="text-muted/60">not set</span>;
}

function Value({ field, value }: { field: string; value: string | null }) {
  if (value === null || value === "") {
    return <Blank />;
  }

  return <>{field === "amount" ? formatRupees(value) : value}</>;
}

function getFieldIcon(field: string) {
  switch (field) {
    case "patientName":
      return <User className="h-4 w-4 text-muted shrink-0" aria-hidden="true" />;
    case "age":
      return <Calendar className="h-4 w-4 text-muted shrink-0" aria-hidden="true" />;
    case "gender":
      return <Users className="h-4 w-4 text-muted shrink-0" aria-hidden="true" />;
    case "mobileNumber":
      return <Phone className="h-4 w-4 text-muted shrink-0" aria-hidden="true" />;
    case "city":
      return <MapPin className="h-4 w-4 text-muted shrink-0" aria-hidden="true" />;
    case "address":
      return <Home className="h-4 w-4 text-muted shrink-0" aria-hidden="true" />;
    case "doctor":
      return <Stethoscope className="h-4 w-4 text-muted shrink-0" aria-hidden="true" />;
    case "department":
      return <Building2 className="h-4 w-4 text-muted shrink-0" aria-hidden="true" />;
    case "amount":
      return <IndianRupee className="h-4 w-4 text-muted shrink-0" aria-hidden="true" />;
    case "visitType":
      return <UserCheck className="h-4 w-4 text-muted shrink-0" aria-hidden="true" />;
    case "visitAt":
      return <Calendar className="h-4 w-4 text-muted shrink-0" aria-hidden="true" />;
    default:
      return <History className="h-4 w-4 text-muted shrink-0" aria-hidden="true" />;
  }
}

const LEFT_COLUMN_FIELDS = new Set([
  "patientName",
  "age",
  "gender",
  "mobileNumber",
  "city",
  "address",
]);

function FieldRow({ change, isCreation }: { change: RenderedChange; isCreation: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-line/40 last:border-0">
      <div className="flex items-center gap-2.5 text-label font-medium text-muted">
        {getFieldIcon(change.field)}
        <span>{change.label}</span>
      </div>

      <div className="text-right text-label">
        {isCreation ? (
          <span className="font-semibold text-ink">
            <Value field={change.field} value={change.to} />
          </span>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-muted line-through">
              <Value field={change.field} value={change.from} />
            </span>
            <span aria-hidden="true" className="text-muted/60">→</span>
            <span className="font-semibold text-ink">
              <Value field={change.field} value={change.to} />
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function EditHistory({ entries }: EditHistoryProps) {
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<History className="h-5 w-5" strokeWidth={2} />}
        title="No history recorded"
        guidance="This registration has not been edited since it was created."
      />
    );
  }

  return (
    <div className="relative pl-7 sm:pl-8 space-y-6">
      {/* Continuous vertical timeline rail */}
      <div
        aria-hidden="true"
        className="absolute bottom-6 left-[11px] top-6 w-0.5 bg-accent/20"
      />

      {entries.map((entry) => {
        const initials = getInitials(entry.editedByName, entry.editedByEmail);

        // Partition changes into left and right columns for creation / multi-field view
        const leftChanges = entry.changes.filter((c) => LEFT_COLUMN_FIELDS.has(c.field));
        const rightChanges = entry.changes.filter((c) => !LEFT_COLUMN_FIELDS.has(c.field));

        // If it's a regular edit with few changes, split them evenly if not categorized
        const isTwoColumn = entry.isCreation || entry.changes.length > 2;

        return (
          <div key={entry.id} className="relative">
            {/* Timeline node */}
            <div
              aria-hidden="true"
              className="absolute -left-7 sm:-left-8 top-6 flex h-6 w-6 items-center justify-center rounded-full bg-canvas ring-4 ring-canvas"
            >
              <span className="h-3 w-3 rounded-full bg-accent" />
            </div>

            {/* Event Card */}
            <div className="rounded-3xl border border-line bg-canvas p-6 sm:p-7 shadow-card space-y-5">
              {/* Header: Actor info & Timestamp */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#EEF2FF] text-[#4F46E5] font-bold text-label">
                    {initials}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-ink text-body">
                        {entry.editedByName ?? entry.editedByEmail}
                      </span>
                      <span className="rounded-lg bg-[#EEF2FF] px-2 py-0.5 text-micro font-semibold text-[#4F46E5]">
                        {entry.roleAtTime}
                      </span>
                    </div>
                    <p className="text-label text-muted mt-0.5">
                      {entry.isCreation ? "Registered the patient" : "Edited the registration"}
                    </p>
                  </div>
                </div>

                <p className="text-label text-muted font-normal">
                  {formatTimestamp(entry.timestamp)}
                </p>
              </div>

              {/* Recorded Fields */}
              {isTwoColumn ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-1 pt-4 border-t border-line/60">
                  <div>
                    {leftChanges.map((change) => (
                      <FieldRow
                        key={change.field}
                        change={change}
                        isCreation={entry.isCreation}
                      />
                    ))}
                  </div>

                  <div>
                    {rightChanges.map((change) => (
                      <FieldRow
                        key={change.field}
                        change={change}
                        isCreation={entry.isCreation}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="pt-4 border-t border-line/60">
                  {entry.changes.map((change) => (
                    <FieldRow
                      key={change.field}
                      change={change}
                      isCreation={entry.isCreation}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
