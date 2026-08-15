"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// Signup screen — PRD §6.1 (FR-1.1, FR-1.2).
// Creates one Tenant + one owner User, then sends a verification link.

/** Kept in step with MIN_PASSWORD_LENGTH in src/app/api/auth/signup/route.ts. */
const MIN_PASSWORD_LENGTH = 12;

const UNREACHABLE_MESSAGE =
  "Could not reach the server. Check your connection and try again.";

const FALLBACK_ERROR_MESSAGE = "Could not create the account. Try again.";

const INPUT_CLASS =
  "mb-4 block min-h-11 w-full rounded border border-black/20 bg-transparent px-3 text-base outline-none focus:border-black/60 dark:border-white/25 dark:focus:border-white/60";

const LABEL_CLASS = "mb-1 block text-sm font-medium";

export default function SignupPage() {
  const router = useRouter();
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessName, email, password }),
      });

      const body: { success?: boolean; error?: string } = await response
        .json()
        .catch(() => ({}));

      if (!response.ok || !body.success) {
        // The route's messages are already user-facing and carry the detail
        // that matters (address taken, email delivery failed), so they are
        // shown as-is rather than flattened into one generic string.
        setError(body.error ?? FALLBACK_ERROR_MESSAGE);
        setPassword("");
        return;
      }

      // FR-1.2 — the account exists but cannot log in yet. Send the user to the
      // "check your inbox" screen, carrying the address so it can offer a resend.
      router.push(`/verify-email?email=${encodeURIComponent(email)}`);
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
        <h1 className="mb-6 text-2xl font-semibold">Create your account</h1>

        <form onSubmit={handleSubmit}>
          {error && (
            <p
              role="alert"
              id="signup-error"
              className="mb-4 rounded border border-red-600/40 bg-red-600/10 px-3 py-2 text-sm text-red-700 dark:text-red-400"
            >
              {error}
            </p>
          )}

          <label htmlFor="businessName" className={LABEL_CLASS}>
            Business or clinic name
          </label>
          <input
            id="businessName"
            name="businessName"
            type="text"
            autoComplete="organization"
            autoFocus
            required
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            aria-describedby={error ? "signup-error" : undefined}
            className={INPUT_CLASS}
          />

          <label htmlFor="email" className={LABEL_CLASS}>
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
            aria-describedby={error ? "signup-error" : undefined}
            className={INPUT_CLASS}
          />

          <label htmlFor="password" className={LABEL_CLASS}>
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            // FR-1.4 — "new-password" is what lets a password manager offer to
            // generate and save one here, rather than autofilling an old value.
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby="password-hint"
            className="mb-1 block min-h-11 w-full rounded border border-black/20 bg-transparent px-3 text-base outline-none focus:border-black/60 dark:border-white/25 dark:focus:border-white/60"
          />
          <p
            id="password-hint"
            className="mb-6 text-xs text-black/60 dark:text-white/60"
          >
            At least {MIN_PASSWORD_LENGTH} characters.
          </p>

          <button
            type="submit"
            disabled={isSubmitting}
            className="min-h-11 w-full rounded bg-foreground px-4 text-base font-medium text-background disabled:opacity-60"
          >
            {isSubmitting ? "Creating Account…" : "Create Account"}
          </button>
        </form>

        <p className="mt-6 text-sm text-black/60 dark:text-white/60">
          Already have an account?{" "}
          <Link href="/login" className="underline">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
