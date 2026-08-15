import type { ReactNode } from "react";

interface DashboardLayoutProps {
  children: ReactNode;
}

/**
 * Shared sidebar/nav shell for all admin pages. SCAFFOLD ONLY.
 * TODO(auth stage): guard this layout — unauthenticated users redirect to /login (FR-1.2).
 */
export default function DashboardLayout({ children }: DashboardLayoutProps) {
  return <div className="min-h-screen">{children}</div>;
}
