"use client";

import { CalendarCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { LeaveEntry } from "@/lib/doctors";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";

/**
 * Doctor leave — PRD §6.4 (FR-4.4): a date range plus an optional reason.
 *
 * Current and future leave is what a receptionist acts on, so it leads. Ended
 * periods are collapsed rather than dropped.
 */

interface LeaveManagerProps {
  doctorId: string;
  entries: readonly LeaveEntry[];
  canEdit: boolean;
  /** Today as YYYY-MM-DD, resolved on the server so it matches stored dates. */
  today: string;
}

function formatDay(date: string): string {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatRange(entry: LeaveEntry): string {
  return entry.startDate === entry.endDate
    ? formatDay(entry.startDate)
    : `${formatDay(entry.startDate)} – ${formatDay(entry.endDate)}`;
}

export default function LeaveManager({
  doctorId,
  entries,
  canEdit,
  today,
}: LeaveManagerProps) {
  const router = useRouter();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const current = entries.filter((entry) => entry.endDate >= today);
  const ended = entries.filter((entry) => entry.endDate < today);

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (startDate > endDate) {
      setError("The end date cannot be before the start date.");
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch(`/api/doctors/${doctorId}/leave`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate, endDate, reason }),
      });
      const body: { success?: boolean; error?: string } = await response
        .json()
        .catch(() => ({}));

      if (!response.ok || !body.success) {
        setError(body.error ?? "Could not record that leave. Try again.");
        return;
      }

      setReason("");
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRemove(entryId: string) {
    setError(null);
    setRemovingId(entryId);
    try {
      const response = await fetch(
        `/api/doctors/${doctorId}/leave?entryId=${encodeURIComponent(entryId)}`,
        { method: "DELETE" },
      );
      const body: { success?: boolean; error?: string } = await response
        .json()
        .catch(() => ({}));

      if (!response.ok || !body.success) {
        setError(body.error ?? "Could not remove that leave. Try again.");
        return;
      }

      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setRemovingId(null);
    }
  }

  function renderEntry(entry: LeaveEntry, isEnded: boolean) {
    const isActiveNow = entry.startDate <= today && entry.endDate >= today;
    return (
      <li
        key={entry.id}
        className={`flex flex-wrap items-center justify-between gap-2 py-3.5 first:pt-0 last:pb-0 ${
          isEnded ? "opacity-60" : ""
        }`}
      >
        <div>
          <p className="text-body font-bold text-ink">
            {formatRange(entry)}
            {isActiveNow && (
              <span className="ml-3 rounded-lg bg-warn-bg px-2.5 py-0.5 text-micro font-semibold text-warn-ink border border-warn-line">
                Away now
              </span>
            )}
          </p>
          {entry.reason && (
            <p className="mt-1 text-label text-muted">
              {entry.reason}
            </p>
          )}
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => handleRemove(entry.id)}
            disabled={removingId === entry.id}
            aria-label={`Remove leave ${formatRange(entry)}`}
            className="text-label font-semibold text-accent hover:underline disabled:opacity-50 transition-colors"
          >
            {removingId === entry.id ? "Removing…" : "Remove"}
          </button>
        )}
      </li>
    );
  }

  return (
    <section aria-labelledby="leave-heading" className="space-y-6">
      {/* Record Leave Form Card */}
      <div className="rounded-3xl border border-line bg-canvas p-6 sm:p-7 shadow-card space-y-6">
        <h2 id="leave-heading" className="text-lg font-bold tracking-tight text-ink">
          Leave
        </h2>

        {error && (
          <p
            role="alert"
            className="rounded-2xl border border-alert-line bg-alert-bg px-4 py-3 text-body text-alert-ink"
          >
            {error}
          </p>
        )}

        {canEdit && (
          <div className="rounded-2xl border border-line/60 bg-canvas-deep/30 p-4 sm:p-5 space-y-4">
            <form onSubmit={handleAdd} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  id="leave-start"
                  label="First day away"
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    if (e.target.value > endDate) setEndDate(e.target.value);
                  }}
                  required
                />
                <Input
                  id="leave-end"
                  label="Last day away"
                  type="date"
                  value={endDate}
                  min={startDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  required
                />
              </div>
              <Input
                id="leave-reason"
                label="Reason"
                type="text"
                placeholder="Enter reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                hint="Optional"
              />
              <Button
                type="submit"
                variant="primary"
                isBusy={isSaving}
                busyLabel="Recording…"
                className="rounded-xl px-5 py-2.5 font-semibold text-body shadow-cta"
              >
                Record Leave
              </Button>
            </form>
          </div>
        )}
      </div>

      {/* Leave List or Empty Card */}
      {entries.length === 0 ? (
        <div className="rounded-3xl border border-line bg-canvas p-8 shadow-card flex flex-col items-center justify-center text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#EEF2FF] text-[#4F46E5] mb-3">
            <CalendarCheck className="h-6 w-6" aria-hidden="true" />
          </div>
          <p className="text-label font-medium text-muted">
            No leave recorded.
          </p>
        </div>
      ) : (
        <div className="rounded-3xl border border-line bg-canvas p-6 sm:p-7 shadow-card">
          <ul className="divide-y divide-line/60">
            {current.map((entry) => renderEntry(entry, false))}
          </ul>

          {ended.length > 0 && (
            <details className="mt-4 border-t border-line/60 pt-4 group">
              <summary className="cursor-pointer text-label font-semibold text-muted hover:text-ink transition-colors list-none flex items-center gap-1.5">
                <span className="group-open:rotate-90 transition-transform">▶</span>
                Past leave ({ended.length})
              </summary>
              <ul className="mt-2 pl-4 divide-y divide-line/40">
                {ended.map((entry) => renderEntry(entry, true))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
