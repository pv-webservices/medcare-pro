import type { ReactNode } from "react";

interface DashboardLayoutProps {
  children: ReactNode;
}

/**
 * Shared shell for all signed-in pages. SCAFFOLD ONLY.
 *
 * TODO(clinics stage): sidebar nav + the clinic switcher. The switcher lists
 * only clinics belonging to the session's tenant, and the selected clinic
 * scopes every page below it. Note that selection is a UI convenience only —
 * the API must re-verify clinic ownership on every request regardless of what
 * the switcher sent (see lib/rbac.ts).
 *
 * Route protection itself lives in src/middleware.ts (FR-1.2), not here.
 */
export default function DashboardLayout({ children }: DashboardLayoutProps) {
  return <div className="min-h-screen">{children}</div>;
}
