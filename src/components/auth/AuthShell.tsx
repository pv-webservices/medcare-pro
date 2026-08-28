import type { ReactNode } from "react";
import AuthCard from "@/components/auth/AuthCard";
import AuthLayout from "@/components/auth/AuthLayout";

/**
 * Back-compatible wrapper: layout plus card in one.
 *
 * WHAT THIS USED TO BE. A 1200px split card with a stock photograph, three
 * floating stat cards carrying invented numbers, a testimonial and a language
 * chip that did nothing. It was replaced rather than adjusted: the numbers were
 * fabricated product data on a public page, the photograph was the loudest
 * thing on a screen whose job is a form, and none of it survived contact with a
 * phone.
 *
 * WHY THE NAME SURVIVED. /forgot-password and /reset-password render their
 * forms into it, and they are not part of this redesign's scope. Keeping the
 * component and changing what it draws moved those two screens onto the new
 * design system without touching their logic at all.
 *
 * New screens should compose AuthLayout and AuthCard directly - that is the
 * pair this delegates to - which is what /login, /signup and /verify-email do.
 */
export default function AuthShell({ children }: { children: ReactNode }) {
  return (
    <AuthLayout>
      <AuthCard>{children}</AuthCard>
    </AuthLayout>
  );
}
