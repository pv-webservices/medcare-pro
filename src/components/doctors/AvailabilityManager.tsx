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
        className={`py-3.5 first:pt-0 last:pb-0 ${
          isPast ? "opacity-60" : ""
        }`}
      >
        <p className="text-body font-bold text-ink">{formatDayLabel(group.date)}</p>
        <ul className="mt-2 flex flex-wrap items-center gap-4">
          {group.slots
            .slice()
            .sort((a, b) => a.startTime.localeCompare(b.startTime))
            .map((slot) => (
              <li
                key={slot.id}
                className="flex items-center gap-3"
              >
                <span className="text-body tnum text-ink font-medium">
                  {slot.startTime}–{slot.endTime}
                </span>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => handleRemove(slot.id)}
                    disabled={removingId === slot.id}
                    aria-label={`Remove ${slot.startTime} to ${slot.endTime} on ${formatDayLabel(group.date)}`}
                    className="text-label font-semibold text-accent hover:underline disabled:opacity-50 transition-colors"
                  >
                    {removingId === slot.id ? "Removing…" : "Remove"}
                  </button>
                )}
              </li>
            ))}
        </ul>
      </li>
    );
  }

  return (
    <section
      aria-labelledby="availability-heading"
      className="rounded-3xl border border-line bg-canvas p-6 sm:p-7 shadow-card space-y-6"
    >
      <h2 id="availability-heading" className="text-lg font-bold tracking-tight text-ink">
        Availability
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
        <div className="rounded-2xl border border-line/60 bg-canvas-deep/30 p-4 sm:p-5">
          <form
            onSubmit={handleAdd}
            className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end"
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
              variant="primary"
              isBusy={isSaving}
              busyLabel="Adding…"
              className="rounded-xl px-4 py-2.5 font-semibold text-body shadow-cta"
            >
              Add Hours
            </Button>
          </form>
        </div>
      )}

      {entries.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line/80 p-8 text-center bg-canvas-deep/20">
          <p className="text-label font-medium text-muted">
            No availability set. Add the dates and hours this doctor is in.
          </p>
        </div>
      ) : (
        <div>
          <ul className="divide-y divide-line/60">
            {upcoming.map((group) => renderGroup(group, false))}
          </ul>

          {past.length > 0 && (
            <details className="mt-4 border-t border-line/60 pt-4 group">
              <summary className="cursor-pointer text-label font-semibold text-muted hover:text-ink transition-colors list-none flex items-center gap-1.5">
                <span className="group-open:rotate-90 transition-transform">▶</span>
                Past dates ({past.length})
              </summary>
              <ul className="mt-2 pl-4 divide-y divide-line/40">
                {past.map((group) => renderGroup(group, true))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
