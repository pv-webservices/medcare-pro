import type { ReactNode } from "react";

interface OwnerLayoutProps {
  children: ReactNode;
}

/**
 * Shell for the platform surface — Stage 2.
 *
 * Deliberately does NO authorization. `/owner/login` has to render without a
 * session, so the gate lives in each page instead: `/owner/dashboard` calls
 * `requirePlatformOwner()`. Putting it here would either lock the login page
 * out or tempt a later page into relying on a check it cannot see.
 */
export default function OwnerLayout({ children }: OwnerLayoutProps) {
  return <main className="min-h-screen bg-slate-950 text-slate-100">{children}</main>;
}
