"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
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
      <Input
        id="patient-lookup"
        type="search"
        autoComplete="off"
        label="Returning patient?"
        hint={error ? undefined : "Search by name, mobile or Patient ID."}
        error={error ?? undefined}
        icon={<Search className="h-4 w-4 text-muted" aria-hidden="true" />}
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        disabled={!clinicId}
        placeholder={clinicId ? "Search by name, mobile or Patient ID" : "Choose a clinic first"}
      />

      {isSearching && <p className="mt-2 text-label text-muted">Searching…</p>}

      {!isSearching && matches.length > 0 && (
        <ul className="mt-3 grid gap-2">
          {matches.map((patient) => (
            <li key={patient.id}>
              <Card
                isFlush
                className="flex flex-wrap items-center justify-between gap-3 p-3"
              >
                <div className="min-w-0">
                  <p className="font-medium text-ink">{patient.name}</p>
                  <p className="mt-0.5 text-label text-muted">
                    <span className="serial text-ink">{patient.patientCode}</span>
                    <span className="tnum">
                      {"·"}
                      {patient.mobileNumber}
                    </span>
                  </p>
                  <p className="text-label text-muted">
                    {patient.visitCount === 1
                      ? "1 visit"
                      : `${patient.visitCount} visits`}
                    {patient.lastVisitDate
                      ? ` · last on ${formatLastVisit(patient.lastVisitDate)}`
                      : ""}
                  </p>
                </div>

                <Button
                  variant="secondary"
                  className="shrink-0"
                  onClick={() => onSelect(patient)}
                >
                  Use this patient
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {/* Not shown alongside an error: a failed search is not a "no match". */}
      {!isSearching && !error && hasSearched && matches.length === 0 && (
        <p className="mt-2 text-label text-muted">
          No match — fill the details below to register them as a new patient.
        </p>
      )}
    </div>
  );
}
