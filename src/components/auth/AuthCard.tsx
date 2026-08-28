import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";

/**
 * The white surface the form sits on.
 *
 * A HAIRLINE AND A LOW SHADOW, nothing else. The page behind it is a cool
 * near-white, so the card separates on a 3% value step plus a 1px border —
 * enough to read as a distinct object, not enough to look like a modal that
 * has landed on the page by accident.
 *
 * It keeps its border on mobile too. A full-bleed white form on a white-ish
 * page loses its edges entirely, and an auth form with no visible boundary
 * reads as an unfinished page rather than a focused one.
 */
export default function AuthCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cx(
        "rounded-[20px] border border-auth-line bg-auth-card p-6 shadow-auth-card sm:p-8",
        className,
      )}
    >
      {children}
    </section>
  );
}
