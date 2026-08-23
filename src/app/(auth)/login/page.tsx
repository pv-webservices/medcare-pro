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
import { Mail, Eye, EyeOff, AlertCircle } from "lucide-react";
import AuthShell from "@/components/auth/AuthShell";
import LoginCodeForm from "@/components/auth/LoginCodeForm";
import { getSessionEndedMessage } from "@/lib/sessionEndedMessage";

// Login screen — PRD §6.1 (FR-1.3, FR-1.4, FR-1.5), with Stage 5's second
// authentication method alongside the password one.

const INVALID_CREDENTIALS_MESSAGE =
  "Invalid email or password. Check your details and try again.";

const UNREACHABLE_MESSAGE =
  "Could not reach the server. Check your connection and try again.";

const EMAIL_NOT_VERIFIED_CODE = "EmailNotVerified";

/**
 * Thrown by src/lib/auth.ts when the address has no account at all — the one
 * refusal that names an account fact. Read the note on `AccountNotFoundError`
 * there before treating any other refusal the same way.
 */
const ACCOUNT_NOT_FOUND_CODE = "AccountNotFound";

const ACCOUNT_NOT_FOUND_MESSAGE =
  "No account exists for that email address. Sign up to create one.";

/**
 * Stage 3 item 4 — the applicant's organisation exists and their password is
 * right, but the application has not been approved. Auth.js surfaces these as
 * `result.code`; see ClinicStateError in src/lib/auth.ts for what each one is
 * allowed to disclose and why.
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
  const [showPassword, setShowPassword] = useState(false);
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
    <AuthShell>
            <div className="mb-8">
              <h1 className="text-4xl font-bold tracking-tight text-slate-900">
                Welcome Back
              </h1>
              <p className="mt-3 text-sm text-slate-500">
                Sign in to your clinic dashboard
              </p>
            </div>

            {/* Page-level notices — they apply whichever method is chosen. */}
            <div className="space-y-4 empty:hidden">
              {sessionEndedMessage && !error && (
                <p
                  role="status"
                  aria-live="polite"
                  className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"
                >
                  {sessionEndedMessage}
                </p>
              )}
              {justReset && !error && (
                <p
                  role="status"
                  aria-live="polite"
                  className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800"
                >
                  Your password has been changed. Sign in with it to continue.
                </p>
              )}
              {justVerified && !error && !isUnverified && (
                <p
                  role="status"
                  aria-live="polite"
                  className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800"
                >
                  Your email is verified. Log in to continue.
                </p>
              )}
            </div>

            <div
              role="tablist"
              aria-label="Sign-in method"
              className="mt-6 mb-8 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1"
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
                    className={`rounded-lg py-2.5 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-violet-600 focus:ring-offset-2 ${
                      isActive
                        ? "bg-white text-violet-700 shadow-sm"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
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
              <form method="post" onSubmit={handleSubmit} className="space-y-6">
                {isUnverified && (
                  <p
                    role="alert"
                    aria-live="assertive"
                    className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
                  >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>
                      Please verify your email before logging in. Check your inbox for the link, or{" "}
                      <Link
                        href={`/verify-email?email=${encodeURIComponent(email)}`}
                        className="font-medium underline hover:text-amber-900"
                      >
                        request a new one
                      </Link>
                      .
                    </span>
                  </p>
                )}
                {error && (
                  <p
                    id="login-password-error"
                    role="alert"
                    aria-live="assertive"
                    className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
                  >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>
                      <span className="font-semibold">Error:</span> {error}
                      {isUnknownAccount && (
                        <>
                          {" "}
                          <Link
                            href={`/signup?email=${encodeURIComponent(email)}`}
                            className="font-semibold underline hover:text-red-900"
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
                  <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-2">
                    Email
                  </label>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                      <Mail className="h-5 w-5 text-violet-600" aria-hidden="true" />
                    </div>
                    <input
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? "login-password-error" : undefined}
                      placeholder="dr.amelia@dentalcare.com"
                      className="block w-full rounded-xl border border-slate-200 py-3.5 pl-11 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-600 focus:outline-none focus:ring-1 focus:ring-violet-600"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-2">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? "login-password-error" : undefined}
                      placeholder="••••••••••••••••"
                      className="block w-full rounded-xl border border-slate-200 py-3.5 pl-4 pr-11 text-sm tracking-[0.2em] text-slate-900 placeholder:text-slate-400 placeholder:tracking-[0.2em] focus:border-violet-600 focus:outline-none focus:ring-1 focus:ring-violet-600"
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

                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center">
                    <input
                      id="remember-me"
                      name="rememberMe"
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-600"
                    />
                    <label htmlFor="remember-me" className="ml-2 block text-sm text-slate-600 font-medium">
                      Remember me
                    </label>
                  </div>
                  <div className="text-sm">
                    {/*
                      Was `<a href="#">`, which reloaded the page and went
                      nowhere — there was no reset flow behind it at all. The
                      address already typed here is carried over so it does not
                      have to be typed again; /forgot-password treats it as a
                      default field value and nothing more.
                    */}
                    <Link
                      href={
                        email
                          ? `/forgot-password?email=${encodeURIComponent(email)}`
                          : "/forgot-password"
                      }
                      className="font-medium text-violet-600 hover:text-violet-700"
                    >
                      Forgot password?
                    </Link>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="mt-2 flex w-full justify-center rounded-xl bg-primary hover:bg-primary-hover py-3.5 px-4 text-sm font-semibold text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-70 transition-colors"
                >
                  {isSubmitting ? "Signing In..." : "Sign In"}
                </button>
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

            <p className="mt-10 text-center text-sm text-slate-500">
              Don&apos;t have an account?{" "}
              <Link href="/signup" className="font-semibold text-violet-600 hover:text-violet-700">
                Sign up
              </Link>
            </p>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
