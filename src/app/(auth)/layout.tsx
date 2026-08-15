import type { ReactNode } from "react";

interface AuthLayoutProps {
  children: ReactNode;
}

/** Shell for unauthenticated screens. SCAFFOLD ONLY. */
export default function AuthLayout({ children }: AuthLayoutProps) {
  return <main className="min-h-screen">{children}</main>;
}
