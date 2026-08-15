"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { signIn } from "next-auth/react";

// Login screen — PRD §6.1 (FR-1.3, FR-1.4, FR-1.5).

/**
 * One message for every credential failure. FR-1.1's acceptance criteria
 * requires that a failed login never reveals whether the email existed or the
 * password was wrong, and never leaks a stack trace.
 */
const INVALID_CREDENTIALS_MESSAGE =
  "Invalid email or password. Check your details and try again.";

const UNREACHABLE_MESSAGE =
  "Could not reach the server. Check your connection and try again.";

/**
 * FR-1.5 — the one failure that is deliberately NOT collapsed into the generic
 * message. `code` is set by EmailNotVerifiedError in src/lib/auth.ts and only
 * ever reached once the password has already verified, so distinguishing it
 * here reveals nothing a caller had not already proven.
 */
const EMAIL_NOT_VERIFIED_CODE = "EmailNotVerified";

const INPUT_CLASS_BASE =
  "block min-h-11 w-full rounded border border-black/20 bg-transparent px-3 text-base outline-none focus:border-black/60 dark:border-white/25 dark:focus:border-white/60";

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Set by GET /api/auth/verify-email after a successful verification (FR-1.3).
  const justVerified = searchParams.get("verified") === "1";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isUnverified, setIsUnverified] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsUnverified(false);
    setIsSubmitting(true);

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (!result || result.error) {
        if (result?.code === EMAIL_NOT_VERIFIED_CODE) {
          setIsUnverified(true);
        } else {
          setError(INVALID_CREDENTIALS_MESSAGE);
        }
        setPassword("");
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      // Network/server failure — deliberately not surfacing the thrown error.
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
        <h1 className="mb-6 text-2xl font-semibold">Log In</h1>

        <form onSubmit={handleSubmit} noValidate={false}>
          {justVerified && !error && !isUnverified && (
            <p
              role="status"
              className="mb-4 rounded border border-green-700/40 bg-green-700/10 px-3 py-2 text-sm text-green-800 dark:text-green-400"
            >
              Your email is verified. Log in to continue.
            </p>
          )}

          {isUnverified && (
            <p
              role="alert"
              id="login-error"
              className="mb-4 rounded border border-amber-600/40 bg-amber-600/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-400"
            >
              Please verify your email before logging in. Check your inbox for
              the link, or{" "}
              <Link
                href={`/verify-email?email=${encodeURIComponent(email)}`}
                className="underline"
              >
                request a new one
              </Link>
              .
            </p>
          )}

          {error && (
            <p
              role="alert"
              id="login-error"
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
            autoFocus
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-describedby={error || isUnverified ? "login-error" : undefined}
            className={`mb-4 ${INPUT_CLASS_BASE}`}
          />

          <label htmlFor="password" className="mb-1 block text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby={error || isUnverified ? "login-error" : undefined}
            className={`mb-6 ${INPUT_CLASS_BASE}`}
          />

          <button
            type="submit"
            disabled={isSubmitting}
            className="min-h-11 w-full rounded bg-foreground px-4 text-base font-medium text-background disabled:opacity-60"
          >
            {isSubmitting ? "Logging In…" : "Log In"}
          </button>
        </form>

        <p className="mt-6 text-sm text-black/60 dark:text-white/60">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary to avoid opting the whole route
  // into client-side rendering at build time.
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
