"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { LeaveEntry } from "@/lib/doctors";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Card from "@/components/ui/Card";

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
        className={`flex flex-wrap items-center justify-between gap-2 border-b border-line py-4 last:border-b-0 ${
          isEnded ? "opacity-60" : ""
        }`}
      >
        <div>
          <p className="text-sm font-semibold text-ink">
            {formatRange(entry)}
            {isActiveNow && (
              <span className="ml-3 rounded-md bg-warn-bg px-2.5 py-1 text-xs font-semibold text-warn-ink">
                Away now
              </span>
            )}
          </p>
          {entry.reason && (
            <p className="mt-1 text-sm text-muted">
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
            className="min-h-9 rounded-md px-3 text-xs font-medium text-muted hover:bg-canvas-deep hover:text-ink disabled:opacity-50 transition-colors"
          >
            {removingId === entry.id ? "Removing…" : "Remove"}
          </button>
        )}
      </li>
    );
  }

  return (
    <section aria-labelledby="leave-heading" className="space-y-4">
      <h2 id="leave-heading" className="text-lg font-bold text-ink">
        Leave
      </h2>

      {error && (
        <p
          role="alert"
          className="rounded-xl bg-alert-bg px-4 py-3 text-sm text-alert-ink"
        >
          {error}
        </p>
      )}

      {canEdit && (
        <Card isFlush={false} className="p-4 bg-canvas-deep border-line">
          <form
            onSubmit={handleAdd}
            className="grid gap-4 sm:grid-cols-2"
          >
            <Input
              id="leave-start"
              label="First day away"
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                // Keep the range valid as the user types rather than rejecting it later.
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
            <Input
              id="leave-reason"
              label="Reason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              hint="Optional"
              fieldClassName="sm:col-span-2"
            />
            <div className="sm:col-span-2">
              <Button
                type="submit"
                variant="commit"
                isBusy={isSaving}
                busyLabel="Recording…"
              >
                Record Leave
              </Button>
            </div>
          </form>
        </Card>
      )}

      {entries.length === 0 ? (
        <div className="rounded-2xl bg-canvas px-6 py-8 text-center shadow-neu-raised-sm">
          <p className="text-sm font-medium text-muted">
            No leave recorded.
          </p>
        </div>
      ) : (
        <Card isFlush={false} className="p-2 sm:p-4">
          <ul>{current.map((entry) => renderEntry(entry, false))}</ul>

          {ended.length > 0 && (
            <details className="mt-4 border-t border-line pt-4 group">
              <summary className="cursor-pointer text-sm font-semibold text-muted hover:text-ink transition-colors list-none flex items-center">
                <span className="group-open:rotate-90 transition-transform mr-2">▶</span>
                Past leave ({ended.length})
              </summary>
              <ul className="mt-2 pl-4">{ended.map((entry) => renderEntry(entry, true))}</ul>
            </details>
          )}
        </Card>
      )}
    </section>
  );
}
