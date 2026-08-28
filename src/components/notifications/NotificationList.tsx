"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, BellOff, Check, Undo2 } from "lucide-react";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import { cx } from "@/components/ui/cx";

/**
 * The notifications feed — PRD §6.7 (FR-7.1, FR-7.2).
 *
 * AN ACTIVITY CENTRE, READ IN DAYS. Items are grouped Today / Yesterday /
 * Earlier, newest first, because "when did that happen?" is the question this
 * screen is opened with. Unread items are not hoisted above read ones any more:
 * a feed that reorders itself as you read it loses your place. They are marked
 * instead.
 *
 * UNREAD IS MARKED, NOT SHOUTED. An accent rail, a dot and a heavier message —
 * enough to find at a glance, restrained enough that a page of twenty unread
 * items is still readable. The previous full amber card meant a normal Monday
 * morning arrived as a wall of warning colour, which trains people to ignore it.
 *
 * READ STATE IS PER ACCOUNT, NOT PER USER: the PRD's `notifications` table has
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

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Which bucket a timestamp belongs to, decided in the READER's timezone —
 * "today" on this screen has to mean the day the person at the desk is having,
 * not the server's.
 */
function bucketFor(iso: string): string {
  const then = new Date(iso);
  const now = new Date();

  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const startOfYesterday = startOfToday - 86_400_000;
  const stamp = then.getTime();

  if (stamp >= startOfToday) {
    return "Today";
  }
  if (stamp >= startOfYesterday) {
    return "Yesterday";
  }
  return "Earlier";
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

  if (items.length === 0) {
    return (
      <>
        {error && (
          <p
            role="alert"
            className="mb-4 rounded-2xl border border-alert-line bg-alert-bg px-4 py-3 text-body text-alert-ink"
          >
            {error}
          </p>
        )}
        <EmptyState
          icon={<BellOff className="h-5 w-5" strokeWidth={2} />}
          title="You are all caught up"
          guidance="Changes to patients, doctors and clinics appear here as your team makes them."
        />
      </>
    );
  }

  // One pass, in the order the server sent: the groups come out newest-first
  // without a second sort.
  const groups: { label: string; items: NotificationItem[] }[] = [];
  for (const item of items) {
    const label = bucketFor(item.createdAt);
    const current = groups[groups.length - 1];
    if (current && current.label === label) {
      current.items.push(item);
    } else {
      groups.push({ label, items: [item] });
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <p
          role="alert"
          className="rounded-2xl border border-alert-line bg-alert-bg px-4 py-3 text-body text-alert-ink"
        >
          {error}
        </p>
      )}

      {canMark && unreadCount > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-canvas px-4 py-3 shadow-card">
          <p className="text-body text-muted">
            <span className="tnum font-semibold text-ink">{unreadCount}</span>{" "}
            unread {unreadCount === 1 ? "item" : "items"}. Marking one read marks
            it for everyone in this account.
          </p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={handleMarkAll}
            disabled={isMarkingAll}
            isBusy={isMarkingAll}
            busyLabel="Marking..."
          >
            Mark all read
          </Button>
        </div>
      )}

      {groups.map((group) => (
        <section key={group.label} aria-label={group.label}>
          <h2 className="mb-2 px-1 text-micro font-semibold uppercase text-faint">
            {group.label}
          </h2>

          <ol className="overflow-hidden rounded-3xl border border-line bg-canvas shadow-card">
            {group.items.map((item) => (
              <li
                key={item.id}
                className={cx(
                  "relative border-b border-line px-4 py-3.5 transition-colors duration-150 last:border-b-0",
                  item.read ? "hover:bg-canvas-deep" : "bg-accent-soft/35",
                )}
              >
                {!item.read && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-accent"
                  />
                )}

                <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-line bg-canvas-deep px-2 py-0.5 text-meta font-medium text-muted">
                        {item.typeLabel}
                      </span>
                      {item.clinicName && (
                        <span className="text-meta text-muted">
                          {item.clinicName}
                        </span>
                      )}
                      {!item.read && <span className="sr-only">Unread</span>}
                    </p>

                    <p
                      className={cx(
                        "mt-1.5 text-body",
                        item.read ? "text-ink-soft" : "font-medium text-ink",
                      )}
                    >
                      {item.message}
                    </p>

                    {item.href && (
                      <Link
                        href={item.href}
                        className="mt-1.5 inline-flex items-center gap-1 rounded text-label font-medium text-accent transition-colors duration-150 hover:text-accent-strong"
                      >
                        Open record
                        <ArrowRight
                          aria-hidden="true"
                          strokeWidth={2}
                          className="h-3.5 w-3.5"
                        />
                      </Link>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <time
                      dateTime={item.createdAt}
                      title={formatDate(item.createdAt)}
                      className="tnum text-meta text-muted"
                    >
                      {group.label === "Earlier"
                        ? formatDate(item.createdAt)
                        : formatTime(item.createdAt)}
                    </time>

                    {canMark && (
                      <button
                        type="button"
                        onClick={() => handleToggle(item)}
                        disabled={pendingId === item.id}
                        aria-label={
                          item.read
                            ? `Mark as unread: ${item.message}`
                            : `Mark as read: ${item.message}`
                        }
                        title={item.read ? "Mark as unread" : "Mark as read"}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-canvas hover:text-ink disabled:opacity-50"
                      >
                        {item.read ? (
                          <Undo2 aria-hidden="true" strokeWidth={2} className="h-4 w-4" />
                        ) : (
                          <Check aria-hidden="true" strokeWidth={2.5} className="h-4 w-4" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
