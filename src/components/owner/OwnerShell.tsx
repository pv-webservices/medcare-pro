"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  Building2,
  LayoutGrid,
  Layers,
  LogOut,
  Menu as MenuIcon,
  ScrollText,
  Shield,
  ToggleLeft,
  X,
} from "lucide-react";
import { signOut } from "next-auth/react";
import { cx } from "@/components/ui";
import OwnerUserMenu from "@/components/owner/OwnerUserMenu";

function ShieldPulseIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M8.5 12h2l1.5-3 2 6 1.5-3h2" />
    </svg>
  );
}

interface OwnerShellProps {
  user: {
    name: string;
    email?: string | null;
    platformRole?: string;
  };
  children: ReactNode;
}

interface NavItem {
  label: string;
  href: string;
  icon: typeof LayoutGrid;
}

const OVERVIEW_NAV: NavItem = {
  label: "Overview",
  href: "/owner/dashboard",
  icon: LayoutGrid,
};

const MANAGEMENT_NAV: NavItem[] = [
  {
    label: "Clinic applications",
    href: "/owner/applications",
    icon: Building2,
  },
  {
    label: "Platform features",
    href: "/owner/features",
    icon: ToggleLeft,
  },
  {
    label: "Plans",
    href: "/owner/plans",
    icon: Layers,
  },
  {
    label: "Activity log",
    href: "/owner/audit",
    icon: ScrollText,
  },
];

