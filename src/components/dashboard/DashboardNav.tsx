"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavLink } from "@/lib/navigation";
import { 
  LayoutDashboard, 
  Users, 
  Stethoscope, 
  Building2, 
  FileText, 
  Bell, 
  MessageSquare, 
  ShieldCheck, 
  Settings 
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
 */

interface DashboardNavProps {
  links: readonly NavLink[];
  unreadNotifications: number;
}

function getIconForHref(href: string, isActive: boolean) {
  const className = `h-5 w-5 ${isActive ? "text-primary" : "text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300"}`;
  switch (href) {
    case "/dashboard": return <LayoutDashboard className={className} />;
    case "/registration": return <Users className={className} />;
    case "/doctors": return <Stethoscope className={className} />;
    case "/clinics": return <Building2 className={className} />;
    case "/reports": return <FileText className={className} />;
    case "/notifications": return <Bell className={className} />;
    case "/messages": return <MessageSquare className={className} />;
    case "/roles": return <ShieldCheck className={className} />;
    case "/branding": return <Settings className={className} />;
    default: return <FileText className={className} />;
  }
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
    <nav aria-label="Main" className="space-y-1">
      <ul className="flex flex-col gap-1.5">
        {links.map((link) => {
          const active = isActive(link.href);
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`group flex min-h-[44px] items-center gap-3 rounded-xl px-4 text-[14px] transition-colors ${
                  active
                    ? "bg-primary-light text-primary font-semibold"
                    : "text-slate-600 font-medium hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/50 dark:hover:text-slate-200"
                }`}
              >
                {getIconForHref(link.href, active)}
                <span className="flex-1">{link.label}</span>
                {link.href === "/notifications" && unreadNotifications > 0 && (
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${
                    active ? "bg-primary text-white" : "bg-primary-light text-primary"
                  }`}>
                    {unreadNotifications}
                    <span className="sr-only"> unread</span>
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
