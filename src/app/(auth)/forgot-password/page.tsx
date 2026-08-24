"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertCircle, ArrowLeft, Mail, MailCheck } from "lucide-react";
import AuthShell from "@/components/auth/AuthShell";
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

const FIELD_CLASS =
  "block w-full rounded-2xl shadow-neu-inset py-3.5 pl-11 pr-4 text-sm text-ink placeholder:text-faint";

const PRIMARY_BUTTON_CLASS =
  "mt-2 flex w-full justify-center rounded-xl bg-primary hover:bg-primary-hover py-3.5 px-4 text-sm font-semibold text-accent-ink shadow-neu-raised-sm focus:ring-primary disabled:opacity-70 transition-colors";

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
        <div className="mb-8">
          <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-ok-bg text-ok-ink">
            <MailCheck className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-ink">
            Check your inbox
          </h1>
          <p role="status" aria-live="polite" className="mt-3 text-sm text-muted">
            {outcome.message}
          </p>
        </div>

        <p className="rounded-xl bg-canvas-deep p-3 text-sm text-ink">
          The link works once and expires in 24 hours. If it does not arrive, check
          your spam folder before requesting another.
        </p>

        <Link
          href="/login"
          className="mt-8 flex items-center justify-center gap-2 text-sm font-semibold text-accent hover:text-accent"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to sign in
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="mb-8">
        <h1 className="text-4xl font-bold tracking-tight text-ink">
          Reset your password
        </h1>
        <p className="mt-3 text-sm text-muted">
          Enter the email you signed up with and we will send you a link to choose a
          new password.
        </p>
      </div>

      {/*
        `method="post"` for the same reason as every other credential form here:
        a <form> with no `method` defaults to GET, so a submit landing before
        hydration would put the fields in the URL and in history. This one
        carries the address being reset. Longer note in
        src/components/auth/ResetPasswordForm.tsx.
      */}
      <form method="post" onSubmit={handleSubmit} className="space-y-6">
        {outcome && (
          <p
            id="forgot-password-error"
            role="alert"
            aria-live="assertive"
            className="flex items-start gap-2 rounded-xl bg-alert-bg p-3 text-sm text-alert-ink"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              <span className="font-semibold">Error:</span> {outcome.message}
              {outcome.offerSignup && (
                <>
                  {""}
                  <Link
                    href={`/signup?email=${encodeURIComponent(email)}`}
                    className="font-semibold underline hover:text-alert-ink"
                  >
                    Create an account
                  </Link>
                  .
                </>
              )}
            </span>
          </p>
        )}

        <div>
          <label
            htmlFor="forgot-password-email"
            className="block text-sm font-medium text-ink mb-2"
          >
            Email
          </label>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
              <Mail className="h-5 w-5 text-accent" aria-hidden="true" />
            </div>
            <input
              id="forgot-password-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              autoFocus
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={outcome ? true : undefined}
              aria-describedby={outcome ? "forgot-password-error" : undefined}
              placeholder="dr.amelia@dentalcare.com"
              className={FIELD_CLASS}
            />
          </div>
        </div>

        <button type="submit" disabled={isSubmitting} className={PRIMARY_BUTTON_CLASS}>
          {isSubmitting ? "Sending..." : "Email me a reset link"}
        </button>
      </form>

      <Link
        href="/login"
        className="mt-8 flex items-center justify-center gap-2 text-sm font-semibold text-accent hover:text-accent"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to sign in
      </Link>

      <p className="mt-6 text-center text-sm text-muted">
        Don&apos;t have an account?{""}
        <Link href="/signup" className="font-semibold text-accent hover:text-accent">
          Sign up
        </Link>
      </p>
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