export default function OwnerShell({ user, children }: OwnerShellProps) {
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [prevPathname, setPrevPathname] = useState(pathname);

  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    setIsMobileMenuOpen(false);
  }

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    if (!isMobileMenuOpen) return;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [isMobileMenuOpen]);

  async function handleSignOut() {
    setIsSigningOut(true);
    try {
      await fetch("/api/auth/sessions/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
    } catch {
      // Swallowed
    }
    await signOut({ callbackUrl: "/owner/login" });
  }

  function isNavActive(href: string) {
    if (href === "/owner/dashboard") {
      return pathname === "/owner/dashboard";
    }
    return pathname.startsWith(href);
  }

  const SidebarContent = (
    <div className="flex h-full flex-col justify-between p-5 text-white">
      <div>
        {/* Brand Header */}
        <Link
          href="/owner/dashboard"
          className="flex items-center gap-3 px-1 py-1 transition-opacity hover:opacity-90"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-600/30">
            <ShieldPulseIcon className="h-5 w-5" />
          </div>
          <div>
            <div className="text-base font-bold tracking-tight text-white">
              MEDCARE PRO
            </div>
            <div className="text-[11px] font-medium text-slate-400">
              Healthcare. Simplified.
            </div>
          </div>
        </Link>

        {/* Navigation List */}
        <div className="mt-8 space-y-1">
          {/* Overview Link */}
          {(() => {
            const Icon = OVERVIEW_NAV.icon;
            const active = isNavActive(OVERVIEW_NAV.href);
            return (
              <Link
                key={OVERVIEW_NAV.href}
                href={OVERVIEW_NAV.href}
                className={cx(
                  "flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all duration-150",
                  active
                    ? "bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-600/25"
                    : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200",
                )}
              >
                <Icon className={cx("h-4 w-4 shrink-0", active ? "text-white" : "text-indigo-400")} />
                <span>{OVERVIEW_NAV.label}</span>
              </Link>
            );
          })()}

          {/* Section: Management */}
          <div className="pt-6 pb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Management
          </div>

          {MANAGEMENT_NAV.map((item) => {
            const Icon = item.icon;
            const active = isNavActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cx(
                  "flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all duration-150",
                  active
                    ? "bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-600/25"
                    : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200",
                )}
              >
                <Icon className={cx("h-4 w-4 shrink-0", active ? "text-white" : "text-indigo-400")} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Sidebar Bottom Section */}
      <div className="mt-8 space-y-3">
        {/* Informational Security Card */}
        <div className="flex flex-col gap-2 rounded-2xl border border-indigo-500/20 bg-[#0c1226]/90 p-4 shadow-sm">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-indigo-500/30 bg-indigo-950/80 text-indigo-400">
              <Shield className="h-4 w-4" />
            </div>
            <div className="text-xs font-semibold text-white">Secure &amp; trusted</div>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-400">
            Enterprise-grade security protecting your data and clinics.
          </p>
          <Link
            href="/owner/audit"
            className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            <span>Learn more</span>
            <span aria-hidden="true">&rarr;</span>
          </Link>
        </div>

        {/* Sidebar Sign Out */}
        <button
          type="button"
          onClick={handleSignOut}
          disabled={isSigningOut}
          className="flex w-full items-center gap-2.5 rounded-xl border border-slate-800/80 bg-slate-900/50 px-4 py-2.5 text-xs font-medium text-slate-400 transition-colors hover:border-slate-700 hover:bg-rose-950/30 hover:text-rose-300 disabled:opacity-60"
        >
          <LogOut className="h-3.5 w-3.5 shrink-0" />
          <span>{isSigningOut ? "Signing out…" : "Log out"}</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-[#060b17] font-sans text-white">
      {/* Desktop Fixed Sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-slate-800/70 bg-[#080d1e] lg:block">
        <div className="sticky top-0 h-screen overflow-y-auto">
          {SidebarContent}
        </div>
      </aside>

      {/* Mobile Drawer Backdrop & Panel */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            aria-hidden="true"
            onClick={() => setIsMobileMenuOpen(false)}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
          />
          <div className="fixed inset-y-0 left-0 w-72 max-w-[80vw] border-r border-slate-800 bg-[#080d1e] shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800/80 px-4 py-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Menu
              </span>
              <button
                type="button"
                onClick={() => setIsMobileMenuOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="h-[calc(100vh-3.5rem)] overflow-y-auto">
              {SidebarContent}
            </div>
          </div>
        </div>
      )}

      {/* Main Column */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Topbar */}
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between border-b border-slate-800/70 bg-[#070c1b]/85 px-4 backdrop-blur-md sm:px-6 md:px-8 lg:px-10">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(true)}
              aria-label="Open sidebar navigation"
              className="rounded-xl border border-slate-800 bg-slate-900/60 p-2 text-slate-400 hover:bg-slate-800 hover:text-white lg:hidden"
            >
              <MenuIcon className="h-5 w-5" />
            </button>
            <div>
              <span className="inline-flex items-center gap-2 rounded-xl border border-slate-800/80 bg-[#0c1226]/80 px-3.5 py-1.5 text-xs font-medium text-slate-300 shadow-xs">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                Platform Console
              </span>
            </div>
          </div>

          {/* Right-side Notification & Profile */}
          <div className="flex items-center gap-2.5 sm:gap-3">
            <Link
              href="/owner/applications"
              aria-label="Applications notifications"
              className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-slate-800/80 bg-[#0c1226]/80 text-slate-400 shadow-xs transition-colors hover:border-slate-700 hover:bg-slate-800 hover:text-white"
            >
              <Bell className="h-4 w-4" />
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-purple-600 px-1 text-[10px] font-bold text-white shadow-xs">
                !
              </span>
            </Link>

            <OwnerUserMenu user={user} />
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 bg-[#060b17]">{children}</main>

        {/* Footer */}
        <footer className="border-t border-slate-800/60 bg-[#070c1b]/60 px-4 py-4 text-xs text-slate-500 sm:px-6 md:px-8 lg:px-10 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div>&copy; {new Date().getFullYear()} MEDCARE PRO. All rights reserved.</div>
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <span>Platform Operator Console &middot; Protected Superadmin Surface</span>
            <Shield className="h-3.5 w-3.5 text-indigo-400" />
          </div>
        </footer>
      </div>
    </div>
  );
}
