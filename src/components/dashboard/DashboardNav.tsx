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
  PhoneCall,
  Settings,
  ShieldCheck,
  Stethoscope,
  Users,
} from "lucide-react";

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
  "/ivr": PhoneCall,
  "/team": ShieldCheck,
  "/settings": Settings,
};

const MANAGE = new Set(["/doctors", "/clinics", "/team", "/settings"]);

interface NavGroup {
  caption: string;
  links: NavLink[];
}

function groupLinks(links: readonly NavLink[]): NavGroup[] {
  const workspaceOrder = [
    "/dashboard",
    "/appointments",
    "/tasks",
    "/registration",
    "/reports",
    "/notifications",
    "/messages",
    "/ivr",
  ];
  const manageOrder = ["/doctors", "/clinics", "/team", "/settings"];

  const manage = links
    .filter((link) => MANAGE.has(link.href))
    .sort((a, b) => manageOrder.indexOf(a.href) - manageOrder.indexOf(b.href));

  const workspace = links
    .filter((link) => !MANAGE.has(link.href))
    .sort((a, b) => workspaceOrder.indexOf(a.href) - workspaceOrder.indexOf(b.href));

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
    if (href === "/dashboard") {
      return pathname === "/dashboard";
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <nav aria-label="Main" className="flex flex-col gap-6">
      {groupLinks(links).map((group) => (
        <div key={group.caption}>
          <p className="mb-2 px-3.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
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
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cx(
                      "group relative flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all duration-150",
                      active
                        ? "bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-600/25"
                        : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200",
                    )}
                  >
                    <Icon
                      aria-hidden="true"
                      strokeWidth={2}
                      className={cx(
                        "h-4 w-4 shrink-0 transition-colors",
                        active
                          ? "text-white"
                          : "text-slate-400 group-hover:text-slate-200",
                      )}
                    />
                    <span className="flex-1 truncate">{link.label}</span>

                    {link.href === "/notifications" && unreadNotifications > 0 && (
                      <span
                        className={cx(
                          "rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums shadow-xs",
                          active
                            ? "bg-white/20 text-white"
                            : "bg-indigo-600 text-white",
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
