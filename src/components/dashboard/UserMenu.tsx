"use client";

import Link from "next/link";
import { ChevronDown, Settings, UserRound } from "lucide-react";
import {
  UserAvatar,
  Menu,
  MenuSeparator,
  menuItemClasses,
  cx,
} from "@/components/ui";
import SignOutButton from "@/components/dashboard/SignOutButton";

interface UserMenuProps {
  name: string;
  /** The role held in the current scope, already resolved by the layout. */
  role: string;
  /** "Clinic A" or "All clinics" — the scope the app is currently showing. */
  scopeLabel: string;
  photoUrl?: string | null;
  gender?: string | null;
  className?: string;
}

export default function UserMenu({
  name,
  role,
  scopeLabel,
  photoUrl,
  gender,
  className,
}: UserMenuProps) {
  return (
    <Menu
      label="Account"
      align="end"
      panelClassName="w-[18rem] bg-white border-slate-200 shadow-xl rounded-2xl"
      className={cx("w-auto", className)}
      trigger={({ isOpen }) => (
        <span
          className={cx(
            "flex items-center gap-2.5 rounded-2xl border py-1 pl-1 pr-2 transition-all duration-150 cursor-pointer",
            isOpen
              ? "border-slate-300 bg-slate-100/80"
              : "border-transparent hover:border-slate-200 hover:bg-slate-50",
          )}
        >
          <UserAvatar
            name={name}
            photoUrl={photoUrl}
            gender={gender}
            size="sm"
          />
          <span className="hidden min-w-0 text-left sm:block">
            <span className="block max-w-[9rem] truncate text-xs sm:text-sm font-semibold text-slate-900 leading-tight">
              {name}
            </span>
            <span className="block max-w-[9rem] truncate text-[11px] text-slate-500 capitalize leading-tight mt-0.5">
              {role}
            </span>
          </span>
          <ChevronDown
            aria-hidden="true"
            strokeWidth={2}
            className={cx(
              "h-4 w-4 shrink-0 text-slate-400 transition-transform duration-150 ml-0.5",
              isOpen && "rotate-180 text-indigo-600",
            )}
          />
        </span>
      )}
    >
      <div className="flex items-center gap-3 px-3.5 py-3">
        <UserAvatar
          name={name}
          photoUrl={photoUrl}
          gender={gender}
          size="md"
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{name}</p>
          <p className="truncate text-xs capitalize text-slate-500">
            {role} &middot; {scopeLabel}
          </p>
        </div>
      </div>

      <MenuSeparator />

      <Link
        href="/settings"
        role="menuitem"
        className={cx(menuItemClasses(), "text-slate-700 hover:text-slate-900")}
      >
        <Settings aria-hidden="true" strokeWidth={2} className="h-4 w-4 shrink-0 text-slate-400" />
        Settings
      </Link>

      <Link
        href="/team"
        role="menuitem"
        className={cx(menuItemClasses(), "text-slate-700 hover:text-slate-900")}
      >
        <UserRound aria-hidden="true" strokeWidth={2} className="h-4 w-4 shrink-0 text-slate-400" />
        Team
      </Link>

      <MenuSeparator />

      <SignOutButton />
    </Menu>
  );
}
