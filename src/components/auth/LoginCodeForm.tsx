"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { AlertCircle } from "lucide-react";
import {
  CODE_LENGTH,
  INVALID_CODE_MESSAGE,
  REQUEST_FAILED_MESSAGE,
  describeRequestOutcome,
  formatCooldown,
  remainingCooldownMs,
  sanitiseCodeInput,
} from "@/components/auth/loginCodeState";

/**
 * Sign in with a six-digit code — Stage 4's backend, Stage 5's screen.
 *
 * Two steps in one component, because they are one task to the person doing
 * them: ask for a code, then type it in. A front-desk user who has to navigate
 * between two screens loses the code to a page transition.
 *
 * THE SERVER DECIDES; THIS FORM ONLY ASKS. Every string the user sees is a
 * constant in loginCodeState.ts, chosen by STATUS CODE alone; no server text is
 * ever echoed.
 *
 * ONE ACCOUNT FACT IS NOW SHOWN, AND EXACTLY ONE. A 404 means the address has no
 * account, and the form says so and offers /signup — a deliberate product
 * decision, explained once on `AccountNotFoundError` in src/lib/auth.ts. Every
 * other outcome still collapses into the same 200 and the same acknowledgement,
 * so reaching the code step remains no evidence that a code was issued: a
 * suspended, pending or unverified account gets there identically to an eligible
 * one. Do not add a second branch that distinguishes those.
 *
 * ONE CONSUMPTION PATH. Verification goes through `signIn("login-code", ...)`,
 * which reaches the Auth.js provider in lib/auth.ts — the same provider
 * POST /api/auth/login-code/verify delegates to. The browser calls exactly one
 * of the two, never both, so a code has one place where it can be spent.
 *
 * THE CODE IS NEVER PERSISTED CLIENT-SIDE. It lives in React state for as long
 * as the field holds it and is cleared on success and on leaving the step. No
 * localStorage, no sessionStorage, no cookie, no query string, no URL of any
 * kind — a code in any of those outlives the login it was for.
 */

interface LoginCodeFormProps {
  /** Shared with the password tab so the address is typed once. */
  email: string;
  onEmailChange: (email: string) => void;
}

const FIELD_CLASS =
  "block w-full rounded-2xl shadow-neu-inset py-3.5 px-4 text-sm text-ink placeholder:text-faint";

const LABEL_CLASS = "block text-sm font-medium text-ink mb-2";

const PRIMARY_BUTTON_CLASS =
  "mt-2 flex w-full justify-center rounded-xl bg-primary hover:bg-primary-hover py-3.5 px-4 text-sm font-semibold text-accent-ink shadow-neu-raised-sm focus:ring-primary disabled:opacity-70 transition-colors";

