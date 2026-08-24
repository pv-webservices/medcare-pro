"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { ShieldCheck } from "lucide-react";

/**
 * Owner sign-in form — Stage 2.
 *
 * ONE error message for every failure. Unknown address, wrong password,
 * suspended account and "correct credentials, but not an Owner" are
 * indistinguishable here, so the form cannot be used to enumerate which
 * addresses hold platform access. The clinic login screen distinguishes
 * "unverified" because that state has a recovery path; none of these do.
 */

const SIGN_IN_FAILED_MESSAGE = "Sign in failed. Check your details and try again.";
const UNREACHABLE_MESSAGE = "Could not reach the server. Check your connection and try again.";

export default function OwnerLoginForm() {
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
      const result = await signIn("credentials", { email, password, redirect: false });

      if (!result || result.error) {
        setError(SIGN_IN_FAILED_MESSAGE);
        setPassword("");
        return;
      }

      // Authorization is decided by the page we are navigating to, which reads
      // platformRole from the database. A non-Owner lands on a 404.
      router.push("/owner/dashboard");
      router.refresh();
    } catch {
      setError(UNREACHABLE_MESSAGE);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-canvas-deep text-ink">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <div className="text-lg font-semibold leading-none">Platform access</div>
            <div className="mt-1 text-xs text-muted">MEDCARE PRO administration</div>
          </div>
        </div>

        {/*
          `method="post"` guards the instant before hydration: a <form> with no
          `method` defaults to GET, so a submit landing before React attaches its
          handler would send the password as a QUERY STRING — into the URL bar,
          into history, and into every proxy log on the way. POST puts it in a
          body instead. handleSubmit still preventDefaults and posts with fetch;
          this only bounds what a stray native submit can do. Longer note in
          src/components/auth/ResetPasswordForm.tsx.
        */}
        <form method="post" onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <p role="alert" className="rounded-lg bg-alert-bg px-3 py-2 text-sm text-alert-ink">
              {error}
            </p>
          )}

          <label className="block text-sm">
            <span className="mb-1.5 block text-muted">Email</span>
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-2xl bg-canvas px-3 py-2 text-ink shadow-neu-inset"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1.5 block text-muted">Password</span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-2xl bg-canvas px-3 py-2 text-ink shadow-neu-inset"
            />
          </label>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink disabled:opacity-60"
          >
            {isSubmitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
