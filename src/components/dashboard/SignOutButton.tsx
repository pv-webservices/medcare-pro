"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";

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
 */
export default function SignOutButton() {
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
      onClick={handleSignOut}
      disabled={isSigningOut}
      className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-canvas text-body font-semibold text-muted shadow-neu-raised-sm transition-shadow duration-200 hover:text-ink hover:shadow-neu-raised active:shadow-neu-pressed disabled:opacity-60 disabled:shadow-none"
    >
      <LogOut aria-hidden="true" strokeWidth={2} className="h-4 w-4" />
      {isSigningOut ? "Logging out…" : "Log out"}
    </button>
  );
}
