"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2 } from "lucide-react";

/**
 * Setting a password against an invitation — Stage 6.
 *
 * Styled to the login and signup screens rather than the dashboard design
 * system: this is the first MEDCARE PRO page an invited person ever sees, and
 * it should look like the front door, not like the inside of the building.
 *
 * THE TOKEN IS NEVER STORED. It arrives in the page's props, sits in a hidden
 * field for the length of one submit, and goes nowhere else — no localStorage,
 * no sessionStorage, no cookie, and it is never written back into the URL. A
 * token that outlives the acceptance it was for is a live credential lying
 * around.
 *
 * NO SESSION IS MINTED HERE. On success the person is sent to /login with their
 * address prefilled by the ordinary flow. Signing them in from this endpoint
 * would be a second way into the app that skips lib/auth.ts.
 */

interface AcceptInvitationFormProps {
  token: string;
  /** Fixed by the invitation — shown, never edited. Only this address may accept. */
  email: string;
}

/** Mirrors MIN_PASSWORD_LENGTH in src/lib/signupInput.ts. */
const MIN_PASSWORD_LENGTH = 12;

const FIELD_CLASS =
  "block w-full rounded-xl border border-slate-200 py-3.5 px-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-600 focus:outline-none focus:ring-1 focus:ring-violet-600 disabled:bg-slate-50 disabled:text-slate-500";

const LABEL_CLASS = "block text-sm font-medium text-slate-700 mb-2";

export default function AcceptInvitationForm({
  token,
  email,
}: AcceptInvitationFormProps) {
  const router = useRouter();

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isDone, setIsDone] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Mirrors the zod rules in src/lib/invitations.ts; the server is still the
  // authority. The confirmation field is client-only — the API takes one
  // password, and asking twice is about typos, not about security.
  function validate(): string | null {
    if (name.trim().length === 0) {
      return "Enter your name.";
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    if (password !== confirmation) {
      return "The two passwords do not match.";
    }
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting || isDone) {
      return;
    }

    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name: name.trim(), password }),
      });

      const body: { success?: boolean; error?: string } = await response
        .json()
        .catch(() => ({}));

      if (!response.ok || !body.success) {
        // The server's refusals are written for this screen: one generic
        // sentence for an unusable link, a specific one for an address that is
        // already taken. Neither carries internals.
        setError(body.error ?? "Could not accept the invitation. Try again.");
        return;
      }

      // Cleared the moment they are no longer needed.
      setPassword("");
      setConfirmation("");
      setIsDone(true);
      router.push("/login");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isDone) {
    return (
      <p
        role="status"
        aria-live="polite"
        className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"
      >
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          Your account is ready. Taking you to the sign-in page — use{" "}
          <span className="font-semibold">{email}</span> and the password you just
          chose.
        </span>
      </p>
    );
  }

  // `method="post"` is the pre-hydration guard, not the submit path: handleSubmit
  // preventDefaults and posts with fetch. Without it the form would default to
  // GET, and a submit landing before React attaches its handler would put the
  // chosen password in the URL and in history. See the longer note in
  // ResetPasswordForm.tsx.
  return (
    <form method="post" onSubmit={handleSubmit} className="space-y-5" noValidate>
      {error && (
        <p
          id="invite-error"
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
        <label htmlFor="invite-email" className={LABEL_CLASS}>
          Email
        </label>
        <input
          id="invite-email"
          name="email"
          type="email"
          value={email}
          readOnly
          disabled
          autoComplete="username"
          className={FIELD_CLASS}
        />
        <p className="mt-2 text-sm text-slate-500">
          The invitation was sent to this address, so only it can accept.
        </p>
      </div>

      <div>
        <label htmlFor="invite-name" className={LABEL_CLASS}>
          Your name
        </label>
        <input
          id="invite-name"
          name="name"
          type="text"
          autoComplete="name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "invite-error" : undefined}
          placeholder="Amelia Rao"
          className={FIELD_CLASS}
        />
      </div>

      <div>
        <label htmlFor="invite-password" className={LABEL_CLASS}>
          Choose a password
        </label>
        <input
          id="invite-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby="invite-password-hint"
          className={FIELD_CLASS}
        />
        <p id="invite-password-hint" className="mt-2 text-sm text-slate-500">
          At least {MIN_PASSWORD_LENGTH} characters.
        </p>
      </div>

      <div>
        <label htmlFor="invite-confirm" className={LABEL_CLASS}>
          Confirm password
        </label>
        <input
          id="invite-confirm"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          aria-invalid={error ? true : undefined}
          className={FIELD_CLASS}
        />
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="mt-2 flex w-full justify-center rounded-xl bg-primary hover:bg-primary-hover py-3.5 px-4 text-sm font-semibold text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-70 transition-colors"
      >
        {isSubmitting ? "Setting up..." : "Accept Invitation"}
      </button>
    </form>
  );
}
