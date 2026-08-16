"use client";

import { useEffect, useState } from "react";
import type { PatientMatch } from "@/lib/registrations";

/**
 * Find-an-existing-patient control on the registration form — the return-visit
 * path for PRD §6.3 (FR-3.1).
 *
 * The front desk asks "have you been here before?" first, so this sits at the
 * top of the form. Searching by name, mobile or the printed Patient ID covers
 * how the answer actually arrives — a card in hand, or a phone number.
 *
 * Nothing here mints or edits a patient: it only offers records that already
 * exist, and hands the chosen one back to the form.
 */

interface PatientLookupProps {
  clinicId: string;
  onSelect: (patient: PatientMatch) => void;
}

const MIN_SEARCH_LENGTH = 2;
/** Long enough to finish typing a phone number, short enough to feel live. */
const DEBOUNCE_MS = 300;

const INPUT_CLASS =
  "block min-h-11 w-full rounded border border-black/20 bg-transparent px-3 text-base outline-none focus:border-black/60 dark:border-white/25 dark:focus:border-white/60";

function formatLastVisit(date: string): string {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function PatientLookup({
  clinicId,
  onSelect,
}: PatientLookupProps) {
  const [term, setTerm] = useState("");
  const [result, setResult] = useState<{
    /** Which clinic + term produced these, so stale ones can be ignored. */
    key: string;
    matches: PatientMatch[];
  } | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = term.trim();
  const key = `${clinicId}|${query}`;

  useEffect(() => {
    if (!clinicId || query.length < MIN_SEARCH_LENGTH) {
      return;
    }

    // Aborted on the next keystroke so a slow early response cannot land after
    // a faster later one and show results for the wrong term.
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setIsSearching(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/patients?clinicId=${encodeURIComponent(clinicId)}&search=${encodeURIComponent(query)}`,
          { signal: controller.signal },
        );
        const body: { success?: boolean; error?: string; data?: PatientMatch[] } =
          await response.json().catch(() => ({}));

        if (!response.ok || !body.success) {
          setError(body.error ?? "Could not search patients.");
          setResult({ key: `${clinicId}|${query}`, matches: [] });
          return;
        }

        setResult({ key: `${clinicId}|${query}`, matches: body.data ?? [] });
      } catch (fetchError: unknown) {
        if ((fetchError as { name?: string }).name === "AbortError") {
          return;
        }
        setError("Could not reach the server to search patients.");
        setResult({ key: `${clinicId}|${query}`, matches: [] });
      } finally {
        setIsSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [clinicId, query]);

  // Derived rather than cleared in the effect: results from a previous term or
  // a previous clinic simply stop matching the current key and fall away.
  const isCurrent = result?.key === key;
  const matches = isCurrent ? result.matches : [];
  const hasSearched = isCurrent;

  return (
    <div>
      <label htmlFor="patient-lookup" className="mb-1 block text-sm font-medium">
        Returning patient?{" "}
        <span className="font-normal text-black/55 dark:text-white/55">
          Search by name, mobile or Patient ID
        </span>
      </label>
      <input
        id="patient-lookup"
        type="search"
        autoComplete="off"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        disabled={!clinicId}
        placeholder={clinicId ? "" : "Choose a clinic first"}
        className={INPUT_CLASS}
      />

      {error && (
        <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-400">
          {error}
        </p>
      )}

      {isSearching && (
        <p className="mt-2 text-sm text-black/55 dark:text-white/55">
          Searching…
        </p>
      )}

      {!isSearching && matches.length > 0 && (
        <ul className="mt-2 grid gap-2">
          {matches.map((patient) => (
            <li
              key={patient.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded border border-black/15 px-3 py-2 dark:border-white/20"
            >
              <div className="min-w-0">
                <p className="font-medium">{patient.name}</p>
                <p className="text-sm tabular-nums text-black/55 dark:text-white/55">
                  {patient.patientCode} · {patient.mobileNumber}
                </p>
                <p className="text-sm text-black/55 dark:text-white/55">
                  {patient.visitCount === 1
                    ? "1 visit"
                    : `${patient.visitCount} visits`}
                  {patient.lastVisitDate
                    ? ` · last on ${formatLastVisit(patient.lastVisitDate)}`
                    : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onSelect(patient)}
                className="min-h-11 shrink-0 rounded border border-black/20 px-4 text-sm font-medium dark:border-white/25"
              >
                Use this patient
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Not shown alongside an error: a failed search is not a "no match". */}
      {!isSearching && !error && hasSearched && matches.length === 0 && (
        <p className="mt-2 text-sm text-black/55 dark:text-white/55">
          No match — fill the details below to register them as a new patient.
        </p>
      )}
    </div>
  );
}