export default function LoginCodeForm({ email, onEmailChange }: LoginCodeFormProps) {
  const router = useRouter();

  const [step, setStep] = useState<"email" | "code">("email");
  const [code, setCode] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Whether the current error is "no such account", which is the only one with
   * an action attached. Kept as its own flag rather than inferred by comparing
   * `error` against a string, so the copy can change without silently detaching
   * the link from it.
   */
  const [offerSignup, setOfferSignup] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  /** When the last code was asked for, for the visible half of the cooldown. */
  const [lastRequestedAt, setLastRequestedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const codeInputRef = useRef<HTMLInputElement>(null);

  const remainingMs = remainingCooldownMs(lastRequestedAt, now);
  const isCoolingDown = remainingMs > 0;

  /**
   * Ticks only while there is something to count down, and stops the moment
   * there is not — a permanent one-second interval on a login screen is a
   * render every second for the life of the tab.
   */
  useEffect(() => {
    if (!isCoolingDown) {
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isCoolingDown]);

  /** Puts the caret where the user is about to type, without stealing it back. */
  useEffect(() => {
    if (step === "code") {
      codeInputRef.current?.focus();
    }
  }, [step]);

  /**
   * Asks for a code. Shared by the first request and every resend, so the two
   * cannot drift into treating the same response differently.
   */
  const requestCode = useCallback(
    async (address: string): Promise<void> => {
      setError(null);
      setNotice(null);
      setOfferSignup(false);
      setIsSubmitting(true);

      try {
        const response = await fetch("/api/auth/login-code/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: address }),
        });

        const outcome = describeRequestOutcome(response.status);

        if (!outcome.advance) {
          setError(outcome.message);
          setOfferSignup(outcome.offerSignup);
          return;
        }

        // Any previously issued code is dead server-side, so the field must not
        // keep holding one the user might still try to submit.
        setCode("");
        setNotice(outcome.message);
        setLastRequestedAt(Date.now());
        setNow(Date.now());
        setStep("code");
      } catch {
        setError(REQUEST_FAILED_MESSAGE);
      } finally {
        setIsSubmitting(false);
      }
    },
    [],
  );

  async function handleRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }
    await requestCode(email);
  }

  async function handleResend() {
    // Both guards matter: the cooldown is the user-facing rule, `isSubmitting`
    // stops a double-click landing two requests against one window.
    if (isSubmitting || isCoolingDown) {
      return;
    }
    await requestCode(email);
    codeInputRef.current?.focus();
  }

  async function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

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
        // ineligible — arrives as the same generic error, by design. The code
        // is cleared because whichever of those it was, retyping the same six
        // digits cannot help.
        setCode("");
        setError(INVALID_CODE_MESSAGE);
        codeInputRef.current?.focus();
        return;
      }

      setCode("");
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError(REQUEST_FAILED_MESSAGE);
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleCodePaste(event: ClipboardEvent<HTMLInputElement>) {
    // Taking the paste ourselves means "123 456" and a code with a trailing
    // newline both land as six digits instead of being silently truncated to
    // "123 45" by maxLength.
    event.preventDefault();
    setCode(sanitiseCodeInput(event.clipboardData.getData("text")));
  }

  function returnToEmailStep() {
    setStep("email");
    setCode("");
    setError(null);
    setNotice(null);
    setOfferSignup(false);
  }

  if (step === "email") {
    // `method="post"` for the same reason as every other credential form here: a
    // <form> with no `method` defaults to GET, so a submit landing before
    // hydration would put the fields in the URL and in history. This one carries
    // the address a code is being asked for. Longer note in
    // src/components/auth/ResetPasswordForm.tsx.
    return (
      <form method="post" onSubmit={handleRequest} className="space-y-6">
        <p role="status" aria-live="polite" className="sr-only">
          {notice ?? ""}
        </p>

        {error && (
          <p
            id="login-code-request-error"
            role="alert"
            aria-live="assertive"
            className="flex items-start gap-2 rounded-xl bg-alert-bg p-3 text-sm text-alert-ink"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              <span className="font-semibold">Error:</span> {error}
              {offerSignup && (
                <>
                  {""}
                  <Link
                    href={`/signup?email=${encodeURIComponent(email)}`}
                    className="font-semibold underline hover:text-alert-ink"
                  >
                    Create an account
                  </Link>
                  .
                </>
              )}
            </span>
          </p>
        )}

        <div>
          <label htmlFor="login-code-email" className={LABEL_CLASS}>
            Email
          </label>
          <input
            id="login-code-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => onEmailChange(event.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={
              error ? "login-code-request-error login-code-email-hint" : "login-code-email-hint"
            }
            placeholder="dr.amelia@dentalcare.com"
            className={FIELD_CLASS}
          />
          <p id="login-code-email-hint" className="mt-2 text-sm text-muted">
            We will email you a six-digit code instead of asking for your password.
          </p>
        </div>

        <button type="submit" disabled={isSubmitting} className={PRIMARY_BUTTON_CLASS}>
          {isSubmitting ? "Sending..." : "Email me a code"}
        </button>
      </form>
    );
  }

  // `method="post"` matters MORE on this one than anywhere else in the app: the
  // field below holds the six-digit login code, which is a live credential. A
  // pre-hydration GET submit would put it in the URL bar and in browser history
  // — exactly what lib/email.ts refuses to do by never mailing the code as a
  // link. Longer note in src/components/auth/ResetPasswordForm.tsx.
  return (
    <form method="post" onSubmit={handleVerify} className="space-y-6">
      <p
        role="status"
        aria-live="polite"
        className="rounded-xl bg-canvas-deep p-3 text-sm text-ink"
      >
        {notice ?? "Enter the six-digit code from your email."}
      </p>

      {error && (
        <p
          id="login-code-error"
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
        <label htmlFor="login-code-code" className={LABEL_CLASS}>
          Six-digit code
        </label>
        <input
          id="login-code-code"
          ref={codeInputRef}
          name="code"
          type="text"
          // `inputMode` brings up the numeric keypad on a tablet without
          // type="number", which adds spinners and strips leading zeros.
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={CODE_LENGTH}
          required
          value={code}
          onChange={(event) => setCode(sanitiseCodeInput(event.target.value))}
          onPaste={handleCodePaste}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            error ? "login-code-error login-code-hint" : "login-code-hint"
          }
          placeholder="123456"
          className={`${FIELD_CLASS} tracking-[0.4em]`}
        />
        <p id="login-code-hint" className="mt-2 text-sm text-muted">
          The code expires in 10 minutes. It never arrives as a link — do not share it.
        </p>
      </div>

      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center">
          <input
            id="login-code-remember"
            name="rememberMe"
            type="checkbox"
            checked={rememberMe}
            onChange={(event) => setRememberMe(event.target.checked)}
            className="h-4 w-4 rounded border-line text-accent"
          />
          <label
            htmlFor="login-code-remember"
            className="ml-2 block text-sm font-medium text-muted"
          >
            Remember this device
          </label>
        </div>
        <button
          type="button"
          onClick={handleResend}
          disabled={isSubmitting || isCoolingDown}
          className="text-sm font-medium text-accent hover:text-accent rounded disabled:text-faint disabled:hover:text-faint"
        >
          {isCoolingDown ? `Resend in ${formatCooldown(remainingMs)}` : "Resend code"}
        </button>
      </div>

      <button type="submit" disabled={isSubmitting} className={PRIMARY_BUTTON_CLASS}>
        {isSubmitting ? "Checking..." : "Sign In"}
      </button>

      <button
        type="button"
        onClick={returnToEmailStep}
        disabled={isSubmitting}
        className="w-full rounded-xl py-2 text-sm font-medium text-muted hover:text-ink disabled:opacity-70"
      >
        Use a different email
      </button>
    </form>
  );
}
