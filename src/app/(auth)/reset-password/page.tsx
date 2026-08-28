import Link from "next/link";
import { AlertCircle } from "lucide-react";
import AuthAlert from "@/components/auth/AuthAlert";
import { authButtonClasses, authLinkClasses } from "@/components/auth/AuthButton";
import AuthFooter from "@/components/auth/AuthFooter";
import AuthHeader from "@/components/auth/AuthHeader";
import AuthShell from "@/components/auth/AuthShell";
import ResetPasswordForm from "@/components/auth/ResetPasswordForm";
import VerificationBadge from "@/components/auth/VerificationBadge";
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
        <AuthHeader
          badge={
            <VerificationBadge tone="error">
              <AlertCircle className="h-6 w-6" strokeWidth={1.9} />
            </VerificationBadge>
          }
          title="This link has expired"
          description={RESET_LINK_INVALID_MESSAGE}
        />

        <AuthAlert tone="info">
          Reset links work once and last 24 hours. Requesting a new one also
          cancels any older link still sitting in your inbox.
        </AuthAlert>

        {/*
          A link wearing the primary button's clothes, rather than a button
          inside a link: nesting two interactive elements gives a keyboard user
          two stops for one action and a screen reader a control it cannot name.
        */}
        <Link
          href="/forgot-password"
          className={authButtonClasses("primary", "mt-6")}
        >
          Request a new link
        </Link>

        <AuthFooter>
          <Link href="/login" className={authLinkClasses}>
            Back to sign in
          </Link>
        </AuthFooter>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <ResetPasswordForm token={token} minPasswordLength={MIN_PASSWORD_LENGTH} />
    </AuthShell>
  );
}
