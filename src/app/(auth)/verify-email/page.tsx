"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

// Email verification screen — PRD §6.1 (FR-1.2, FR-1.5).
//
// This page never consumes the token itself: the emailed link points at
// GET /api/auth/verify-email, which verifies and redirects to /login on success
// (FR-1.3). The page handles the states either side of that — "check your
// inbox" after signup, and the failure cases the API route redirects back here.

const INPUT_CLASS =
  "mb-4 block min-h-11 w-full rounded border border-black/20 bg-transparent px-3 text-base outline-none focus:border-black/60 dark:border-white/25 dark:focus:border-white/60";

const UNREACHABLE_MESSAGE =
  "Could not reach the server. Check your connection and try again.";

/** `status` values the API route redirects back with. */
const STATUS_MESSAGES: Record<string, string> = {
  invalid: "That verification link is not valid. Request a new one below.",
  expired: "That verification link has expired. Request a new one below.",
  error: "Something went wrong verifying your email. Request a new link below.",
};

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const status = searchParams.get("status");
  const emailFromSignup = searchParams.get("email") ?? "";

  const [email, setEmail] = useState(emailFromSignup);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const statusMessage = status ? STATUS_MESSAGES[status] : undefined;
  // No status means the user just signed up and landed here to be told to go
  // and check their inbox.
  const isPostSignup = !status;

  async function handleResend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const body: { success?: boolean; error?: string; message?: string } =
        await response.json().catch(() => ({}));

      if (!response.ok || !body.success) {
        setError(body.error ?? "Could not send the link. Try again shortly.");
        return;
      }

      // Intentionally the same acknowledgement whether or not the address was
      // registered — the API will not say, and neither should this.
      setNotice(body.message ?? "If that address needs verification, a new link is on its way.");
    } catch {
      setError(UNREACHABLE_MESSAGE);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <p className="mb-1 text-sm text-black/60 dark:text-white/60">
          MEDCARE PRO
        </p>
        <h1 className="mb-4 text-2xl font-semibold">
          {isPostSignup ? "Check your email" : "Verify your email"}
        </h1>

        {isPostSignup && (
          <p className="mb-6 text-sm text-black/70 dark:text-white/70">
            We&apos;ve sent a verification link
            {emailFromSignup ? ` to ${emailFromSignup}` : ""}. Open it to
            activate your account — you won&apos;t be able to log in until you
            do.
          </p>
        )}

        {statusMessage && (
          <p
            role="alert"
            className="mb-6 rounded border border-red-600/40 bg-red-600/10 px-3 py-2 text-sm text-red-700 dark:text-red-400"
          >
            {statusMessage}
          </p>
        )}

        <form onSubmit={handleResend}>
          {notice && (
            <p
              role="status"
              className="mb-4 rounded border border-green-700/40 bg-green-700/10 px-3 py-2 text-sm text-green-800 dark:text-green-400"
            >
              {notice}
            </p>
          )}

          {error && (
            <p
              role="alert"
              id="resend-error"
              className="mb-4 rounded border border-red-600/40 bg-red-600/10 px-3 py-2 text-sm text-red-700 dark:text-red-400"
            >
              {error}
            </p>
          )}

          <label htmlFor="email" className="mb-1 block text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-describedby={error ? "resend-error" : undefined}
            className={INPUT_CLASS}
          />

          <button
            type="submit"
            disabled={isSubmitting}
            className="min-h-11 w-full rounded bg-foreground px-4 text-base font-medium text-background disabled:opacity-60"
          >
            {isSubmitting ? "Sending…" : "Resend verification link"}
          </button>
        </form>

        <p className="mt-6 text-sm text-black/60 dark:text-white/60">
          Already verified?{" "}
          <Link href="/login" className="underline">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  // useSearchParams needs a Suspense boundary to avoid opting the whole route
  // into client-side rendering at build time.
  return (
    <Suspense>
      <VerifyEmailContent />
    </Suspense>
  );
}
