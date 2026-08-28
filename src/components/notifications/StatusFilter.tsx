import Link from "next/link";

/**
 * All / Unread — PRD §6.7 (FR-7.2).
 *
 * Links rather than client state, for the same reason as the report period
 * selector: the choice belongs in the URL so it survives a reload, and there is
 * nothing here worth shipping JavaScript for.
 */

export type NotificationStatus = "all" | "unread";

interface StatusFilterProps {
  selected: NotificationStatus;
  unreadCount: number;
}

const OPTIONS: readonly { status: NotificationStatus; label: string }[] = [
  { status: "all", label: "All" },
  { status: "unread", label: "Unread" },
];

export default function StatusFilter({ selected, unreadCount }: StatusFilterProps) {
  return (
    <nav aria-label="Notification status">
      <ul className="flex flex-wrap items-center gap-1 rounded-2xl border border-line bg-canvas p-1 shadow-card">
        {OPTIONS.map(({ status, label }) => {
          const isSelected = status === selected;

          return (
            <li key={status}>
              <Link
                href={status === "all" ? "/notifications" : "/notifications?status=unread"}
                aria-current={isSelected ? "page" : undefined}
                className={`inline-flex min-h-10 items-center justify-center rounded-xl px-3.5 text-body font-medium transition-colors duration-150 ${
                  isSelected
                    ? "border border-accent bg-accent text-accent-ink shadow-cta"
                    : "border border-transparent text-muted hover:bg-canvas-deep hover:text-ink"
                }`}
              >
                {label}
                {status === "unread" && unreadCount > 0 && (
                  <span className="tnum ml-1.5">({unreadCount})</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
