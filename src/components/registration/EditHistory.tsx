import { formatRupees } from "@/lib/money";
import type { EditLogEntry } from "@/lib/registrations";
import { History } from "lucide-react";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import { cx } from "@/components/ui/cx";

/**
 * The registration edit trail — PRD §6.3 (FR-3.6).
 *
 * Newest first, because the question staff bring here is almost always "who
 * changed this just now?". Each entry answers who, in what role, when, and what
 * moved from what to what — the four things the PRD asks the log to record.
 *
 * This is a read-only view of an append-only table (PRD §9): there is no
 * control here to edit or remove an entry, and no endpoint behind one either.
 */

interface EditHistoryProps {
  entries: readonly EditLogEntry[];
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Blank() {
  return <span className="text-faint">not set</span>;
}

/**
 * The log stores raw values, which is right — it is a record of what the field
 * held, not of how a screen once formatted it. Money is given its symbol back
 * here, at the point of display.
 */
function Value({ field, value }: { field: string; value: string | null }) {
  if (value === null) {
    return <Blank />;
  }

  return <>{field === "amount" ? formatRupees(value) : value}</>;
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

  /*
    A TIMELINE, NOT A LIST OF CARDS. Each entry is a point on one vertical rule,
    which is what makes "this happened, then this" readable at a glance — and
    what stops twelve stacked cards reading as twelve unrelated records. The
    rule is decorative; the ordered list underneath it is what a screen reader
    follows.
  */
  return (
    <ol className="relative space-y-3 pl-7">
      <span
        aria-hidden="true"
        className="absolute bottom-2 left-[9px] top-2 w-px bg-line"
      />
      {entries.map((entry) => (
        <li key={entry.id} className="relative">
          <span
            aria-hidden="true"
            className={cx(
              "absolute -left-7 top-5 flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-canvas",
              entry.isCreation ? "bg-accent" : "bg-line-strong",
            )}
          />
          <Card>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-body font-medium text-ink">
                {entry.editedByName ?? entry.editedByEmail}{""}
                <span className="font-normal text-muted">
                  {/* The role held at the time, not the one they hold today. */}
                  as {entry.roleAtTime}
                </span>
              </p>
              <p className="tnum text-meta text-muted">
                {formatTimestamp(entry.timestamp)}
              </p>
            </div>

            <p className="mt-0.5 text-label text-muted">
              {entry.isCreation ? "Registered the patient" : "Edited the registration"}
            </p>

            <ul className="mt-3 grid gap-1.5 border-t border-line pt-3">
              {entry.changes.map((change) => (
                <li key={change.field} className="text-body text-ink">
                  <span className="font-medium text-ink">{change.label}:</span>{""}
                  {entry.isCreation ? (
                    <span>
                      <Value field={change.field} value={change.to} />
                    </span>
                  ) : (
                    <>
                      <span className="text-muted line-through">
                        <Value field={change.field} value={change.from} />
                      </span>{""}
                      <span aria-hidden="true" className="text-faint mx-1">→</span>{""}
                      <span className="font-medium text-ink">
                        <Value field={change.field} value={change.to} />
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </li>
      ))}
    </ol>
  );
}
