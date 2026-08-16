import { formatRupees } from "@/lib/money";
import type { EditLogEntry } from "@/lib/registrations";

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
  return <span className="text-black/40 dark:text-white/40">not set</span>;
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
      <div className="rounded border border-black/15 px-4 py-8 text-center dark:border-white/20">
        <p className="mb-1 font-medium">No history recorded</p>
        <p className="text-sm text-black/60 dark:text-white/60">
          This registration has not been edited since it was created.
        </p>
      </div>
    );
  }

  return (
    <ol className="grid gap-3">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="rounded border border-black/15 px-4 py-3 dark:border-white/20"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-medium">
              {entry.editedByName ?? entry.editedByEmail}{" "}
              <span className="font-normal text-black/55 dark:text-white/55">
                {/* The role held at the time, not the one they hold today. */}
                as {entry.roleAtTime}
              </span>
            </p>
            <p className="text-sm tabular-nums text-black/55 dark:text-white/55">
              {formatTimestamp(entry.timestamp)}
            </p>
          </div>

          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            {entry.isCreation ? "Registered the patient" : "Edited the registration"}
          </p>

          <ul className="mt-2 grid gap-1">
            {entry.changes.map((change) => (
              <li key={change.field} className="text-sm">
                <span className="font-medium">{change.label}:</span>{" "}
                {entry.isCreation ? (
                  <span>
                    <Value field={change.field} value={change.to} />
                  </span>
                ) : (
                  <>
                    <span className="line-through decoration-black/40 dark:decoration-white/40">
                      <Value field={change.field} value={change.from} />
                    </span>{" "}
                    <span aria-hidden="true">→</span>{" "}
                    <span className="font-medium">
                      <Value field={change.field} value={change.to} />
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
