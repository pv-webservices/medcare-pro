import Link from "next/link";
import { AlertCircle } from "lucide-react";
import AuthShell from "@/components/auth/AuthShell";
import ResetPasswordForm from "@/components/auth/ResetPasswordForm";
import { prisma } from "@/lib/prisma";
import { isPasswordResetTokenLive, RESET_LINK_INVALID_MESSAGE } from "@/lib/passwordReset";
import { MIN_PASSWORD_LENGTH } from "@/lib/signupInput";

/**
 * "Choose a new password" — the page the emailed link opens.
 *
 * A SERVER COMPONENT, unlike every other screen in this route group, and that is
 * the point. It checks the token is live before rendering anything, so a stale
 * link says so immediately instead of after the user has typed a password twice.
 *
 * THE CHECK IS A FUNCTION CALL, NOT AN ENDPOINT. `isPasswordResetTokenLive` runs
 * here on the server; there is no "is this token valid?" route for anyone to
 * probe, and the check consumes nothing — the token is spent only by the POST
 * that carries a new password.
 *
 * A live token still proves nothing by the time the form is submitted: the
 * confirm route re-validates and re-consumes inside its transaction. This is a
 * courtesy to the user, not a security gate.
 */

export const dynamic = "force-dynamic";

interface ResetPasswordPageProps {
  searchParams: Promise<{ token?: string | string[] }>;
}

/** A repeated `?token=` yields an array; neither half is trustworthy, so refuse. */
function readToken(raw: string | string[] | undefined): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const params = await searchParams;
  const token = readToken(params.token);
  const isLive = token ? await isPasswordResetTokenLive(prisma, token) : false;

  if (!token || !isLive) {
    return (
      <AuthShell>
        <div className="mb-8">
          <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-alert-bg text-alert-ink">
            <AlertCircle className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-ink">
            This link has expired
          </h1>
          <p role="status" className="mt-3 text-sm text-muted">
            {RESET_LINK_INVALID_MESSAGE}
          </p>
        </div>

        <p className="rounded-xl bg-canvas-deep p-3 text-sm text-ink">
          Reset links work once and last 24 hours. Requesting a new one also
          cancels any older link still sitting in your inbox.
        </p>

        <Link
          href="/forgot-password"
          className="mt-8 flex w-full justify-center rounded-xl bg-primary hover:bg-primary-hover py-3.5 px-4 text-sm font-semibold text-accent-ink shadow-neu-raised-sm focus:ring-primary transition-colors"
        >
          Request a new link
        </Link>

        <p className="mt-6 text-center text-sm text-muted">
          <Link href="/login" className="font-semibold text-accent hover:text-accent">
            Back to sign in
          </Link>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <ResetPasswordForm token={token} minPasswordLength={MIN_PASSWORD_LENGTH} />
    </AuthShell>
  );
}
