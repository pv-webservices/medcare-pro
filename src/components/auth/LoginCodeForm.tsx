"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button, Input } from "@/components/ui";

/**
 * Sign in with a six-digit code — Stage 4.
 *
 * Two steps in one component, because they are one task to the person doing
 * them: ask for a code, then type it in. A front-desk user who has to navigate
 * between two screens loses the code to a page transition.
 *
 * THE SERVER DECIDES; THIS FORM ONLY ASKS. It shows the same acknowledgement
 * whatever the request endpoint says, because the endpoint deliberately answers
 * identically for an unknown address and an eligible one. Advancing to the code
 * step is therefore NOT a signal that the account exists — the step is reached
 * for every address, which is exactly what keeps the UI from re-leaking what the
 * API went to some trouble to conceal.
 *
 * Verification goes through `signIn("login-code", ...)`, the same provider the
 * API route delegates to, so the code has one consumption point regardless of
 * which surface the user came through.
 */

const REQUEST_FAILED_MESSAGE =
  "Could not reach the server. Check your connection and try again.";

const INVALID_CODE_MESSAGE = "That code is not valid. Request a new one.";

const CODE_LENGTH = 6;

export default function LoginCodeForm() {
  const router = useRouter();

  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/login-code/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const body = await response.json();

      // 429 is the one refusal worth showing: the user can act on it by waiting,
      // and its message names no account.
      if (response.status === 429) {
        setError(body.error ?? REQUEST_FAILED_MESSAGE);
        return;
      }

      if (!response.ok) {
        setError(body.error ?? REQUEST_FAILED_MESSAGE);
        return;
      }

      setNotice(body.message ?? null);
      setStep("code");
    } catch {
      setError(REQUEST_FAILED_MESSAGE);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const result = await signIn("login-code", {
        email,
        code,
        rememberMe: String(rememberMe),
        redirect: false,
      });

      if (!result || result.error) {
        // Every provider refusal — wrong, expired, consumed, exhausted,
        // ineligible — arrives as the same generic error, by design.
        setError(INVALID_CODE_MESSAGE);
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setError(REQUEST_FAILED_MESSAGE);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (step === "email") {
    return (
      <form onSubmit={handleRequest} className="space-y-4">
        <Input
          id="login-code-email"
          label="Email address"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          hint="We will email you a six-digit code."
        />

        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : null}

        <Button type="submit" variant="commit" isBusy={isSubmitting} busyLabel="Sending…">
          Email me a code
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={handleVerify} className="space-y-4">
      {notice ? (
        <p role="status" className="text-sm text-slate-600">
          {notice}
        </p>
      ) : null}

      <Input
        id="login-code-code"
        label="Six-digit code"
        // `inputMode` brings up the numeric keypad on a tablet without
        // type="number", which adds spinners and strips leading zeros.
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={CODE_LENGTH}
        required
        value={code}
        onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
        hint="Check your email. The code expires in 10 minutes."
      />

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={rememberMe}
          onChange={(event) => setRememberMe(event.target.checked)}
          className="h-4 w-4 rounded border-slate-300"
        />
        Remember this device for 30 days
      </label>

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" variant="commit" isBusy={isSubmitting} busyLabel="Checking…">
          Sign in
        </Button>
        <Button
          type="button"
          variant="quiet"
          onClick={() => {
            setStep("email");
            setCode("");
            setError(null);
            setNotice(null);
          }}
        >
          Use a different email
        </Button>
      </div>
    </form>
  );
}
