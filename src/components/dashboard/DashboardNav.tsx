"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavLink } from "@/lib/navigation";

/**
 * Primary navigation — the modules named in docs/PROJECT_STRUCTURE.md.
 *
 * Both the links and the unread count are resolved in the layout, not here:
 * each needs the session, and this component is a client one. The layout has
 * already dropped every tab the user's roles cannot reach, and gives 0 unread
 * to a user without `notification:read`, so the badge never appears for them.
 *
 * Which permission each tab needs lives in src/lib/navigation.ts, along with
 * the reminder that hiding a tab is a courtesy, not access control — the page
 * behind it checks for itself.
 */

interface DashboardNavProps {
  links: readonly NavLink[];
  unreadNotifications: number;
}

export default function DashboardNav({
  links,
  unreadNotifications,
}: DashboardNavProps) {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <nav aria-label="Main">
      <ul className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              aria-current={isActive(link.href) ? "page" : undefined}
              className={`flex min-h-11 items-center gap-2 whitespace-nowrap rounded px-3 text-sm font-medium ${
                isActive(link.href)
                  ? "bg-black/10 dark:bg-white/15"
                  : "text-black/70 hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/10"
              }`}
            >
              {link.label}
              {link.href === "/notifications" && unreadNotifications > 0 && (
                // Amber, the same "needs a look" colour used for a doctor on
                // leave. Counted, not a bare dot: "12 unread" and "1 unread" are
                // different mornings for a front desk.
                <span className="rounded bg-amber-600/15 px-1.5 py-0.5 text-xs font-medium tabular-nums text-amber-800 dark:text-amber-400">
                  {unreadNotifications}
                  <span className="sr-only"> unread</span>
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
