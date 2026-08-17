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
      <ul className="flex flex-wrap gap-2">
        {OPTIONS.map(({ status, label }) => {
          const isSelected = status === selected;

          return (
            <li key={status}>
              <Link
                href={status === "all" ? "/notifications" : "/notifications?status=unread"}
                aria-current={isSelected ? "page" : undefined}
                className={`inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-medium transition-colors ${
                  isSelected
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50"
                }`}
              >
                {label}
                {status === "unread" && unreadCount > 0 && (
                  <span className="ml-2 tabular-nums">({unreadCount})</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
