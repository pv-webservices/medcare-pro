"use client";

import {
  Suspense,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Mail, MailWarning } from "lucide-react";
import AuthAlert from "@/components/auth/AuthAlert";
import AuthButton, { authLinkClasses } from "@/components/auth/AuthButton";
import AuthCard from "@/components/auth/AuthCard";
import AuthField from "@/components/auth/AuthField";
import AuthFooter from "@/components/auth/AuthFooter";
import AuthHeader from "@/components/auth/AuthHeader";
import AuthLayout from "@/components/auth/AuthLayout";
import VerificationBadge from "@/components/auth/VerificationBadge";
import {
  formatCooldown,
  remainingCooldownMs,
} from "@/components/auth/loginCodeState";

// Email verification screen — PRD §6.1 (FR-1.2, FR-1.5).
//
// TWO SCREENS IN ONE ROUTE, chosen by `?status=`. With no status it is the page
// signup hands off to: "we have sent you a link". With one, the user has just
// followed a link that did not work, and the page leads with the reason.
//
// THE POST IS UNCHANGED. One request, to /api/auth/verify-email, with one field.
// The server decides what to say and whether an address even exists — the copy
// below is the acknowledgement, never a claim about an account.

const UNREACHABLE_MESSAGE =
  "Could not reach the server. Check your connection and try again.";

const RESEND_FAILED_MESSAGE = "Could not send the link. Try again shortly.";

const RESEND_SENT_MESSAGE =
  "If that address needs verification, a new link is on its way.";

/**
 * How long the resend button stays down after a successful send. It is this
 * screen's own number, not an import of the login-code cooldown: the two
 * endpoints are different and the shared constant would tie them together for
 * no reason. The countdown helpers are shared; the value is not.
 */
const RESEND_COOLDOWN_MS = 60 * 1000;

const STATUS_MESSAGES: Record<string, string> = {
  invalid: "That verification link is not valid. Request a new one below.",
  expired: "That verification link has expired. Request a new one below.",
  error: "Something went wrong verifying your email. Request a new link below.",
};

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const status = searchParams.get("status");
  /**
   * Carried over by signup and by the login screen's unverified notice. It is
   * forgeable and is treated as a default field value only — it is never
   * rendered as a claim that the address has an account.
   */
  const emailFromSignup = searchParams.get("email") ?? "";

  const [email, setEmail] = useState(emailFromSignup);
  /** Reveals the address field when the prefilled one is wrong. */
  const [isEditingEmail, setIsEditingEmail] = useState(emailFromSignup === "");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  /**
   * A CLIENT-SIDE COURTESY, NOT THE RATE LIMIT. The server has its own, and it
   * is the one that counts; this only stops the button being pressed six times
   * while the first mail is still in flight, and gives the wait a number.
   */
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const remainingMs = remainingCooldownMs(lastSentAt, now, RESEND_COOLDOWN_MS);
  const isCoolingDown = remainingMs > 0;

  // Ticks only while there is something to count down — a permanent interval on
  // an idle page is a render a second for the life of the tab.
  useEffect(() => {
    if (!isCoolingDown) {
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isCoolingDown]);

  const statusMessage = status ? STATUS_MESSAGES[status] : undefined;
  const isPostSignup = !status;

  async function handleResend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting || isCoolingDown) {
      return;
    }

    setNotice(null);
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const body: { success?: boolean; error?: string; message?: string } =
        await response.json().catch(() => ({}));

      if (!response.ok || !body.success) {
        setError(body.error ?? RESEND_FAILED_MESSAGE);
        return;
      }

      setNotice(body.message ?? RESEND_SENT_MESSAGE);
      setLastSentAt(Date.now());
      setNow(Date.now());
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
          badge={
            <VerificationBadge tone={isPostSignup ? "pending" : "warning"}>
              {isPostSignup ? (
                <Mail className="h-6 w-6" strokeWidth={1.9} />
              ) : (
                <MailWarning className="h-6 w-6" strokeWidth={1.9} />
              )}
            </VerificationBadge>
          }
          title={isPostSignup ? "Check your inbox" : "Verify your email"}
          description={
            isPostSignup ? (
              <>
                We sent a verification link to{" "}
                {emailFromSignup ? (
                  <span className="font-semibold text-auth-ink">
                    {emailFromSignup}
                  </span>
                ) : (
                  "your email address"
                )}
                . Open it to activate your account — you cannot sign in until you
                do.
              </>
            ) : (
              "Request a new verification link and we will email it straight away."
            )
          }
        />

        <form onSubmit={handleResend} className="space-y-5">
          <div className="space-y-3 empty:hidden">
            {statusMessage && !error && (
              <AuthAlert tone="warning">{statusMessage}</AuthAlert>
            )}
            {notice && (
              <AuthAlert tone="success" title="Verification email sent">
                {notice}
              </AuthAlert>
            )}
            {error && (
              <AuthAlert id="resend-error" tone="error">
                {error}
              </AuthAlert>
            )}
          </div>

          {isEditingEmail ? (
            <AuthField
              id="email"
              name="email"
              type="email"
              label="Email address"
              autoComplete="email"
              required
              autoFocus={emailFromSignup !== ""}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              icon={<Mail className="h-[18px] w-[18px]" strokeWidth={2} />}
              describedBy={error ? "resend-error" : undefined}
              placeholder="you@clinic.com"
            />
          ) : (
            // The address is already known, so it is shown rather than asked
            // for again. The hidden input keeps the submitted body identical to
            // the edited case.
            <div className="flex items-center justify-between gap-3 rounded-[14px] border border-auth-line bg-auth-bg px-4 py-3.5">
              <span className="min-w-0 truncate text-[14px] font-medium text-auth-ink">
                {email}
              </span>
              <button
                type="button"
                onClick={() => setIsEditingEmail(true)}
                className="shrink-0 rounded text-[13px] font-semibold text-auth-primary transition-colors duration-150 hover:text-auth-primary-hover"
              >
                Change
              </button>
              <input type="hidden" name="email" value={email} />
            </div>
          )}

          <AuthButton
            type="submit"
            disabled={isCoolingDown}
            isBusy={isSubmitting}
            busyLabel="Sending..."
          >
            {isCoolingDown
              ? `Resend in ${formatCooldown(remainingMs)}`
              : "Resend verification email"}
          </AuthButton>

          <Link
            href="/login"
            className="flex min-h-[46px] items-center justify-center gap-2 rounded-[14px] text-[14px] font-semibold text-auth-muted transition-colors duration-150 hover:bg-auth-bg-tint hover:text-auth-ink"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to sign in
          </Link>
        </form>
      </AuthCard>

      <AuthFooter>
        Wrong address?{" "}
        <Link href="/signup" className={authLinkClasses}>
          Create a new account
        </Link>
      </AuthFooter>
    </AuthLayout>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailContent />
    </Suspense>
  );
}
