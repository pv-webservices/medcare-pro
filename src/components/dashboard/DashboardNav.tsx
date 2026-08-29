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
  ListTodo,
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
 * each needs the session, and this is a client component. The layout has
 * already dropped every tab the user's roles cannot reach and gives 0 unread to
 * a user without `notification:read`, so the badge never appears for them.
 *
 * Which permission each tab needs lives in src/lib/navigation.ts, along with the
 * reminder that hiding a tab is a courtesy, not access control — the page behind
 * it checks for itself.
 *
 * THE ACTIVE ITEM IS A TINTED ROW WITH A RAIL. One filled row against nine plain
 * ones is unmistakable from across a front desk, and the 3px rail on its leading
 * edge survives both a colour-blind reader and a forced-colours mode. The label
 * also goes to the accent, so the state is carried three ways over.
 */

interface DashboardNavProps {
  links: readonly NavLink[];
  unreadNotifications: number;
  /** Closes the mobile drawer when a link is followed. */
  onNavigate?: () => void;
}

const ICONS: Record<string, typeof LayoutDashboard> = {
  "/dashboard": LayoutDashboard,
  "/appointments": CalendarDays,
  "/tasks": ListTodo,
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
 * The grouping is a presentation decision made here rather than in
 * lib/navigation.ts: the permission and feature gates that module owns are
 * unchanged, and a link in neither list still renders (under Workspace) rather
 * than vanishing.
 */
const MANAGE = new Set(["/doctors", "/clinics", "/team", "/settings"]);

interface NavGroup {
  caption: string;
  links: NavLink[];
}

function groupLinks(links: readonly NavLink[]): NavGroup[] {
  const manage = links.filter((link) => MANAGE.has(link.href));
  const workspace = links.filter((link) => !MANAGE.has(link.href));

  return [
    { caption: "Workspace", links: workspace },
    { caption: "Manage", links: manage },
  ].filter((group) => group.links.length > 0);
}

export default function DashboardNav({
  links,
  unreadNotifications,
  onNavigate,
}: DashboardNavProps) {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <nav aria-label="Main" className="flex flex-col gap-5">
      {groupLinks(links).map((group) => (
        <div key={group.caption}>
          <p className="mb-1.5 px-3 text-micro font-semibold uppercase text-faint">
            {group.caption}
          </p>

          <ul className="flex flex-col gap-0.5">
            {group.links.map((link) => {
              const active = isActive(link.href);
              const Icon = ICONS[link.href] ?? FileText;

              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cx(
                      "group relative flex h-10 items-center gap-2.5 rounded-2xl px-3",
                      "text-body font-medium transition-colors duration-150",
                      active
                        ? "bg-accent-soft text-accent-soft-ink"
                        : "text-muted hover:bg-canvas-deep hover:text-ink",
                    )}
                  >
                    {active && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-accent"
                      />
                    )}

                    <Icon
                      aria-hidden="true"
                      strokeWidth={2}
                      className={cx(
                        "h-[18px] w-[18px] shrink-0",
                        active ? "text-accent" : "text-faint group-hover:text-muted",
                      )}
                    />
                    <span className="flex-1 truncate">{link.label}</span>

                    {link.href === "/notifications" && unreadNotifications > 0 && (
                      <span
                        className={cx(
                          "tnum rounded-full px-1.5 py-0.5 text-meta font-semibold",
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
