"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { AvailabilityEntry } from "@/lib/doctors";

/**
 * Doctor availability — PRD §6.4 (FR-4.3): specific dates with time ranges.
 *
 * Entries are grouped by date so a week reads as a few rows rather than a long
 * flat list. Past dates are separated out but not hidden — a receptionist
 * checking "was she in on Tuesday?" still needs them.
 */

interface AvailabilityManagerProps {
  doctorId: string;
  entries: readonly AvailabilityEntry[];
  canEdit: boolean;
  /** Today as YYYY-MM-DD, resolved on the server so it matches stored dates. */
  today: string;
}

const INPUT_CLASS =
  "block min-h-11 w-full rounded border border-black/20 bg-transparent px-3 text-base outline-none focus:border-black/60 dark:border-white/25 dark:focus:border-white/60";

function formatDayLabel(date: string): string {
  // Parsed as UTC to match how the date is stored, so the label cannot slip a day.
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function groupByDate(
  entries: readonly AvailabilityEntry[],
): { date: string; slots: AvailabilityEntry[] }[] {
  const byDate = new Map<string, AvailabilityEntry[]>();
  for (const entry of entries) {
    byDate.set(entry.date, [...(byDate.get(entry.date) ?? []), entry]);
  }
  return [...byDate.entries()]
    .map(([date, slots]) => ({ date, slots }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export default function AvailabilityManager({
  doctorId,
  entries,
  canEdit,
  today,
}: AvailabilityManagerProps) {
  const router = useRouter();
  const [date, setDate] = useState(today);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const grouped = groupByDate(entries);
  const upcoming = grouped.filter((group) => group.date >= today);
  const past = grouped.filter((group) => group.date < today);

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (startTime >= endTime) {
      setError("The end time must be after the start time.");
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch(`/api/doctors/${doctorId}/availability`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, startTime, endTime }),
      });
      const body: { success?: boolean; error?: string } = await response
        .json()
        .catch(() => ({}));

      if (!response.ok || !body.success) {
        // Covers the 409 for an overlapping window, whose message is written
        // for the user by the server.
        setError(body.error ?? "Could not add that availability. Try again.");
        return;
      }

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
        `/api/doctors/${doctorId}/availability?entryId=${encodeURIComponent(entryId)}`,
        { method: "DELETE" },
      );
      const body: { success?: boolean; error?: string } = await response
        .json()
        .catch(() => ({}));

      if (!response.ok || !body.success) {
        setError(body.error ?? "Could not remove that window. Try again.");
        return;
      }

      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setRemovingId(null);
    }
  }

  function renderGroup(group: { date: string; slots: AvailabilityEntry[] }, isPast: boolean) {
    return (
      <li
        key={group.date}
        className={`border-b border-black/10 py-3 last:border-b-0 dark:border-white/10 ${
          isPast ? "opacity-60" : ""
        }`}
      >
        <p className="text-sm font-medium">{formatDayLabel(group.date)}</p>
        <ul className="mt-1 flex flex-wrap items-center gap-2">
          {group.slots
            .slice()
            .sort((a, b) => a.startTime.localeCompare(b.startTime))
            .map((slot) => (
              <li
                key={slot.id}
                className="flex items-center gap-2 rounded border border-black/15 py-1 pl-3 pr-1 dark:border-white/20"
              >
                <span className="text-sm tabular-nums">
                  {slot.startTime}–{slot.endTime}
                </span>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => handleRemove(slot.id)}
                    disabled={removingId === slot.id}
                    aria-label={`Remove ${slot.startTime} to ${slot.endTime} on ${formatDayLabel(group.date)}`}
                    className="min-h-9 rounded px-2 text-sm text-black/60 hover:bg-black/5 disabled:opacity-50 dark:text-white/60 dark:hover:bg-white/10"
                  >
                    {removingId === slot.id ? "…" : "Remove"}
                  </button>
                )}
              </li>
            ))}
        </ul>
      </li>
    );
  }

  return (
    <section aria-labelledby="availability-heading">
      <h2 id="availability-heading" className="mb-3 text-lg font-semibold">
        Availability
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
          className="mb-4 grid gap-3 rounded border border-black/15 p-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end dark:border-white/20"
        >
          <div>
            <label htmlFor="availability-date" className="mb-1 block text-sm font-medium">
              Date
            </label>
            <input
              id="availability-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label htmlFor="availability-start" className="mb-1 block text-sm font-medium">
              From
            </label>
            <input
              id="availability-start"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              required
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label htmlFor="availability-end" className="mb-1 block text-sm font-medium">
              To
            </label>
            <input
              id="availability-end"
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              required
              className={INPUT_CLASS}
            />
          </div>
          <button
            type="submit"
            disabled={isSaving}
            className="min-h-11 rounded bg-foreground px-5 text-base font-medium text-background disabled:opacity-60"
          >
            {isSaving ? "Adding…" : "Add Hours"}
          </button>
        </form>
      )}

      {entries.length === 0 ? (
        <p className="rounded border border-black/15 px-4 py-6 text-center text-sm text-black/60 dark:border-white/20 dark:text-white/60">
          No availability set. Add the dates and hours this doctor is in.
        </p>
      ) : (
        <>
          <ul>{upcoming.map((group) => renderGroup(group, false))}</ul>

          {past.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-black/60 dark:text-white/60">
                Past dates ({past.length})
              </summary>
              <ul>{past.map((group) => renderGroup(group, true))}</ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
