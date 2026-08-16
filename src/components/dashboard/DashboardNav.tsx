"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Primary navigation — the modules named in docs/PROJECT_STRUCTURE.md.
 *
 * Labels use the PRD's vocabulary exactly ("Registrations", "Doctors",
 * "Clinics"), so staff never have to translate the interface's words into the
 * clinic's own.
 *
 * The unread count is resolved in the layout, not here: it needs the session,
 * and this component is a client one. A user without `notification:read` is
 * given 0, so the badge simply never appears for them.
 */

interface DashboardNavProps {
  unreadNotifications: number;
}

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/registration", label: "Registrations" },
  { href: "/doctors", label: "Doctors" },
  { href: "/clinics", label: "Clinics" },
  { href: "/reports", label: "Reports" },
  { href: "/notifications", label: "Notifications" },
  { href: "/messages", label: "Messages" },
  { href: "/settings/roles", label: "Roles" },
  { href: "/settings/branding", label: "Branding" },
] as const;

export default function DashboardNav({ unreadNotifications }: DashboardNavProps) {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <nav aria-label="Main">
      <ul className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
        {LINKS.map((link) => (
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
