"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Eye, EyeOff } from "lucide-react";
import {
  describeResetConfirm,
  passwordsMatch,
  RESET_MISMATCH_MESSAGE,
  RESET_REQUEST_FAILED_MESSAGE,
} from "@/components/auth/passwordResetState";

/**
 * "Choose a new password" — step two of the reset flow.
 *
 * THE TOKEN IS HELD IN A PROP, NOT RE-READ FROM THE URL. The page (a Server
 * Component) has already established that this token is live and hands it down;
 * reading `window.location` here would mean the form and the check disagreed
 * about which string is being redeemed.
 *
 * IT IS NEVER PERSISTED CLIENT-SIDE. No localStorage, no sessionStorage, no
 * cookie. It stays in the URL for as long as the tab is open — unavoidable for
 * an emailed link — and `router.replace` on success drops it from the history
 * entry so a back-button press does not put a spent token back on screen.
 *
 * NO SESSION IS CREATED ON SUCCESS. The user is sent to /login to sign in with
 * the password they just chose. See src/lib/passwordReset.ts on why an emailed
 * link does not get to be a credential.
 */

const FIELD_CLASS =
  "block w-full rounded-xl border border-slate-200 py-3.5 pl-4 pr-11 text-sm tracking-[0.2em] text-slate-900 placeholder:text-slate-400 placeholder:tracking-[0.2em] focus:border-violet-600 focus:outline-none focus:ring-1 focus:ring-violet-600";

const LABEL_CLASS = "block text-sm font-medium text-slate-700 mb-2";

const PRIMARY_BUTTON_CLASS =
  "mt-2 flex w-full justify-center rounded-xl bg-primary hover:bg-primary-hover py-3.5 px-4 text-sm font-semibold text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-70 transition-colors";

const GENERIC_WEAK_PASSWORD_MESSAGE =
  "That password does not meet the requirements. Choose a longer one.";

interface ResetPasswordFormProps {
  /** The raw token from the emailed link, already checked live by the page. */
  token: string;
  /** Shown under the heading, so the rule is visible before the user types. */
  minPasswordLength: number;
}

export default function ResetPasswordForm({
  token,
  minPasswordLength,
}: ResetPasswordFormProps) {
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    setError(null);

    // Checked here as well as on the server because the server cannot check it
    // at all: only one of the two fields is sent. This is the whole of the
    // confirmation field's purpose.
    if (!passwordsMatch(password, confirmation)) {
      setError(RESET_MISMATCH_MESSAGE);
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      const outcome = describeResetConfirm(response.status);

      if (outcome.changed) {
        setPassword("");
        setConfirmation("");
        // `replace`, not `push`: the spent token must not be one Back press away.
        router.replace("/login?reset=1");
        return;
      }

      if (outcome.kind === "weak-password") {
        // The ONE case where the server's own text is used — it names the rule
        // the user has to satisfy. Read defensively and only ever as a string.
        const body: unknown = await response.json().catch(() => null);
        const serverMessage =
          typeof body === "object" && body !== null && "error" in body &&
          typeof (body as { error?: unknown }).error === "string"
            ? (body as { error: string }).error
            : null;
        setError(serverMessage ?? GENERIC_WEAK_PASSWORD_MESSAGE);
        return;
      }

      setError(outcome.message ?? RESET_REQUEST_FAILED_MESSAGE);
    } catch {
      setError(RESET_REQUEST_FAILED_MESSAGE);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <div className="mb-8">
        <h1 className="text-4xl font-bold tracking-tight text-slate-900">
          Choose a new password
        </h1>
        <p className="mt-3 text-sm text-slate-500">
          At least {minPasswordLength} characters. Setting it signs you out
          everywhere else.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <p
            id="reset-password-error"
            role="alert"
            aria-live="assertive"
            className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              <span className="font-semibold">Error:</span> {error}
            </span>
          </p>
        )}

        <div>
          <label htmlFor="reset-password" className={LABEL_CLASS}>
            New password
          </label>
          <div className="relative">
            <input
              id="reset-password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={minPasswordLength}
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "reset-password-error" : undefined}
              placeholder="••••••••••••••••"
              className={FIELD_CLASS}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              className="absolute inset-y-0 right-0 flex items-center pr-4 text-violet-600 hover:text-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-600 rounded"
            >
              {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="reset-password-confirm" className={LABEL_CLASS}>
            Confirm new password
          </label>
          <div className="relative">
            <input
              id="reset-password-confirm"
              name="confirmPassword"
              // Deliberately NOT toggled by the eye above. The point of a
              // confirmation field is that it is typed independently; revealing
              // it turns the check into a copy-and-compare by eye.
              type="password"
              autoComplete="new-password"
              required
              minLength={minPasswordLength}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "reset-password-error" : undefined}
              placeholder="••••••••••••••••"
              className={FIELD_CLASS}
            />
          </div>
        </div>

        <button type="submit" disabled={isSubmitting} className={PRIMARY_BUTTON_CLASS}>
          {isSubmitting ? "Saving..." : "Set new password"}
        </button>
      </form>

      <p className="mt-8 text-center text-sm text-slate-500">
        Remembered it?{" "}
        <Link href="/login" className="font-semibold text-violet-600 hover:text-violet-700">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
