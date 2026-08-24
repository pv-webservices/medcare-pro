import { formatRupees } from "@/lib/money";
import type { EditLogEntry } from "@/lib/registrations";
import Card from "@/components/ui/Card";

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
      <div className="rounded-3xl bg-canvas px-6 py-12 text-center shadow-neu-raised-sm">
        <p className="mb-1 text-lg font-bold text-ink">No history recorded</p>
        <p className="text-sm text-muted">
          This registration has not been edited since it was created.
        </p>
      </div>
    );
  }

  return (
    <ol className="grid gap-3">
      {entries.map((entry) => (
        <li key={entry.id}>
          <Card isFlush={false}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-semibold text-ink">
                {entry.editedByName ?? entry.editedByEmail}{""}
                <span className="font-normal text-muted">
                  {/* The role held at the time, not the one they hold today. */}
                  as {entry.roleAtTime}
                </span>
              </p>
              <p className="text-sm tabular-nums text-muted">
                {formatTimestamp(entry.timestamp)}
              </p>
            </div>

            <p className="mt-1 text-sm text-muted">
              {entry.isCreation ? "Registered the patient" : "Edited the registration"}
            </p>

            <ul className="mt-3 grid gap-1.5">
              {entry.changes.map((change) => (
                <li key={change.field} className="text-sm text-ink">
                  <span className="font-medium text-ink">{change.label}:</span>{""}
                  {entry.isCreation ? (
                    <span>
                      <Value field={change.field} value={change.to} />
                    </span>
                  ) : (
                    <>
                      <span className="line-through decoration-slate-300 text-muted">
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
