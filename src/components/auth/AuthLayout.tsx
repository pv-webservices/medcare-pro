import type { ReactNode } from "react";
import AuthBrandMark from "@/components/auth/AuthBrandMark";
import AuthBrandPanel from "@/components/auth/AuthBrandPanel";
import { cx } from "@/components/ui/cx";

/**
 * The shell every unauthenticated screen sits in.
 *
 * TWO COLUMNS ON DESKTOP, ONE EVERYWHERE ELSE. 42% brand panel, 58% form — the
 * form gets the larger share because it is the reason the page exists. Below
 * `lg` the panel is gone and the form is the page.
 *
 * `.auth-scope` IS LOAD-BEARING, not a naming convention. It carries the
 * light-only palette, the indigo focus ring and the autofill repaint defined at
 * the bottom of globals.css. Every auth screen must render inside it, which is
 * why they all come through here rather than each building their own wrapper.
 *
 * A SERVER COMPONENT. The interactive forms passed in as `children` carry their
 * own "use client"; the chrome around them does not need to.
 */

interface AuthLayoutProps {
  children: ReactNode;
  /**
   * `wide` is for the signup form only, which has eight fields and needs the
   * room to pair them up. Everything else stays at the narrower measure, where
   * a single column of fields reads fastest.
   */
  width?: "default" | "wide";
}

const WIDTHS: Record<"default" | "wide", string> = {
  default: "max-w-[452px]",
  wide: "max-w-[560px]",
};

export default function AuthLayout({
  children,
  width = "default",
}: AuthLayoutProps) {
  return (
    <div className="auth-scope flex min-h-screen bg-auth-bg text-auth-ink">
      <AuthBrandPanel />

      <div className="flex min-h-screen w-full flex-col">
        {/* The brand only appears here once the panel is gone. */}
        <header className="px-5 pt-6 sm:px-8 lg:hidden">
          <AuthBrandMark size="sm" />
        </header>

        <main className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8 sm:py-12 lg:px-12">
          <div className={cx("auth-enter w-full", WIDTHS[width])}>{children}</div>
        </main>

        <footer className="px-5 pb-8 text-center text-[12px] text-auth-faint sm:px-8">
          <p>&copy; {new Date().getFullYear()} MedCare Pro &middot; Encrypted sign-in</p>
        </footer>
      </div>
    </div>
  );
}
