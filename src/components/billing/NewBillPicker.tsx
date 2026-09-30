"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import StatusPill from "@/components/ui/StatusPill";
import type { NewBillCandidate } from "@/lib/billing/newBill";
import { NEW_BILL_STATUS_LABELS, NEW_BILL_STATUS_TONES } from "@/lib/billing/billingLabels";

const visitDay = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", { dateStyle: "medium" });

/** "+ New bill": find a recent visit by patient name, mobile or code, then open its bill. */
export default function NewBillPicker() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<NewBillCandidate[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/billing/visits?${new URLSearchParams({ search: search.trim() })}`, { signal: controller.signal });
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.success) throw new Error(result?.error || "Could not load visits.");
        setResults(result.data); setError("");
      } catch (failure) {
        if (!controller.signal.aborted) { setResults([]); setError(failure instanceof Error ? failure.message : "Could not load visits."); }
      }
    }, 250);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [open, search]);
  function close() { setOpen(false); setSearch(""); setResults(null); setError(""); }
  return <>
    <Button variant="primary" onClick={() => setOpen(true)}>+ New bill</Button>
    <Modal isOpen={open} onClose={close} title="New bill" size="lg" description="Pick the visit to bill. Recent visits are listed first.">
      <div className="space-y-4">
        <Input id="new-bill-search" label="Patient name, mobile or patient code" value={search} maxLength={100} autoComplete="off"
          onChange={(event) => setSearch(event.target.value)} />
        {error && <p role="alert" className="text-alert-ink">{error}</p>}
        {results === null ? <p className="text-muted" role="status">Loading visits…</p>
          : results.length === 0 ? <p className="text-muted" role="status">{search.trim() ? "No visits match. Check the spelling, or register the visit first." : "No recent visits to bill."}</p>
          : <ul aria-label="Visits" className="divide-y divide-line rounded-2xl border border-line">
            {results.map((visit) => <li key={visit.registrationId}>
              <Link href={visit.href} className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-canvas-deep focus-visible:bg-canvas-deep">
                <span className="min-w-0">
                  <span className="block font-semibold text-ink">{visit.patientName} · {visit.patientCode}</span>
                  <span className="block text-muted">{[visitDay(visit.visitDate), visit.doctorName ?? "No doctor", visit.clinicName].join(" · ")}</span>
                </span>
                <StatusPill tone={NEW_BILL_STATUS_TONES[visit.status]}>{NEW_BILL_STATUS_LABELS[visit.status]}</StatusPill>
              </Link>
            </li>)}
          </ul>}
      </div>
    </Modal>
  </>;
}
