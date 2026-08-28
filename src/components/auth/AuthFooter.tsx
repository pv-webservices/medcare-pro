import type { ReactNode } from "react";

/**
 * The line under the card: "Don't have an account? Create one".
 *
 * OUTSIDE THE CARD, deliberately. It is a way off this screen rather than a
 * part of the task on it, and keeping it off the white surface stops it
 * competing with the primary action for the same attention.
 */
export default function AuthFooter({ children }: { children: ReactNode }) {
  return (
    <p className="mt-6 text-center text-[13.5px] text-auth-muted">{children}</p>
  );
}
