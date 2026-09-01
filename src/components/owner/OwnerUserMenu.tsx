"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Building2,
  ChevronDown,
  LayoutGrid,
  Layers,
  LogOut,
  ScrollText,
  Shield,
  ToggleLeft,
} from "lucide-react";
import { signOut } from "next-auth/react";
import { Menu, MenuSeparator, menuItemClasses, cx } from "@/components/ui";

interface OwnerUserMenuProps {
  user: {
    name: string;
    email?: string | null;
    platformRole?: string;
  };
  className?: string;
}

export default function OwnerUserMenu({ user, className }: OwnerUserMenuProps) {
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    setIsSigningOut(true);

    try {
      await fetch("/api/auth/sessions/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
    } catch {
      // Deliberately swallowed — revoke error does not prevent sign out
    }

    await signOut({ callbackUrl: "/owner/login" });
  }

  return (
    <Menu
      label="Superadmin account"
      align="end"
      panelClassName="w-[18rem] bg-[#0d1427]/95 border-slate-700/60 shadow-2xl backdrop-blur-xl"
      className={cx("w-auto", className)}
      trigger={({ isOpen }) => (
        <span
          className={cx(
            "flex cursor-pointer items-center gap-2.5 rounded-xl border px-2.5 py-1.5 transition-all duration-150",
            isOpen
              ? "border-indigo-500/40 bg-indigo-950/40 shadow-sm"
              : "border-slate-800/80 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-800/50",
          )}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-indigo-500/30 bg-gradient-to-br from-indigo-500/20 to-purple-600/30 text-indigo-400 shadow-sm">
            <Shield className="h-4 w-4" />
          </div>
          <span className="hidden min-w-0 text-left sm:block">
            <span className="block max-w-[9rem] truncate text-xs font-semibold text-white">
              {user.name || "Superadmin"}
            </span>
            <span className="block max-w-[9rem] truncate text-[11px] font-medium text-slate-400">
              Platform Owner
            </span>
          </span>
          <ChevronDown
            aria-hidden="true"
            strokeWidth={2}
            className={cx(
              "h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-150",
              isOpen && "rotate-180 text-indigo-400",
            )}
          />
        </span>
      )}
    >
      <div className="flex items-center gap-3 px-3.5 py-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-indigo-500/30 bg-gradient-to-br from-indigo-500/20 to-purple-600/30 text-indigo-400 shadow-sm">
          <Shield className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-white">
            {user.name || "Superadmin"}
          </p>
          {user.email && (
            <p className="truncate text-[11px] text-slate-400">{user.email}</p>
          )}
          <span className="mt-1 inline-block rounded-md border border-indigo-500/30 bg-indigo-950/60 px-1.5 py-0.5 text-[10px] font-medium text-indigo-300">
            Superadmin
          </span>
        </div>
      </div>

      <MenuSeparator />

      <div className="px-1.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        Navigation
      </div>

      <Link
        href="/owner/dashboard"
        role="menuitem"
        className={cx(
          menuItemClasses(),
          "text-slate-300 hover:bg-slate-800/60 hover:text-white",
        )}
      >
        <LayoutGrid aria-hidden="true" strokeWidth={2} className="h-4 w-4 shrink-0 text-indigo-400" />
        Overview
      </Link>

      <Link
        href="/owner/applications"
        role="menuitem"
        className={cx(
          menuItemClasses(),
          "text-slate-300 hover:bg-slate-800/60 hover:text-white",
        )}
      >
        <Building2 aria-hidden="true" strokeWidth={2} className="h-4 w-4 shrink-0 text-indigo-400" />
        Clinic applications
      </Link>

      <Link
        href="/owner/features"
        role="menuitem"
        className={cx(
          menuItemClasses(),
          "text-slate-300 hover:bg-slate-800/60 hover:text-white",
        )}
      >
        <ToggleLeft aria-hidden="true" strokeWidth={2} className="h-4 w-4 shrink-0 text-indigo-400" />
        Platform features
      </Link>

      <Link
        href="/owner/plans"
        role="menuitem"
        className={cx(
          menuItemClasses(),
          "text-slate-300 hover:bg-slate-800/60 hover:text-white",
        )}
      >
        <Layers aria-hidden="true" strokeWidth={2} className="h-4 w-4 shrink-0 text-indigo-400" />
        Plans
      </Link>

      <Link
        href="/owner/audit"
        role="menuitem"
        className={cx(
          menuItemClasses(),
          "text-slate-300 hover:bg-slate-800/60 hover:text-white",
        )}
      >
        <ScrollText aria-hidden="true" strokeWidth={2} className="h-4 w-4 shrink-0 text-indigo-400" />
        Activity log
      </Link>

      <MenuSeparator />

      <button
        type="button"
        role="menuitem"
        onClick={handleSignOut}
        disabled={isSigningOut}
        className={cx(
          menuItemClasses(false, "danger"),
          "text-rose-300 hover:bg-rose-950/40 hover:text-rose-200",
        )}
      >
        <LogOut aria-hidden="true" strokeWidth={2} className="h-4 w-4 shrink-0" />
        {isSigningOut ? "Signing out…" : "Log out"}
      </button>
    </Menu>
  );
}
