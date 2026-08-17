"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";

/**
 * The notifications feed — PRD §6.7 (FR-7.1, FR-7.2).
 *
 * Unread first, newest first within each half: an Admin opening this page is
 * asking "what happened that I have not seen?", so what needs attention sits at
 * the top rather than at the chronological tail.
 *
 * Amber marks unread — the same "needs a look" colour the doctor-on-leave badge
 * uses elsewhere. Everything already read stays in the neutral palette, so the
 * colour on screen always means something.
 *
 * Read state is per ACCOUNT, not per user: the PRD's `notifications` table has
 * one `read` flag and no user column, so one Admin clearing an item clears it
 * for their colleagues too. The page says so in as many words rather than
 * letting it surprise someone.
 */

export interface NotificationItem {
  id: string;
  typeLabel: string;
  message: string;
  clinicName: string | null;
  /** Link to the record that changed, or null when the type has no page. */
  href: string | null;
  read: boolean;
  /** ISO timestamp — serialised by the page so this stays a plain prop. */
  createdAt: string;
}

interface NotificationListProps {
  items: readonly NotificationItem[];
  unreadCount: number;
  /** False for a reader who cannot mark anything — hides the controls entirely. */
  canMark: boolean;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function NotificationList({
  items,
  unreadCount,
  canMark,
}: NotificationListProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isMarkingAll, setIsMarkingAll] = useState(false);

  async function patch(body: object): Promise<boolean> {
    setError(null);
    try {
      const response = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload: { success?: boolean; error?: string } = await response
        .json()
        .catch(() => ({}));

      if (!response.ok || !payload.success) {
        setError(payload.error ?? "Could not update that notification. Try again.");
        return false;
      }

      router.refresh();
      return true;
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      return false;
    }
  }

  async function handleToggle(item: NotificationItem) {
    setPendingId(item.id);
    await patch({ ids: [item.id], read: !item.read });
    setPendingId(null);
  }

  async function handleMarkAll() {
    setIsMarkingAll(true);
    await patch({ all: true, read: true });
    setIsMarkingAll(false);
  }

  return (
    <div>
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600"
        >
          {error}
        </p>
      )}

      {canMark && unreadCount > 0 && (
        <div className="mb-6">
          <Button
            type="button"
            onClick={handleMarkAll}
            disabled={isMarkingAll}
            isBusy={isMarkingAll}
            busyLabel="Marking…"
            variant="secondary"
          >
            Mark All {unreadCount} as Read
          </Button>
        </div>
      )}

      {items.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-8 text-center shadow-sm">
          <p className="mb-1 font-semibold text-slate-900">Nothing to review</p>
          <p className="text-sm text-slate-500">
            Changes to patients, doctors and clinics appear here as staff make
            them.
          </p>
        </div>
      ) : (
        <ol className="grid gap-4">
          {items.map((item) => (
            <li
              key={item.id}
              className={`rounded-xl border p-5 shadow-sm transition-colors ${
                item.read
                  ? "border-slate-200 bg-white"
                  : "border-amber-200 bg-amber-50"
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                <p className="flex items-center gap-2">
                  {!item.read && (
                    <span
                      aria-hidden="true"
                      className="inline-block size-2 shrink-0 rounded-full bg-amber-500"
                    />
                  )}
                  <span className={`text-xs font-bold uppercase tracking-wider ${item.read ? "text-slate-500" : "text-amber-700"}`}>
                    {item.typeLabel}
                  </span>
                  {!item.read && <span className="sr-only">Unread</span>}
                </p>
                <p className={`text-sm tabular-nums ${item.read ? "text-slate-400" : "text-amber-600"}`}>
                  {formatTimestamp(item.createdAt)}
                </p>
              </div>

              <p className={`text-slate-900 ${item.read ? "font-normal" : "font-semibold"}`}>
                {item.message}
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-4">
                {item.clinicName && (
                  <span className={`text-sm font-medium ${item.read ? "text-slate-500" : "text-amber-700"}`}>
                    {item.clinicName}
                  </span>
                )}

                {item.href && (
                  <Link
                    href={item.href}
                    className={`text-sm font-semibold hover:underline underline-offset-4 ${item.read ? "text-primary hover:text-primary-hover" : "text-amber-700 hover:text-amber-800"}`}
                  >
                    Open Record
                  </Link>
                )}

                {canMark && (
                  <button
                    type="button"
                    onClick={() => handleToggle(item)}
                    disabled={pendingId === item.id}
                    className={`min-h-9 rounded-md px-3 text-sm font-medium transition-colors disabled:opacity-50 ml-auto ${
                      item.read 
                        ? "text-slate-500 hover:bg-slate-100" 
                        : "text-amber-700 hover:bg-amber-100"
                    }`}
                  >
                    {pendingId === item.id
                      ? "…"
                      : item.read
                        ? "Mark as Unread"
                        : "Mark as Read"}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
