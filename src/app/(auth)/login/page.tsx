"use client";

import {
  Suspense,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { Mail } from "lucide-react";
import AuthAlert from "@/components/auth/AuthAlert";
import AuthButton, { authLinkClasses } from "@/components/auth/AuthButton";
import AuthCard from "@/components/auth/AuthCard";
import AuthField from "@/components/auth/AuthField";
import AuthFooter from "@/components/auth/AuthFooter";
import AuthHeader from "@/components/auth/AuthHeader";
import AuthLayout from "@/components/auth/AuthLayout";
import LoginCodeForm from "@/components/auth/LoginCodeForm";
import PasswordField from "@/components/auth/PasswordField";
import { getSessionEndedMessage } from "@/lib/sessionEndedMessage";
import { cx } from "@/components/ui/cx";

// Login screen — PRD §6.1 (FR-1.3, FR-1.4, FR-1.5), with Stage 5's second
// authentication method alongside the password one.
//
// The presentation was rebuilt onto the auth design system (components/auth/*,
// tokens in globals.css). Every branch below — which refusal codes exist, what
// each one is allowed to disclose, where each one navigates — is unchanged.

const INVALID_CREDENTIALS_MESSAGE = "Invalid email or password.";

const UNREACHABLE_MESSAGE =
  "Could not reach the server. Check your connection and try again.";

const EMAIL_NOT_VERIFIED_CODE = "EmailNotVerified";

/**
 * Thrown by src/lib/auth.ts when the address has no account at all — the one
 * refusal that names an account fact. Read the note on `AccountNotFoundError`
 * there before treating any other refusal the same way.
 */
const ACCOUNT_NOT_FOUND_CODE = "AccountNotFound";

const ACCOUNT_NOT_FOUND_MESSAGE = "No account exists for that email address.";

/**
 * Stage 3 item 4 — the organisation exists and the password is right, but the
 * application has not been approved. Auth.js surfaces these as `result.code`;
 * see ClinicStateError in src/lib/auth.ts for what each one is allowed to
 * disclose and why.
 */
const CLINIC_STATE_CODES: Record<string, string> = {
  ClinicPending: "pending",
  ClinicRejected: "rejected",
  ClinicSuspended: "suspended",
};

/**
 * Stage 5 — the two ways in. They are TABS rather than two pages because they
 * are alternatives for the same act, and because a user who cannot remember
 * their password should not have to find a different URL to get past it.
 *
 * Both panels stay mounted, with the inactive one `hidden`. That is what stops
 * a mis-clicked tab from throwing away a code the server has already issued and
 * put behind a one-minute cooldown; `hidden` also takes the panel out of the
 * accessibility tree and the tab order, so nothing is reachable that is not
 * visible.
 */
const MODES = [
  { id: "password", label: "Password" },
  { id: "code", label: "Login code" },
] as const;

type LoginMode = (typeof MODES)[number]["id"];

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const justVerified = searchParams.get("verified") === "1";
  /**
   * Set by ResetPasswordForm after a successful reset. Like `verified`, it is a
   * forgeable flag that only ever chooses between two fixed sentences — it is
   * never echoed and never treated as a fact about an account.
   */
  const justReset = searchParams.get("reset") === "1";
  /**
   * Set by the dashboard shell when it refuses a session that still carries a
   * valid token — revoked, expired, or the account itself was suspended. See
   * signedOutDestination in src/app/(dashboard)/layout.tsx, and
   * lib/sessionEndedMessage.ts for why the reason is never echoed.
   */
  const sessionEndedMessage = getSessionEndedMessage(searchParams);

  const [mode, setMode] = useState<LoginMode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isUnverified, setIsUnverified] = useState(false);
  /** True only for the "no such account" refusal, which has an action attached. */
  const [isUnknownAccount, setIsUnknownAccount] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const tabRefs = useRef<Record<LoginMode, HTMLButtonElement | null>>({
    password: null,
    code: null,
  });

  function selectMode(next: LoginMode) {
    if (next === mode) {
      return;
    }
    setMode(next);
    // A typed password must not sit in state behind a hidden panel, and an
    // error about one method says nothing useful about the other.
    setPassword("");
    setError(null);
    setIsUnverified(false);
    setIsUnknownAccount(false);
  }

  /**
   * Arrow keys move between tabs, Home/End jump to the ends — the keyboard
   * contract a tablist is expected to honour. Selection follows focus, which is
   * the right choice here because switching panels costs nothing and loses
   * nothing.
   */
  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) {
      return;
    }
    event.preventDefault();

    const current = MODES.findIndex((entry) => entry.id === mode);
    let nextIndex: number;
    if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = MODES.length - 1;
    } else {
      const step = event.key === "ArrowRight" ? 1 : MODES.length - 1;
      nextIndex = (current + step) % MODES.length;
    }

    const next = MODES[nextIndex]!.id;
    selectMode(next);
    tabRefs.current[next]?.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    setError(null);
    setIsUnverified(false);
    setIsUnknownAccount(false);
    setIsSubmitting(true);

    try {
      const result = await signIn("credentials", {
        email,
        password,
        // Stage 5 — sent as a string because the credentials body is form data
        // on the wire. It lengthens the AppSession and nothing else: the
        // password check, and any login code, are unaffected by it.
        rememberMe: String(rememberMe),
        redirect: false,
      });

      if (!result || result.error) {
        const clinicState = result?.code
          ? CLINIC_STATE_CODES[result.code]
          : undefined;

        if (result?.code === EMAIL_NOT_VERIFIED_CODE) {
          setIsUnverified(true);
        } else if (result?.code === ACCOUNT_NOT_FOUND_CODE) {
          // The address is not registered. Signing up is the actual next step,
          // so the message carries a link to it rather than leaving the user to
          // re-read a generic refusal.
          setIsUnknownAccount(true);
          setError(ACCOUNT_NOT_FOUND_MESSAGE);
        } else if (clinicState) {
          // No session was created, so this page is where the applicant is
          // told. The destination carries the state only — never the address,
          // which would put it in a shareable URL and the browser history.
          setPassword("");
          router.push(`/pending-approval?status=${clinicState}`);
          return;
        } else {
          setError(INVALID_CREDENTIALS_MESSAGE);
        }
        setPassword("");
        return;
      }

      setPassword("");
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError(UNREACHABLE_MESSAGE);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthLayout>
      <AuthCard>
        <AuthHeader
          title="Welcome back"
          description="Sign in to continue to your MedCare Pro workspace."
        />

        {/* Page-level notices — they apply whichever method is chosen. */}
        <div className="mb-6 space-y-3 empty:hidden">
          {sessionEndedMessage && !error && (
            <AuthAlert tone="info">{sessionEndedMessage}</AuthAlert>
          )}
          {justReset && !error && (
            <AuthAlert tone="success">
              Your password has been changed. Sign in with it to continue.
            </AuthAlert>
          )}
          {justVerified && !error && !isUnverified && (
            <AuthAlert tone="success">
              Your email is verified. Sign in to continue.
            </AuthAlert>
          )}
        </div>

        <div
          role="tablist"
          aria-label="Sign-in method"
          className="mb-7 grid grid-cols-2 gap-1 rounded-[14px] bg-auth-bg-tint p-1"
        >
          {MODES.map((entry) => {
            const isActive = entry.id === mode;
            return (
              <button
                key={entry.id}
                ref={(node) => {
                  tabRefs.current[entry.id] = node;
                }}
                id={`login-tab-${entry.id}`}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={`login-panel-${entry.id}`}
                // Roving tabindex: one stop for the whole tablist, then the
                // arrow keys move within it.
                tabIndex={isActive ? 0 : -1}
                onClick={() => selectMode(entry.id)}
                onKeyDown={handleTabKeyDown}
                className={cx(
                  "min-h-10 rounded-[11px] text-[13.5px] font-semibold transition-[background-color,color,box-shadow] duration-150",
                  isActive
                    ? "bg-auth-card text-auth-primary shadow-auth-sm"
                    : "text-auth-muted hover:text-auth-ink",
                )}
              >
                {entry.label}
              </button>
            );
          })}
        </div>

        <div
          role="tabpanel"
          id="login-panel-password"
          aria-labelledby="login-tab-password"
          hidden={mode !== "password"}
        >
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
            {isUnverified && (
              <AuthAlert
                tone="warning"
                title="Your email address has not been verified yet."
                action={
                  <Link
                    href={`/verify-email?email=${encodeURIComponent(email)}`}
                    className={authLinkClasses}
                  >
                    Resend verification email
                  </Link>
                }
              >
                Open the link we sent you, then sign in again.
              </AuthAlert>
            )}

            {error && (
              <AuthAlert
                id="login-password-error"
                tone="error"
                action={
                  isUnknownAccount ? (
                    <Link
                      href={`/signup?email=${encodeURIComponent(email)}`}
                      className={authLinkClasses}
                    >
                      Create an account
                    </Link>
                  ) : undefined
                }
              >
                {error}
              </AuthAlert>
            )}

            <AuthField
              id="email"
              name="email"
              type="email"
              label="Email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              icon={<Mail className="h-[18px] w-[18px]" strokeWidth={2} />}
              aria-invalid={error ? true : undefined}
              describedBy={error ? "login-password-error" : undefined}
              placeholder="you@clinic.com"
            />

            <PasswordField
              id="password"
              name="password"
              label="Password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={error ? true : undefined}
              describedBy={error ? "login-password-error" : undefined}
              labelAction={
                <Link
                  href={
                    email
                      ? `/forgot-password?email=${encodeURIComponent(email)}`
                      : "/forgot-password"
                  }
                  className="rounded text-[13px] font-medium text-auth-muted transition-colors duration-150 hover:text-auth-primary"
                >
                  Forgot password?
                </Link>
              }
            />

            <label className="flex w-fit items-center gap-2.5 text-[13.5px] font-medium text-auth-ink-soft">
              <input
                id="remember-me"
                name="rememberMe"
                type="checkbox"
                checked={rememberMe}
                onChange={(event) => setRememberMe(event.target.checked)}
                className="h-4 w-4 rounded-[5px] border-auth-line-strong accent-auth-primary"
              />
              Keep me signed in
            </label>

            <AuthButton
              type="submit"
              isBusy={isSubmitting}
              busyLabel="Signing in..."
              className="mt-1"
            >
              Sign in
            </AuthButton>
          </form>
        </div>

        <div
          role="tabpanel"
          id="login-panel-code"
          aria-labelledby="login-tab-code"
          hidden={mode !== "code"}
        >
          <LoginCodeForm email={email} onEmailChange={setEmail} />
        </div>
      </AuthCard>

      <AuthFooter>
        Don&apos;t have an account?{" "}
        <Link href="/signup" className={authLinkClasses}>
          Create one
        </Link>
      </AuthFooter>
    </AuthLayout>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
