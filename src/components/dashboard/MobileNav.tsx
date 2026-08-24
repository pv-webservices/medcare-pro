"use client";

import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, Plus, X } from "lucide-react";
import DashboardNav from "@/components/dashboard/DashboardNav";
import type { NavLink } from "@/lib/navigation";

/**
 * Navigation for viewports below `lg` — Stage fix.
 *
 * THE BUG THIS FIXES. The sidebar in src/app/(dashboard)/layout.tsx is
 * `hidden lg:flex`, and it was the ONLY navigation in the signed-in app. Under
 * 1024px it disappeared and nothing replaced it: no menu button, no drawer, no
 * tab bar. Every module — Appointments, Registrations, Doctors, Clinics,
 * Reports, Team, Settings — became unreachable, and the user was left on
 * whatever page they had landed on with no way off it. On a laptop at 150%
 * display scaling, or any tablet held in portrait, the entire product was one
 * screen. It reads as "the tabs don't work"; it was the tabs not being rendered.
 *
 * A front desk runs this on a shared tablet, so this is not an edge case — it is
 * one of the primary devices named in the PRD.
 *
 * The link list is NOT rebuilt here. It arrives already filtered by permission
 * and feature from the layout, and is handed to the same <DashboardNav /> the
 * sidebar uses, so the two can never drift apart or disagree about what this
 * user may see.
 */

interface MobileNavProps {
  links: readonly NavLink[];
  unreadNotifications: number;
}

export default function MobileNav({
  links,
  unreadNotifications,
}: MobileNavProps) {
  const pathname = usePathname();
  const panelId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  /**
   * THE DRAWER MUST CLOSE ON NAVIGATION, and this is why it is stored as a
   * path rather than a boolean.
   *
   * The layout persists across navigations in the App Router, so the drawer is
   * never unmounted by a route change. A plain `isOpen` boolean would leave the
   * panel sitting on top of the page the user just asked for — which reads as
   * the tap having done nothing, the very symptom this component exists to fix.
   *
   * Recording WHICH path it was opened on makes "still open" a derived value:
   * the moment `pathname` changes, `openedOnPath` no longer matches and the
   * drawer is closed, with no effect and no second render. Syncing a boolean
   * from a `useEffect` on `pathname` would do the same thing one render late,
   * and is what react-hooks/set-state-in-effect correctly warns about.
   *
   * It also covers a Back press and any other navigation the drawer did not
   * initiate, because it keys off the route rather than off the click.
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
      <div className="flex items-center justify-between gap-3 px-4 pt-4">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-ink shadow-neu-accent"
          >
            <Plus strokeWidth={3} className="h-5 w-5" />
          </span>
          <span className="truncate text-section font-extrabold leading-none text-ink">
            MedCare Pro
          </span>
        </div>

        <button
          type="button"
          onClick={openDrawer}
          aria-expanded={isOpen}
          aria-controls={panelId}
          aria-label="Open navigation menu"
          className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-canvas text-ink shadow-neu-raised-sm transition-shadow duration-200 active:shadow-neu-pressed"
        >
          <Menu aria-hidden="true" strokeWidth={2} className="h-5 w-5" />
          {/*
            Mirrors the sidebar's unread badge. Without it, the one signal that
            there is something to look at is hidden inside a closed drawer.
          */}
          {unreadNotifications > 0 && (
            <span
              aria-hidden="true"
              className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-accent ring-2 ring-canvas"
            />
          )}
        </button>
      </div>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex">
          {/*
            The scrim is a real button rather than a div with onClick so that
            "dismiss" is reachable by keyboard and announced, not mouse-only.
          */}
          <button
            type="button"
            aria-label="Close navigation menu"
            onClick={closeDrawer}
            className="absolute inset-0 h-full w-full cursor-default bg-ink/30"
          />

          <div
            id={panelId}
            role="dialog"
            aria-modal="true"
            aria-label="Main navigation"
            className="relative flex h-full w-[280px] max-w-[85vw] flex-col overflow-y-auto bg-canvas p-5 shadow-neu-raised"
          >
            <div className="mb-6 flex items-center justify-between gap-3">
              <span className="truncate text-section font-extrabold leading-none text-ink">
                Menu
              </span>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={closeDrawer}
                aria-label="Close navigation menu"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-canvas text-ink shadow-neu-raised-sm transition-shadow duration-200 active:shadow-neu-pressed"
              >
                <X aria-hidden="true" strokeWidth={2} className="h-5 w-5" />
              </button>
            </div>

            {/*
              Closes on any click inside the nav, which covers the one case the
              path-derived state above cannot: tapping the link for the page you
              are ALREADY on. The route never changes, so `openedOnPath` would
              still match and the drawer would stay open on top of the page the
              user just asked for. A click handler on the container catches it
              without wrapping every <Link>.
            */}
            <div onClick={closeDrawer}>
              <DashboardNav
                links={links}
                unreadNotifications={unreadNotifications}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
