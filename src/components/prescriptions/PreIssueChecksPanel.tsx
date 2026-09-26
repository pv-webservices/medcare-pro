"use client";
import { useEffect, useState } from "react";

type Check = {
  code: string;
  tier: "REVIEW_REQUIRED" | "CONSIDER";
  items: number[];
  message: string;
};
type Result = { rulesVersion: string; checks: Check[]; skipped: string[] };
export type ChecksSummary = { reviewRequired: number; total: number } | null;

const SKIPPED: Record<string, string> = {
  "PC-07": "accepted allergies",
  "PC-08": "consultation recordings",
};
const CHECKED = [
  "duplicate medicines",
  "dosage form against route",
  "strength recorded with a unit",
  "tablet/capsule quantity against the course",
  "'As needed' instructions",
  "follow-up instructions",
  "accepted allergies (name match only)",
  "consultation recordings reviewed",
];

/**
 * AI-5 (PRD §9): checks of the SAVED draft revision shown before issuing.
 * Every item is a prompt to look again; issuing is never blocked here, and
 * an empty list is deliberately not described as safe or compliant.
 */
export default function PreIssueChecksPanel({
  prescriptionId,
  revision,
  onLoaded,
}: {
  prescriptionId: string;
  revision: number;
  onLoaded: (summary: ChecksSummary) => void;
}) {
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    void fetch(
      `/api/prescriptions/${prescriptionId}/pre-issue-checks?expectedRevision=${revision}`,
      { cache: "no-store" },
    )
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok || !body.success) throw new Error("unavailable");
        return body.data as Result;
      })
      .then((data) => {
        if (!live) return;
        setResult(data);
        onLoaded({
          reviewRequired: data.checks.filter((c) => c.tier === "REVIEW_REQUIRED").length,
          total: data.checks.length,
        });
      })
      .catch(() => {
        if (!live) return;
        setError(true);
        onLoaded(null);
      });
    return () => {
      live = false;
    };
  }, [prescriptionId, revision, onLoaded]);

  if (error)
    return (
      <p role="status" className="rounded-xl border border-line bg-canvas p-4 text-sm">
        Pre-issue checks are unavailable right now. They run again when you issue.
      </p>
    );
  if (!result)
    return (
      <p role="status" className="text-sm text-muted">
        Running pre-issue checks…
      </p>
    );
  const required = result.checks.filter((c) => c.tier === "REVIEW_REQUIRED");
  const consider = result.checks.filter((c) => c.tier === "CONSIDER");
  const skipped = result.skipped.map((code) => SKIPPED[code]).filter(Boolean);
  return (
    <section
      aria-label="Before you issue"
      className="space-y-3 rounded-2xl border border-line bg-canvas p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Before you issue</h2>
        <p role="status" className="text-sm font-medium">
          {result.checks.length
            ? `${result.checks.length} thing${result.checks.length === 1 ? "" : "s"} to check`
            : "No issues found by these checks"}
        </p>
      </div>
      {required.length > 0 && (
        <div className="space-y-2 rounded-xl border border-warn-line bg-warn-bg p-4 text-warn-ink">
          <h3 className="font-semibold">Review required</h3>
          <ul className="list-disc space-y-1 pl-5">
            {required.map((check, index) => (
              <li key={`${check.code}-${index}`} className="break-words [overflow-wrap:anywhere]">
                {check.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {consider.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-medium">Consider</h3>
          <ul className="list-disc space-y-1 pl-5">
            {consider.map((check, index) => (
              <li key={`${check.code}-${index}`} className="break-words [overflow-wrap:anywhere]">
                {check.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      <details className="text-sm text-muted">
        <summary className="cursor-pointer">What was checked</summary>
        <p className="mt-2">
          {CHECKED.join(" · ")}. These are consistency checks of this draft, not
          a clinical safety or compliance review. Doses, interactions and drug
          classes are not checked.
        </p>
        {skipped.length > 0 && <p className="mt-1">Not available for this visit: {skipped.join(", ")}.</p>}
        <p className="mt-1">Rules {result.rulesVersion}</p>
      </details>
    </section>
  );
}
