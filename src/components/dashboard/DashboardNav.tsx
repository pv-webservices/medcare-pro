"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavLink } from "@/lib/navigation";
import { cx } from "@/components/ui/cx";
import {
  Bell,
  Building2,
  CalendarDays,
  FileText,
  LayoutDashboard,
  MessageSquare,
  Settings,
  ShieldCheck,
  Stethoscope,
  Users,
} from "lucide-react";

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
 *
 * THE ACTIVE ITEM IS PRESSED IN, not filled. Ten identical raised pills with
 * one tinted differently is a weak signal; a single item sunk into the sidebar
 * is unmistakable at a glance from across a front desk, and it is the same
 * physical metaphor the buttons use. The accent on the icon and label is the
 * second, redundant signal for anyone who cannot read the shadow.
 */

interface DashboardNavProps {
  links: readonly NavLink[];
  unreadNotifications: number;
}

const ICONS: Record<string, typeof LayoutDashboard> = {
  "/dashboard": LayoutDashboard,
  "/appointments": CalendarDays,
  "/registration": Users,
  "/doctors": Stethoscope,
  "/clinics": Building2,
  "/reports": FileText,
  "/notifications": Bell,
  "/messages": MessageSquare,
  "/team": ShieldCheck,
  "/settings": Settings,
};

/**
 * Two groups, split by what the reader came to do: WORKSPACE is the day as it
 * runs — bookings arrive, patients register, messages go out. MANAGE is the
 * setup behind it, opened weekly rather than hourly.
 *
 * The grouping is derived here rather than added to lib/navigation.ts because
 * it is a presentation decision: the permission and feature gates that module
 * owns are unchanged, and a link that appears in neither list still renders
 * (under Workspace) rather than vanishing.
 */
const MANAGE = new Set(["/doctors", "/clinics", "/team", "/settings"]);

interface NavGroup {
  caption: string;
  links: NavLink[];
}

function groupLinks(links: readonly NavLink[]): NavGroup[] {
  const workspace = links.filter((link) => !MANAGE.has(link.href));
  const manage = links.filter((link) => MANAGE.has(link.href));

  return [
    { caption: "Workspace", links: workspace },
    { caption: "Manage", links: manage },
  ].filter((group) => group.links.length > 0);
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
    <nav aria-label="Main" className="flex flex-col gap-6">
      {groupLinks(links).map((group) => (
        <div key={group.caption}>
          <p className="mb-2 px-4 text-micro font-semibold uppercase text-muted">
            {group.caption}
          </p>

          <ul className="flex flex-col gap-1">
            {group.links.map((link) => {
              const active = isActive(link.href);
              const Icon = ICONS[link.href] ?? FileText;

              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={active ? "page" : undefined}
                    className={cx(
                      "group flex h-11 items-center gap-3 rounded-2xl px-4",
                      "text-body font-semibold transition-shadow duration-200",
                      active
                        ? "text-accent shadow-neu-pressed"
                        : "text-muted hover:text-ink hover:shadow-neu-raised-sm",
                    )}
                  >
                    <Icon
                      aria-hidden="true"
                      strokeWidth={2}
                      className={cx(
                        "h-5 w-5 shrink-0",
                        active ? "text-accent" : "text-faint group-hover:text-muted",
                      )}
                    />
                    <span className="flex-1 truncate">{link.label}</span>

                    {link.href === "/notifications" && unreadNotifications > 0 && (
                      <span
                        className={cx(
                          "tnum rounded-full px-2 py-0.5 text-meta font-bold",
                          active
                            ? "bg-accent text-accent-ink"
                            : "bg-accent-soft text-accent-soft-ink",
                        )}
                      >
                        {unreadNotifications}
                        <span className="sr-only"> unread</span>
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
