"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Mail, MailCheck } from "lucide-react";
import AuthAlert from "@/components/auth/AuthAlert";
import AuthButton, { authLinkClasses } from "@/components/auth/AuthButton";
import AuthField from "@/components/auth/AuthField";
import AuthFooter from "@/components/auth/AuthFooter";
import AuthHeader from "@/components/auth/AuthHeader";
import AuthShell from "@/components/auth/AuthShell";
import VerificationBadge from "@/components/auth/VerificationBadge";
import {
  describeResetRequest,
  RESET_REQUEST_FAILED_MESSAGE,
  type ResetRequestOutcome,
} from "@/components/auth/passwordResetState";

/**
 * "Forgot password?" — step one of two.
 *
 * NOT A PRD SCREEN. §6.1 stops at login; this flow was added on request. See the
 * header of src/lib/passwordReset.ts for what it does and does not authorise.
 *
 * The address is prefilled from `?email=` when the login page hands one over, so
 * a user who has already typed it does not type it again. That parameter is
 * forgeable and is treated as nothing more than a default field value — it is
 * never rendered as a claim about an account, and the server re-reads the
 * address from the submitted body regardless.
 */

function ForgotPasswordContent() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(() => searchParams.get("email") ?? "");
  const [outcome, setOutcome] = useState<ResetRequestOutcome | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    setOutcome(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      // Status only — the body is deliberately never read. See the note in
      // components/auth/passwordResetState.ts.
      setOutcome(describeResetRequest(response.status));
    } catch {
      setOutcome({
        kind: "failed",
        message: RESET_REQUEST_FAILED_MESSAGE,
        sent: false,
        offerSignup: false,
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  if (outcome?.sent) {
    return (
      <AuthShell>
        <AuthHeader
          badge={
            <VerificationBadge tone="success">
              <MailCheck className="h-6 w-6" strokeWidth={1.9} />
            </VerificationBadge>
          }
          title="Check your inbox"
          description={outcome.message}
        />

        <AuthAlert tone="info">
          The link works once and expires in 24 hours. If it does not arrive,
          check your spam folder before requesting another.
        </AuthAlert>

        <Link
          href="/login"
          className="mt-6 flex min-h-[46px] items-center justify-center gap-2 rounded-[14px] text-[14px] font-semibold text-auth-muted transition-colors duration-150 hover:bg-auth-bg-tint hover:text-auth-ink"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to sign in
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <AuthHeader
        title="Reset your password"
        description="Enter the email you signed up with and we will send you a link to choose a new password."
      />

      {/*
        `method="post"` for the same reason as every other credential form here:
        a <form> with no `method` defaults to GET, so a submit landing before
        hydration would put the fields in the URL and in history. This one
        carries the address being reset. Longer note in
        src/components/auth/ResetPasswordForm.tsx.
      */}
      <form method="post" onSubmit={handleSubmit} className="space-y-5">
        {outcome && (
          <AuthAlert
            id="forgot-password-error"
            tone="error"
            action={
              outcome.offerSignup ? (
                <Link
                  href={`/signup?email=${encodeURIComponent(email)}`}
                  className={authLinkClasses}
                >
                  Create an account
                </Link>
              ) : undefined
            }
          >
            {outcome.message}
          </AuthAlert>
        )}

        <AuthField
          id="forgot-password-email"
          name="email"
          type="email"
          label="Email"
          autoComplete="email"
          required
          autoFocus
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          icon={<Mail className="h-[18px] w-[18px]" strokeWidth={2} />}
          aria-invalid={outcome ? true : undefined}
          describedBy={outcome ? "forgot-password-error" : undefined}
          placeholder="you@clinic.com"
        />

        <AuthButton
          type="submit"
          isBusy={isSubmitting}
          busyLabel="Sending..."
          className="mt-1"
        >
          Email me a reset link
        </AuthButton>

        <Link
          href="/login"
          className="flex min-h-[46px] items-center justify-center gap-2 rounded-[14px] text-[14px] font-semibold text-auth-muted transition-colors duration-150 hover:bg-auth-bg-tint hover:text-auth-ink"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to sign in
        </Link>
      </form>

      <AuthFooter>
        Don&apos;t have an account?{" "}
        <Link href="/signup" className={authLinkClasses}>
          Create one
        </Link>
      </AuthFooter>
    </AuthShell>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <ForgotPasswordContent />
    </Suspense>
  );
}
