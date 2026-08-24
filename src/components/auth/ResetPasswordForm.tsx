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
  "block w-full rounded-2xl shadow-neu-inset py-3.5 pl-4 pr-11 text-sm tracking-[0.2em] text-ink placeholder:text-faint placeholder:tracking-[0.2em]";

const LABEL_CLASS = "block text-sm font-medium text-ink mb-2";

const PRIMARY_BUTTON_CLASS =
  "mt-2 flex w-full justify-center rounded-xl bg-primary hover:bg-primary-hover py-3.5 px-4 text-sm font-semibold text-accent-ink shadow-neu-raised-sm focus:ring-primary disabled:opacity-70 transition-colors";

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
  const [showConfirmation, setShowConfirmation] = useState(false);
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
        <h1 className="text-4xl font-bold tracking-tight text-ink">
          Choose a new password
        </h1>
        <p className="mt-3 text-sm text-muted">
          At least {minPasswordLength} characters. Setting it signs you out
          everywhere else.
        </p>
      </div>

      {/*
        `method="post"` IS LOAD-BEARING, and is not about where this form
        submits — `handleSubmit` calls preventDefault and posts with fetch, so
        the browser's own submission never runs once React is listening.

        It is the guard for the instant BEFORE that. A <form> with no `method`
        defaults to GET, so a submit that happens before hydration attaches the
        handler — Enter in a text field, a double-tap, a slow bundle — sends the
        fields as a QUERY STRING. That put the new password in the URL bar, in
        browser history, and in any proxy or server log on the way. POST cannot
        do that: the fields go in a body, and the worst a stray native submit can
        now produce is a 405 from a page that exports no POST handler.

        There is deliberately NO `action`, and the button is deliberately NOT
        disabled until mounted. Gating the page's only action on a `useEffect`
        is what made this form unusable: when the client bundle failed to
        compile, `isMounted` stayed false, and the button was dead with nothing
        on screen to say why.
      */}
      <form method="POST" action="#" onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <p
            id="reset-password-error"
            role="alert"
            aria-live="assertive"
            className="flex items-start gap-2 rounded-xl bg-alert-bg p-3 text-sm text-alert-ink"
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
              className="absolute inset-y-0 right-0 flex items-center pr-4 text-accent hover:text-accent rounded"
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
              type={showConfirmation ? "text" : "password"}
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
            <button
              type="button"
              onClick={() => setShowConfirmation(!showConfirmation)}
              aria-label={
                showConfirmation ? "Hide confirmed password" : "Show confirmed password"
              }
              aria-pressed={showConfirmation}
              className="absolute inset-y-0 right-0 flex items-center pr-4 text-accent hover:text-accent rounded"
            >
              {showConfirmation ? (
                <EyeOff className="h-5 w-5" />
              ) : (
                <Eye className="h-5 w-5" />
              )}
            </button>
          </div>
        </div>

        <button type="submit" disabled={isSubmitting} className={PRIMARY_BUTTON_CLASS}>
          {isSubmitting ? "Saving..." : "Set new password"}
        </button>
      </form>

      <p className="mt-8 text-center text-sm text-muted">
        Remembered it?{""}
        <Link href="/login" className="font-semibold text-accent hover:text-accent">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
