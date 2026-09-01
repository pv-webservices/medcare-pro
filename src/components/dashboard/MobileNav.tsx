"use client";

import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu as MenuIcon, X } from "lucide-react";
import DashboardNav from "@/components/dashboard/DashboardNav";
import ClinicSwitcher, {
  type ClinicOption,
} from "@/components/dashboard/ClinicSwitcher";
import SignOutButton from "@/components/dashboard/SignOutButton";
import BrandMark from "@/components/dashboard/BrandMark";
import { Avatar, IconButton } from "@/components/ui";
import type { NavLink } from "@/lib/navigation";

/**
 * Navigation for viewports below `lg`.
 *
 * THE BUG THIS ORIGINALLY FIXED, still worth knowing: the sidebar is
 * `hidden lg:flex`, and it was once the only navigation in the signed-in app.
 * Under 1024px every module became unreachable. A front desk runs this on a
 * shared tablet, so that is not an edge case — it is one of the primary devices
 * named in the PRD.
 *
 * ONE SLIDE-OVER, NOT A BOTTOM BAR. The module list is permission-dependent and
 * runs from four entries to ten, which a fixed five-slot tab bar cannot hold
 * without hiding exactly the module a given role lives in. The drawer carries
 * the same list as the sidebar, in the same order, with the clinic switcher at
 * the top where scope is decided.
 *
 * The link list is NOT rebuilt here. It arrives already filtered by permission
 * and feature from the layout, and is handed to the same <DashboardNav /> the
 * sidebar uses, so the two can never drift apart or disagree.
 */

interface MobileNavProps {
  links: readonly NavLink[];
  unreadNotifications: number;
  clinics: readonly ClinicOption[];
  selectedClinicId: string | null;
  userName: string;
  roleName: string;
}

export default function MobileNav({
  links,
  unreadNotifications,
  clinics,
  selectedClinicId,
  userName,
  roleName,
}: MobileNavProps) {
  const pathname = usePathname();
  const panelId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  /**
   * THE DRAWER MUST CLOSE ON NAVIGATION, and this is why it is stored as a path
   * rather than a boolean.
   *
   * The layout persists across navigations in the App Router, so the drawer is
   * never unmounted by a route change. A plain `isOpen` boolean would leave the
   * panel sitting on top of the page the user just asked for — which reads as
   * the tap having done nothing.
   *
   * Recording WHICH path it was opened on makes "still open" a derived value:
   * the moment `pathname` changes, `openedOnPath` no longer matches and the
   * drawer is closed, with no effect and no second render. It also covers a Back
   * press and any other navigation the drawer did not initiate.
   */
  const [openedOnPath, setOpenedOnPath] = useState<string | null>(null);
  const isOpen = openedOnPath === pathname;

  function openDrawer() {
    setOpenedOnPath(pathname);
  }

  function closeDrawer() {
    setOpenedOnPath(null);
  }

  /** Escape closes, and focus moves to the close button when it opens. */
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeDrawer();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  /**
   * Stop the page behind the drawer scrolling under the user's finger. Restored
   * on close AND on unmount — an unmount while open (a sign-out, say) would
   * otherwise leave the whole app unscrollable.
   */
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isOpen]);

  return (
    <div className="lg:hidden">
      <IconButton
        label="Open navigation menu"
        isOutlined
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={openDrawer}
        className="relative"
      >
        <MenuIcon aria-hidden="true" strokeWidth={2} className="h-5 w-5" />
        {unreadNotifications > 0 && (
          <span
            aria-hidden="true"
            className="absolute right-2 top-2 h-2 w-2 rounded-full bg-indigo-600 ring-2 ring-white"
          />
        )}
      </IconButton>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex">
          <button
            type="button"
            aria-label="Close navigation menu"
            onClick={closeDrawer}
            className="overlay-in absolute inset-0 h-full w-full cursor-default bg-black/70 backdrop-blur-xs"
          />

          <div
            id={panelId}
            role="dialog"
            aria-modal="true"
            aria-label="Main navigation"
            className="panel-in relative flex h-full w-[290px] max-w-[86vw] flex-col border-r border-slate-800 bg-[#090e23] text-white shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-800/80 px-4 py-3.5">
              <BrandMark isCompact={false} showAction={false} />
              <IconButton
                ref={closeButtonRef}
                label="Close navigation menu"
                size="sm"
                onClick={closeDrawer}
                className="text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X aria-hidden="true" strokeWidth={2} className="h-4 w-4" />
              </IconButton>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
              <div className="mb-5">
                <ClinicSwitcher
                  clinics={clinics}
                  selectedClinicId={selectedClinicId}
                  variant="sidebar"
                />
              </div>

              <DashboardNav
                links={links}
                unreadNotifications={unreadNotifications}
                onNavigate={closeDrawer}
              />
            </div>

            <div className="border-t border-slate-800/80 px-3.5 py-3.5">
              <div className="mb-3 flex items-center gap-2.5 px-1">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-xs font-semibold text-white shadow-2xs">
                  <Avatar name={userName} size="sm" className="bg-transparent text-white font-semibold" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-xs sm:text-sm font-semibold text-white">
                    {userName}
                  </p>
                  <p className="truncate text-[11px] capitalize text-slate-400">
                    {roleName}
                  </p>
                </div>
              </div>
              <SignOutButton
                appearance="button"
                className="border-slate-700/60 bg-slate-900/60 text-slate-300 hover:bg-rose-950/30 hover:text-rose-300"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
