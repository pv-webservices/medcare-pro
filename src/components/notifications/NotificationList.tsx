"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

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
          className="mb-3 rounded border border-red-600/40 bg-red-600/10 px-3 py-2 text-sm text-red-700 dark:text-red-400"
        >
          {error}
        </p>
      )}

      {canMark && unreadCount > 0 && (
        <div className="mb-4">
          <button
            type="button"
            onClick={handleMarkAll}
            disabled={isMarkingAll}
            className="min-h-11 rounded border border-black/20 px-4 text-sm font-medium disabled:opacity-60 dark:border-white/25"
          >
            {isMarkingAll ? "Marking…" : `Mark All ${unreadCount} as Read`}
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <div className="rounded border border-black/15 px-4 py-8 text-center dark:border-white/20">
          <p className="mb-1 font-medium">Nothing to review</p>
          <p className="text-sm text-black/60 dark:text-white/60">
            Changes to patients, doctors and clinics appear here as staff make
            them.
          </p>
        </div>
      ) : (
        <ol className="grid gap-3">
          {items.map((item) => (
            <li
              key={item.id}
              className={`rounded border px-4 py-3 ${
                item.read
                  ? "border-black/15 dark:border-white/20"
                  : "border-amber-600/40 bg-amber-600/5"
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="flex items-center gap-2">
                  {!item.read && (
                    <span
                      aria-hidden="true"
                      className="inline-block size-2 shrink-0 rounded-full bg-amber-600"
                    />
                  )}
                  <span className="text-xs font-medium uppercase tracking-wide text-black/55 dark:text-white/55">
                    {item.typeLabel}
                  </span>
                  {!item.read && <span className="sr-only">Unread</span>}
                </p>
                <p className="text-sm tabular-nums text-black/55 dark:text-white/55">
                  {formatTimestamp(item.createdAt)}
                </p>
              </div>

              <p className={`mt-1 ${item.read ? "" : "font-medium"}`}>
                {item.message}
              </p>

              <div className="mt-2 flex flex-wrap items-center gap-3">
                {item.clinicName && (
                  <span className="text-sm text-black/60 dark:text-white/60">
                    {item.clinicName}
                  </span>
                )}

                {item.href && (
                  <Link
                    href={item.href}
                    className="text-sm font-medium underline underline-offset-2"
                  >
                    Open Record
                  </Link>
                )}

                {canMark && (
                  <button
                    type="button"
                    onClick={() => handleToggle(item)}
                    disabled={pendingId === item.id}
                    className="min-h-9 rounded px-2 text-sm text-black/60 hover:bg-black/5 disabled:opacity-50 dark:text-white/60 dark:hover:bg-white/10"
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
