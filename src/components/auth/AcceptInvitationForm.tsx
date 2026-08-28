"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import AuthAlert from "@/components/auth/AuthAlert";
import AuthButton from "@/components/auth/AuthButton";
import AuthField from "@/components/auth/AuthField";
import PasswordField from "@/components/auth/PasswordField";

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
      <AuthAlert tone="success" title="Your account is ready">
        Taking you to the sign-in page — use{" "}
        <span className="font-semibold">{email}</span> and the password you just
        chose.
      </AuthAlert>
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
        <AuthAlert id="invite-error" tone="error">
          {error}
        </AuthAlert>
      )}

      <AuthField
        id="invite-email"
        name="email"
        type="email"
        label="Email"
        value={email}
        readOnly
        disabled
        autoComplete="username"
        hint="The invitation was sent to this address, so only it can accept."
      />

      <AuthField
        id="invite-name"
        name="name"
        type="text"
        label="Your name"
        autoComplete="name"
        required
        value={name}
        onChange={(event) => setName(event.target.value)}
        aria-invalid={error ? true : undefined}
        describedBy={error ? "invite-error" : undefined}
      />

      <PasswordField
        id="invite-password"
        name="password"
        label="Choose a password"
        autoComplete="new-password"
        required
        minLength={MIN_PASSWORD_LENGTH}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        showGuidance
        minPasswordLength={MIN_PASSWORD_LENGTH}
      />

      <PasswordField
        id="invite-confirm"
        name="confirmPassword"
        label="Confirm password"
        autoComplete="new-password"
        required
        value={confirmation}
        onChange={(event) => setConfirmation(event.target.value)}
        aria-invalid={error ? true : undefined}
      />

      <AuthButton
        type="submit"
        isBusy={isSubmitting}
        busyLabel="Setting up..."
        className="mt-1"
      >
        Accept invitation
      </AuthButton>
    </form>
  );
}
