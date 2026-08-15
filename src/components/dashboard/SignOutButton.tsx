"use client";

import { signOut } from "next-auth/react";

/** Ends the session and returns to the login screen. */
export default function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/login" })}
      className="min-h-11 rounded border border-black/20 px-3 text-sm font-medium dark:border-white/25"
    >
      Log Out
    </button>
  );
}
