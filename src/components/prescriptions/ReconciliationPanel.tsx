"use client";
import { useState } from "react";
import Button from "@/components/ui/Button";

type Status = "DISCREPANCY" | "MATCH" | "NOT_COMPARABLE" | "CONFLICTING";
type Check = "MEDICATION" | "STRENGTH" | "FREQUENCY" | "DURATION" | "ALLERGY" | "FOLLOW_UP";
type Result = {
  check: Check;
  status: Status;
  factId: string;
  itemIndex: number | null;
  said: string;
  draft: string | null;
  evidence: { segmentId: string; quote: string; startMs: number | null }[];
};
type Report = { acceptedFacts: number; allergyFacts: number; results: Result[] };
type DraftItem = {
  medicineGenericName: string;
  brandName: string;
  strength: string;
  frequency: string;
  durationValue: number | null;
  durationUnit: string;
};

const clock = (ms: number) => {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

function headline(result: Result): string {
  const draft = result.draft ?? "not stated";
  switch (result.check) {
    case "MEDICATION":
      if (result.status === "DISCREPANCY") return `“${result.said}” was discussed in the consultation but is not on this prescription.`;
      if (result.status === "MATCH") return `“${result.said}” is on the prescription (${draft}).`;
      if (result.status === "CONFLICTING") return `“${result.said}”: accepted facts conflict. Not compared.`;
      return `“${result.said}” could not be compared.`;
    case "ALLERGY":
      if (result.status === "DISCREPANCY") return `Allergy mentioned for “${result.said}”, and “${draft}” is on this prescription.`;
      if (result.status === "CONFLICTING") return `Allergy “${result.said}”: accepted facts conflict. Not compared.`;
      return `Allergy “${result.said}” could not be compared.`;
    case "FOLLOW_UP":
      if (result.status === "DISCREPANCY") return `Follow-up said “${result.said}”; the follow-up instructions state ${draft}.`;
      if (result.status === "MATCH") return `Follow-up “${result.said}” matches the instructions.`;
      if (result.status === "CONFLICTING") return `Follow-up “${result.said}”: accepted facts conflict. Not compared.`;
      return `Follow-up “${result.said}” could not be compared.`;
    default: {
      const noun = result.check.toLowerCase();
      if (result.status === "DISCREPANCY") return `${noun[0].toUpperCase()}${noun.slice(1)} differs: said “${result.said}”, draft ${result.draft ? `“${draft}”` : draft}.`;
      if (result.status === "MATCH") return `${noun[0].toUpperCase()}${noun.slice(1)} matches: “${result.said}”.`;
      return `${noun[0].toUpperCase()}${noun.slice(1)} “${result.said}” could not be compared${result.draft ? ` with “${draft}”` : ""}.`;
    }
  }
}

function ResultRow({ result }: { result: Result }) {
  return (
    <li className="space-y-1 rounded-xl border border-line p-3">
      <p className="break-words [overflow-wrap:anywhere]">{headline(result)}</p>
      <ul className="space-y-1 text-sm text-muted">
        {result.evidence.map((item, index) => (
          <li key={`${item.segmentId}-${index}`} className="break-words [overflow-wrap:anywhere]">
            {item.startMs !== null && <span>At {clock(item.startMs)} · </span>}
            <q>{item.quote}</q>
          </li>
        ))}
      </ul>
    </li>
  );
}

/**
 * AI-4 (PRD §9): compares the unsaved draft with facts the doctor accepted
 * from the transcript. Read-only: there is deliberately no Apply or Fix.
 */
export default function ReconciliationPanel({
  registrationId,
  items,
  followUpInstructions,
}: {
  registrationId: string;
  items: DraftItem[];
  followUpInstructions: string;
}) {
  const [report, setReport] = useState<Report | null>(null);
  const [checkedDraft, setCheckedDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const draft = JSON.stringify({ items, followUpInstructions });
  const outdated = report !== null && checkedDraft !== draft;

  async function check() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/clinical-ai/registrations/${registrationId}/reconciliation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: draft,
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) {
        setError(payload.error || "Checking against the consultation is temporarily unavailable.");
        return;
      }
      setReport(payload.data as Report);
      setCheckedDraft(draft);
    } catch {
      setError("Checking against the consultation is temporarily unavailable.");
    } finally {
      setBusy(false);
    }
  }

  const flagged = report?.results.filter((r) => r.status === "DISCREPANCY" || r.status === "CONFLICTING") ?? [];
  const matches = report?.results.filter((r) => r.status === "MATCH") ?? [];
  const notComparable = report?.results.filter((r) => r.status === "NOT_COMPARABLE") ?? [];

  return (
    <section aria-label="Check against consultation" className="space-y-3 rounded-2xl border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Check against consultation</h2>
        <Button variant="secondary" onClick={() => void check()} disabled={busy}>
          {busy ? "Checking…" : report ? "Check again" : "Check draft"}
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
      {outdated && <p role="status" className="text-muted">The draft changed since this check. Check again.</p>}
      {report && report.acceptedFacts === 0 && (
        <p role="status" className="text-muted">
          No accepted facts from a reviewed transcript for this visit. Accept facts in the transcript panel first.
        </p>
      )}
      {report && report.acceptedFacts > 0 && (
        <>
          {flagged.length ? (
            <ul className="space-y-2" aria-label="Differences">
              {flagged.map((result, index) => (
                <ResultRow key={`${result.factId}-${result.check}-${index}`} result={result} />
              ))}
            </ul>
          ) : (
            <p role="status">No differences found among the facts that could be compared.</p>
          )}
          {matches.length > 0 && (
            <details>
              <summary className="cursor-pointer text-muted">{matches.length} matching</summary>
              <ul className="mt-2 space-y-2">
                {matches.map((result, index) => (
                  <ResultRow key={`${result.factId}-${result.check}-${index}`} result={result} />
                ))}
              </ul>
            </details>
          )}
          {notComparable.length > 0 && (
            <details>
              <summary className="cursor-pointer text-muted">{notComparable.length} could not be compared</summary>
              <ul className="mt-2 space-y-2">
                {notComparable.map((result, index) => (
                  <ResultRow key={`${result.factId}-${result.check}-${index}`} result={result} />
                ))}
              </ul>
            </details>
          )}
          {report.allergyFacts > 0 && (
            <p className="text-sm text-muted">
              Allergies are matched by name only. Drug-class allergies (for example penicillin and amoxicillin) are not checked.
            </p>
          )}
        </>
      )}
      <p className="text-sm text-muted">
        This compares your draft with facts you accepted from the transcript. It is not a safety or interaction check.
      </p>
    </section>
  );
}
