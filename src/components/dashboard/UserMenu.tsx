"use client";

import Link from "next/link";
import { ChevronDown, Settings, UserRound } from "lucide-react";
import {
  Avatar,
  Menu,
  MenuSeparator,
  menuItemClasses,
  cx,
} from "@/components/ui";
import SignOutButton from "@/components/dashboard/SignOutButton";

/**
 * The account menu: who am I signed in as, in what role, over what scope, and
 * how do I leave.
 *
 * IT ANSWERS "WHOSE SESSION IS THIS" FIRST. A shared front-desk machine is the
 * normal case in a clinic, so the name, the role and the current clinic scope
 * are all stated in the panel rather than being something the user has to infer
 * from what the app will let them do.
 *
 * IT OFFERS ONLY WHAT EXISTS. Settings, team and sign out — no profile
 * page, no account preferences, no billing, because this application has none
 * of those and a menu item that 404s is worse than an absent one.
 *
 * The Settings link is shown to everyone who can see this menu. The Settings
 * screens run their own permission checks and show what the reader may open;
 * hiding the entry here would not add security, and would leave an admin
 * hunting for a URL.
 */

interface UserMenuProps {
  name: string;
  /** The role held in the current scope, already resolved by the layout. */
  role: string;
  /** "Clinic A" or "All clinics" — the scope the app is currently showing. */
  scopeLabel: string;
  className?: string;
}

export default function UserMenu({
  name,
  role,
  scopeLabel,
  className,
}: UserMenuProps) {
  return (
    <Menu
      label="Account"
      align="end"
      panelClassName="w-[17rem]"
      className={cx("w-auto", className)}
      trigger={({ isOpen }) => (
        <span
          className={cx(
            "flex items-center gap-2 rounded-xl border py-1.5 pl-1.5 pr-2 transition-colors duration-150",
            isOpen
              ? "border-line-strong bg-canvas-deep"
              : "border-transparent hover:border-line hover:bg-canvas-deep",
          )}
        >
          <Avatar name={name} size="sm" />
          <span className="hidden min-w-0 text-left md:block">
            <span className="block max-w-[10rem] truncate text-label font-semibold text-ink">
              {name}
            </span>
            <span className="block max-w-[10rem] truncate text-meta capitalize text-muted">
              {role}
            </span>
          </span>
          <ChevronDown
            aria-hidden="true"
            strokeWidth={2}
            className="h-4 w-4 shrink-0 text-faint"
          />
        </span>
      )}
    >
      <div className="flex items-center gap-3 px-3 py-2.5">
        <Avatar name={name} />
        <div className="min-w-0">
          <p className="truncate text-body font-semibold text-ink">{name}</p>
          <p className="truncate text-meta capitalize text-muted">
            {role} &middot; {scopeLabel}
          </p>
        </div>
      </div>

      <MenuSeparator />

      <Link href="/settings" role="menuitem" className={menuItemClasses()}>
        <Settings aria-hidden="true" strokeWidth={2} className="h-4 w-4 shrink-0" />
        Settings
      </Link>

      <Link href="/team" role="menuitem" className={menuItemClasses()}>
        <UserRound aria-hidden="true" strokeWidth={2} className="h-4 w-4 shrink-0" />
        Team
      </Link>

      <MenuSeparator />

      <SignOutButton />
    </Menu>
  );
}
