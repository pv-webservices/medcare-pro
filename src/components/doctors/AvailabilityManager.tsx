"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { AvailabilityEntry } from "@/lib/doctors";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Card from "@/components/ui/Card";

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
        className={`border-b border-slate-200 py-4 last:border-b-0 ${
          isPast ? "opacity-60" : ""
        }`}
      >
        <p className="text-sm font-semibold text-slate-900">{formatDayLabel(group.date)}</p>
        <ul className="mt-2 flex flex-wrap items-center gap-2">
          {group.slots
            .slice()
            .sort((a, b) => a.startTime.localeCompare(b.startTime))
            .map((slot) => (
              <li
                key={slot.id}
                className="flex items-center gap-2 rounded-lg border border-slate-200 py-1.5 pl-3 pr-1.5 bg-slate-50"
              >
                <span className="text-sm tabular-nums text-slate-900 font-medium">
                  {slot.startTime}–{slot.endTime}
                </span>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => handleRemove(slot.id)}
                    disabled={removingId === slot.id}
                    aria-label={`Remove ${slot.startTime} to ${slot.endTime} on ${formatDayLabel(group.date)}`}
                    className="min-h-8 rounded-md px-2 text-xs font-medium text-slate-500 hover:bg-slate-200 disabled:opacity-50 transition-colors"
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
    <section aria-labelledby="availability-heading" className="space-y-4">
      <h2 id="availability-heading" className="text-lg font-bold text-slate-900">
        Availability
      </h2>

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600"
        >
          {error}
        </p>
      )}

      {canEdit && (
        <Card isFlush={false} className="p-4 bg-slate-50 border-slate-200">
          <form
            onSubmit={handleAdd}
            className="grid gap-4 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end"
          >
            <Input
              id="availability-date"
              label="Date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
            <Input
              id="availability-start"
              label="From"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              required
            />
            <Input
              id="availability-end"
              label="To"
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              required
            />
            <Button
              type="submit"
              variant="commit"
              isBusy={isSaving}
              busyLabel="Adding…"
            >
              Add Hours
            </Button>
          </form>
        </Card>
      )}

      {entries.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-8 text-center shadow-sm">
          <p className="text-sm font-medium text-slate-500">
            No availability set. Add the dates and hours this doctor is in.
          </p>
        </div>
      ) : (
        <Card isFlush={false} className="p-2 sm:p-4">
          <ul>{upcoming.map((group) => renderGroup(group, false))}</ul>

          {past.length > 0 && (
            <details className="mt-4 border-t border-slate-200 pt-4 group">
              <summary className="cursor-pointer text-sm font-semibold text-slate-500 hover:text-slate-900 transition-colors list-none flex items-center">
                <span className="group-open:rotate-90 transition-transform mr-2">▶</span>
                Past dates ({past.length})
              </summary>
              <ul className="mt-2 pl-4">{past.map((group) => renderGroup(group, true))}</ul>
            </details>
          )}
        </Card>
      )}
    </section>
  );
}
