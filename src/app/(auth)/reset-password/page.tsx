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
          <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-red-100 text-red-700">
            <AlertCircle className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-slate-900">
            This link has expired
          </h1>
          <p role="status" className="mt-3 text-sm text-slate-500">
            {RESET_LINK_INVALID_MESSAGE}
          </p>
        </div>

        <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          Reset links work once and last 24 hours. Requesting a new one also
          cancels any older link still sitting in your inbox.
        </p>

        <Link
          href="/forgot-password"
          className="mt-8 flex w-full justify-center rounded-xl bg-primary hover:bg-primary-hover py-3.5 px-4 text-sm font-semibold text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 transition-colors"
        >
          Request a new link
        </Link>

        <p className="mt-6 text-center text-sm text-slate-500">
          <Link href="/login" className="font-semibold text-violet-600 hover:text-violet-700">
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
