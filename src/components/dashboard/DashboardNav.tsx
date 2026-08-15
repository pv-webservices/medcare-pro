"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Primary navigation — the modules named in docs/PROJECT_STRUCTURE.md.
 *
 * Labels use the PRD's vocabulary exactly ("Registrations", "Doctors",
 * "Clinics"), so staff never have to translate the interface's words into the
 * clinic's own.
 */

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

export default function DashboardNav() {
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
              className={`flex min-h-11 items-center whitespace-nowrap rounded px-3 text-sm font-medium ${
                isActive(link.href)
                  ? "bg-black/10 dark:bg-white/15"
                  : "text-black/70 hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/10"
              }`}
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
