"use client";

import { Check } from "lucide-react";
import type { PatientMatch } from "@/lib/registrations";
import StatusPill from "@/components/ui/StatusPill";
import { cx } from "@/components/ui/cx";

interface PatientMatchListProps {
  matches: readonly PatientMatch[];
  selectedIds: ReadonlySet<string>;
  /** Patients who already received the chosen template today. */
  sentTodayIds: ReadonlySet<string>;
  maxRecipients: number;
  onToggle: (patient: PatientMatch) => void;
  onSelectAvailable: () => void;
  onClearSelection: () => void;
}

/**
 * Every patient the search or visit-date filter found, each with its own
 * checkbox — so any of them can be picked, not only the newest ones.
 *
 * A row that has already received the template today, or that would push the
 * selection past the per-send cap, stays clickable on purpose: the click is
 * what tells the composer to explain why it was not added.
 */
export default function PatientMatchList({
  matches,
  selectedIds,
  sentTodayIds,
  maxRecipients,
  onToggle,
  onSelectAvailable,
  onClearSelection,
}: PatientMatchListProps) {
  const isAtCap = selectedIds.size >= maxRecipients;
  const sentTodayCount = matches.filter((patient) => sentTodayIds.has(patient.id)).length;

  return (
    <div className="mt-2 rounded-2xl border border-line bg-canvas p-2 shadow-card">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2 px-2 py-1">
        <span className="text-micro font-medium text-muted">
          <span className="tnum">{matches.length}</span> patients found
          {sentTodayCount > 0 && (
            <>
              {" · "}
              <span className="tnum">{sentTodayCount}</span> already sent today
            </>
          )}
        </span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onSelectAvailable}
            disabled={isAtCap}
            className="text-micro font-semibold text-accent hover:underline disabled:cursor-not-allowed disabled:text-muted disabled:no-underline"
          >
            {matches.length > maxRecipients
              ? `Select first ${maxRecipients}`
              : "Select all"}
          </button>
          {selectedIds.size > 0 && (
            <button
              type="button"
              onClick={onClearSelection}
              className="text-micro font-semibold text-muted hover:text-ink hover:underline"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <ul className="max-h-72 divide-y divide-line/40 overflow-y-auto">
        {matches.map((patient) => {
          const isSelected = selectedIds.has(patient.id);
          const isSentToday = sentTodayIds.has(patient.id);
          const isBlocked = !isSelected && (isSentToday || isAtCap);

          return (
            <li key={patient.id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={isSelected}
                aria-disabled={isBlocked}
                onClick={() => onToggle(patient)}
                className={cx(
                  "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-body transition-colors",
                  isSelected ? "bg-accent-soft" : "hover:bg-canvas-deep",
                  isBlocked && "opacity-60",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cx(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                    isSelected
                      ? "border-accent bg-accent text-accent-ink"
                      : "border-line-strong bg-canvas",
                  )}
                >
                  {isSelected && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-ink">{patient.name}</span>
                  <span className="serial ml-2 text-label text-muted">
                    {patient.patientCode}
                  </span>
                </span>
                {isSentToday && <StatusPill tone="warn">Sent today</StatusPill>}
                <span className="tnum text-label text-muted">{patient.mobileNumber}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
