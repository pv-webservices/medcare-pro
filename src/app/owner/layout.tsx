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
 *
 * WHY data-theme IS PINNED HERE. This surface has always been dark — it is the
 * platform operator's console, visually separate from any tenant's clinic so
 * that nobody confuses "our records" with "everyone's records". It used to get
 * that from its own hand-rolled slate ramp, which meant a second, unmaintained
 * palette living beside the real one.
 *
 * Scoping the dark theme to this subtree instead means the owner panel is the
 * same design system in its other mode: one set of tokens, one depth
 * vocabulary, and the dark theme is now exercised by a screen someone actually
 * uses rather than existing only behind a toggle. Custom properties cascade, so
 * the attribute works on a div exactly as it does on <html> — and it overrides
 * whatever next-themes has set above it, which is the point: an operator who
 * prefers the butter theme still gets the dark console.
 */
export default function OwnerLayout({ children }: OwnerLayoutProps) {
  return (
    <main data-theme="dark" className="min-h-screen bg-canvas text-ink">
      {children}
    </main>
  );
}
