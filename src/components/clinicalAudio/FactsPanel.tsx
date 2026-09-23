"use client";
import { useCallback, useEffect, useState } from "react";

type Evidence = { segmentId: string; speakerType: string; quote: string };
type Fact = {
  id: string;
  category: string;
  assertion: string;
  subject: string;
  statement: string;
  attributes: Record<string, string>;
  evidence: Evidence[];
  decision: "ACCEPTED" | "DISMISSED" | null;
  conflicting: boolean;
};
type Listing = {
  canExtract: boolean;
  run: { id: string; status: string; failure: string | null; rejectedCount: number; stale: boolean } | null;
  facts: Fact[];
};

const ACTIVE = new Set(["QUEUED", "PROCESSING"]);
const button = "min-h-11 rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-40";
const label = (value: string) => value.toLowerCase().replaceAll("_", " ");

async function factsRequest<T>(url: string, body?: unknown): Promise<{ status: number; data?: T; error?: string }> {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  return response.ok && payload.success
    ? { status: response.status, data: payload.data as T }
    : { status: response.status, error: payload.error || "Clinical fact extraction is temporarily unavailable." };
}

/**
 * AI-3 candidate facts for a reviewed transcript. Every fact needs an explicit
 * doctor decision; there is deliberately no "accept all". Nothing here writes
 * to consultation notes or the prescription.
 */
export default function FactsPanel({
  transcriptId,
  transcriptVersion,
  segmentStartMs,
  onSeek,
}: {
  transcriptId: string;
  transcriptVersion: number;
  segmentStartMs: Record<string, number>;
  onSeek: (milliseconds: number) => Promise<void>;
}) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const url = `/api/clinical-ai/transcripts/${transcriptId}/facts`;

  const apply = useCallback((result: Awaited<ReturnType<typeof factsRequest<Listing>>>) => {
    // 403/404: not enabled, not permitted or not visible here; stay silent.
    if (result.status === 403 || result.status === 404) return setHidden(true);
    if (result.error) return setError(result.error);
    setHidden(false);
    setListing(result.data!);
  }, []);
  const load = useCallback(async () => apply(await factsRequest<Listing>(url)), [apply, url]);

  // Reload whenever the transcript changes (corrections make facts stale).
  useEffect(() => {
    let live = true;
    void factsRequest<Listing>(url).then((result) => {
      if (live) apply(result);
    });
    return () => {
      live = false;
    };
  }, [apply, url, transcriptVersion]);
  useEffect(() => {
    if (!listing?.run || !ACTIVE.has(listing.run.status)) return;
    const timer = setInterval(() => void load(), 7500);
    return () => clearInterval(timer);
  }, [listing?.run, load]);

  async function act(target: string, body: unknown) {
    setBusy(true);
    setError("");
    const result = await factsRequest(target, body);
    if (result.error) setError(result.error);
    await load();
    setBusy(false);
  }

  if (hidden) return null;
  const run = listing?.run;
  const extractable = listing?.canExtract && (!run || run.stale || run.status === "FAILED");
  return (
    <section aria-label="Extracted clinical facts" className="mt-4 min-w-0 space-y-3 border-t border-line pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold">Clinical facts (AI-suggested)</h4>
        {run && <span role="status" className="text-sm text-muted">{label(run.status)}</span>}
      </div>
      <p className="text-sm text-muted">
        Suggested from the reviewed transcript. Each fact shows the words it came from. Accept only what you confirm; accepted facts are not added to notes or the prescription.
      </p>
      {listing && !listing.canExtract && !run && <p className="text-sm">Review the transcript above to extract facts.</p>}
      {run?.stale && (
        <p role="alert" className="break-words">
          The transcript changed after these facts were extracted. They are out of date and cannot be accepted.
        </p>
      )}
      {run?.status === "FAILED" && !run.stale && <p className="text-sm">Fact extraction could not finish ({run.failure}).</p>}
      {run && ACTIVE.has(run.status) && <p className="text-sm text-muted">Extraction continues on the server. You may close this page.</p>}
      {extractable && (
        <button className={button} disabled={busy} onClick={() => void act(url, {})}>
          {run ? "Extract facts again" : "Extract facts"}
        </button>
      )}
      {error && <p role="alert" className="break-words">{error}</p>}
      {run?.status === "COMPLETED" && !run.stale && listing!.facts.length === 0 && (
        <p className="text-sm">No supported facts were found.</p>
      )}
      <ul className="space-y-3">
        {listing?.facts.map((fact) => (
          <li key={fact.id} className="min-w-0 space-y-2 rounded-lg border border-line p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{label(fact.category)}</span>
              <span>· {label(fact.assertion)}</span>
              {fact.subject !== "PATIENT" && <span>· about {label(fact.subject)}</span>}
              {fact.conflicting && <span role="note" className="font-medium">· Conflicts with another fact. Review both.</span>}
            </div>
            <p className="break-words">{fact.statement}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-sm">
              {Object.entries(fact.attributes).map(([name, value]) => (
                <div key={name} className="contents">
                  <dt className="text-muted">{label(name)}</dt>
                  <dd className="break-words">{value}</dd>
                </div>
              ))}
            </dl>
            <ul className="space-y-1">
              {fact.evidence.map((item, index) => (
                <li key={`${item.segmentId}-${index}`} className="flex flex-wrap items-center gap-2 text-sm">
                  <button
                    className={button}
                    onClick={() => void onSeek(segmentStartMs[item.segmentId] ?? 0).catch(() => setError("Audio is unavailable or no longer retained."))}
                  >
                    Listen
                  </button>
                  <q className="break-words">{item.quote}</q>
                  <span className="text-muted">· {label(item.speakerType)}</span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-2">
              {fact.decision && <span role="status" className="text-sm font-medium">{fact.decision === "ACCEPTED" ? "Accepted" : "Dismissed"}</span>}
              <button
                className={button}
                disabled={busy || !!run?.stale || fact.decision === "ACCEPTED"}
                onClick={() => void act(`/api/clinical-ai/facts/${fact.id}/review`, { decision: "ACCEPTED" })}
              >
                Accept
              </button>
              <button
                className={button}
                disabled={busy || !!run?.stale || fact.decision === "DISMISSED"}
                onClick={() => void act(`/api/clinical-ai/facts/${fact.id}/review`, { decision: "DISMISSED" })}
              >
                Dismiss
              </button>
            </div>
          </li>
        ))}
      </ul>
      {run?.status === "COMPLETED" && run.rejectedCount > 0 && (
        <p className="text-xs text-muted">{run.rejectedCount} suggestion(s) were discarded because the transcript did not support them.</p>
      )}
    </section>
  );
}
