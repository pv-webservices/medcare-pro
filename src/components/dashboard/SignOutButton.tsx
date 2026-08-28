"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";
import { cx, menuItemClasses } from "@/components/ui";

/**
 * Ends the session and returns to the login screen.
 *
 * TWO STEPS, IN THIS ORDER, AND WHY. `signOut()` alone only clears the cookie —
 * the `app_sessions` row behind it stays live until it expires, so a copy of the
 * JWT taken beforehand would keep working after the user believed they had
 * logged out. Stage 4's "remember this device" stretches that window from 12
 * hours to 30 days, so the revocation is no longer optional.
 *
 * Revoke first, then clear: if the browser is closed between the two steps, the
 * server-side session is already dead and the stale cookie is inert. The other
 * order would leave a live session the user can no longer reach the endpoint to
 * revoke.
 *
 * A failed revoke still proceeds to `signOut()`. Trapping the user in a signed-in
 * UI because the network blipped is worse than clearing the cookie and leaving
 * the row to expire — and "sign out of all devices" remains available to finish
 * the job properly.
 *
 * ONE IMPLEMENTATION, TWO APPEARANCES. It is a row in the account menu on
 * desktop and a button in the mobile drawer; both run this exact sequence,
 * because a second copy of it is a second chance to get the order wrong.
 */

interface SignOutButtonProps {
  appearance?: "menuItem" | "button";
  className?: string;
}

export default function SignOutButton({
  appearance = "menuItem",
  className,
}: SignOutButtonProps) {
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    setIsSigningOut(true);

    try {
      await fetch("/api/auth/sessions/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
    } catch {
      // Deliberately swallowed — see the note above on why sign-out proceeds.
    }

    await signOut({ callbackUrl: "/login" });
  }

  return (
    <button
      type="button"
      role={appearance === "menuItem" ? "menuitem" : undefined}
      onClick={handleSignOut}
      disabled={isSigningOut}
      aria-busy={isSigningOut || undefined}
      className={cx(
        appearance === "menuItem"
          ? menuItemClasses(false, "danger")
          : "flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-line bg-canvas text-body font-medium text-ink shadow-card transition-colors duration-150 hover:bg-canvas-deep",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
    >
      <LogOut aria-hidden="true" strokeWidth={2} className="h-4 w-4 shrink-0" />
      {isSigningOut ? "Signing out..." : "Sign out"}
    </button>
  );
}
