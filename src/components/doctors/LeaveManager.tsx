"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { LeaveEntry } from "@/lib/doctors";

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

const INPUT_CLASS =
  "block min-h-11 w-full rounded border border-black/20 bg-transparent px-3 text-base outline-none focus:border-black/60 dark:border-white/25 dark:focus:border-white/60";

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
        className={`flex flex-wrap items-center justify-between gap-2 border-b border-black/10 py-3 last:border-b-0 dark:border-white/10 ${
          isEnded ? "opacity-60" : ""
        }`}
      >
        <div>
          <p className="text-sm font-medium">
            {formatRange(entry)}
            {isActiveNow && (
              <span className="ml-2 rounded bg-amber-600/15 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-400">
                Away now
              </span>
            )}
          </p>
          {entry.reason && (
            <p className="mt-0.5 text-sm text-black/60 dark:text-white/60">
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
            className="min-h-11 rounded border border-black/20 px-3 text-sm font-medium disabled:opacity-50 dark:border-white/25"
          >
            {removingId === entry.id ? "Removing…" : "Remove"}
          </button>
        )}
      </li>
    );
  }

  return (
    <section aria-labelledby="leave-heading">
      <h2 id="leave-heading" className="mb-3 text-lg font-semibold">
        Leave
      </h2>

      {error && (
        <p
          role="alert"
          className="mb-3 rounded border border-red-600/40 bg-red-600/10 px-3 py-2 text-sm text-red-700 dark:text-red-400"
        >
          {error}
        </p>
      )}

      {canEdit && (
        <form
          onSubmit={handleAdd}
          className="mb-4 grid gap-3 rounded border border-black/15 p-3 sm:grid-cols-2 dark:border-white/20"
        >
          <div>
            <label htmlFor="leave-start" className="mb-1 block text-sm font-medium">
              First day away
            </label>
            <input
              id="leave-start"
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                // Keep the range valid as the user types rather than rejecting it later.
                if (e.target.value > endDate) setEndDate(e.target.value);
              }}
              required
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label htmlFor="leave-end" className="mb-1 block text-sm font-medium">
              Last day away
            </label>
            <input
              id="leave-end"
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
              required
              className={INPUT_CLASS}
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="leave-reason" className="mb-1 block text-sm font-medium">
              Reason{" "}
              <span className="font-normal text-black/55 dark:text-white/55">
                (optional)
              </span>
            </label>
            <input
              id="leave-reason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <button
              type="submit"
              disabled={isSaving}
              className="min-h-11 rounded bg-foreground px-5 text-base font-medium text-background disabled:opacity-60"
            >
              {isSaving ? "Recording…" : "Record Leave"}
            </button>
          </div>
        </form>
      )}

      {entries.length === 0 ? (
        <p className="rounded border border-black/15 px-4 py-6 text-center text-sm text-black/60 dark:border-white/20 dark:text-white/60">
          No leave recorded.
        </p>
      ) : (
        <>
          <ul>{current.map((entry) => renderEntry(entry, false))}</ul>

          {ended.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-black/60 dark:text-white/60">
                Past leave ({ended.length})
              </summary>
              <ul>{ended.map((entry) => renderEntry(entry, true))}</ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
