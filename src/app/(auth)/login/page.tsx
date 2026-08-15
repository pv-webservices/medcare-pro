"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

// Admin login screen — PRD §6.1 (FR-1.1, FR-1.2).

/**
 * One message for every failure. FR-1.1's acceptance criteria requires that a
 * failed login never reveals whether the email existed or the password was
 * wrong, and never leaks a stack trace.
 */
const INVALID_CREDENTIALS_MESSAGE =
  "Invalid email or password. Check your details and try again.";

const UNREACHABLE_MESSAGE =
  "Could not reach the server. Check your connection and try again.";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (!result || result.error) {
        setError(INVALID_CREDENTIALS_MESSAGE);
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
          Clinic Management System
        </p>
        <h1 className="mb-6 text-2xl font-semibold">Log In</h1>

        <form onSubmit={handleSubmit} noValidate={false}>
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
            aria-describedby={error ? "login-error" : undefined}
            className="mb-4 block min-h-11 w-full rounded border border-black/20 bg-transparent px-3 text-base outline-none focus:border-black/60 dark:border-white/25 dark:focus:border-white/60"
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
            aria-describedby={error ? "login-error" : undefined}
            className="mb-6 block min-h-11 w-full rounded border border-black/20 bg-transparent px-3 text-base outline-none focus:border-black/60 dark:border-white/25 dark:focus:border-white/60"
          />

          <button
            type="submit"
            disabled={isSubmitting}
            className="min-h-11 w-full rounded bg-foreground px-4 text-base font-medium text-background disabled:opacity-60"
          >
            {isSubmitting ? "Logging In…" : "Log In"}
          </button>
        </form>
      </div>
    </div>
  );
}
