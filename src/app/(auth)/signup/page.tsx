"use client";

import { Suspense, useState, type FormEvent, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Building2, Mail, MapPin, Phone, User as UserIcon } from "lucide-react";
import AuthAlert from "@/components/auth/AuthAlert";
import AuthButton, { authLinkClasses } from "@/components/auth/AuthButton";
import AuthCard from "@/components/auth/AuthCard";
import AuthField, { AuthTextarea } from "@/components/auth/AuthField";
import AuthFooter from "@/components/auth/AuthFooter";
import AuthHeader from "@/components/auth/AuthHeader";
import AuthLayout from "@/components/auth/AuthLayout";
import PasswordField from "@/components/auth/PasswordField";
import { MIN_PASSWORD_LENGTH } from "@/lib/signupInput";

// Clinic registration — PRD §6.1 (FR-1.1, FR-1.2), widened by Stage 3.
//
// Creates one Tenant plus one applicant User as PENDING, then sends a
// verification link. Approval by the Platform Owner is a separate step, so
// finishing this form does NOT grant access — see /pending-approval.
//
// THE FIELD LIST IS THE SERVER'S, NOT THIS SCREEN'S. Every input below maps to
// a key in src/lib/signupInput.ts, which the API route validates against; the
// redesign regrouped and relabelled them and added nothing. MIN_PASSWORD_LENGTH
// is imported from there rather than restated, so the two cannot drift.
//
// ONE SIGNUP CREATES ONE ACCOUNT. The clinic name here is the account's first
// clinic, not a separate workspace or a separate login — more clinics are added
// from inside the app, under this same account. The hint under the field says
// so, because "clinic name" on a signup form otherwise reads as "one login per
// clinic".

const UNREACHABLE_MESSAGE =
  "Could not reach the server. Check your connection and try again.";

const FALLBACK_ERROR_MESSAGE = "Could not create the account. Try again.";

const PASSWORD_MISMATCH_MESSAGE = "The two passwords do not match.";

/** A quiet rule with a caption, used to split a long form into two readable halves. */
function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-auth-faint">
      {children}
    </p>
  );
}

function SignupContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [name, setName] = useState("");
  const [clinicName, setClinicName] = useState("");
  /**
   * Prefilled when /login or /forgot-password sends someone here after failing
   * to find an account. The parameter is forgeable and is treated as nothing
   * more than a default field value — the server re-reads the address from the
   * submitted body.
   */
  const [email, setEmail] = useState(() => searchParams.get("email") ?? "");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [businessEmail, setBusinessEmail] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [error, setError] = useState<string | null>(null);
  /** Shown under the confirmation field, where the problem actually is. */
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setConfirmError(null);

    if (password !== confirmPassword) {
      setConfirmError(PASSWORD_MISMATCH_MESSAGE);
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          clinicName,
          city,
          phone,
          address,
          businessEmail,
          password,
          acceptTerms,
        }),
      });

      const body: { success?: boolean; error?: string } = await response
        .json()
        .catch(() => ({}));

      if (!response.ok || !body.success) {
        // The route's messages are already user-facing and carry the detail
        // that matters (address taken, email delivery failed), so they are
        // shown as-is rather than flattened into one generic string.
        setError(body.error ?? FALLBACK_ERROR_MESSAGE);
        setPassword("");
        setConfirmPassword("");
        return;
      }

      // FR-1.2 — the account exists but cannot log in yet. Send the user to the
      // "check your inbox" screen, carrying the address so it can offer a resend.
      router.push(`/verify-email?email=${encodeURIComponent(email)}`);
    } catch {
      // Network/server failure — deliberately not surfacing the thrown error.
      setError(UNREACHABLE_MESSAGE);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthLayout width="wide">
      <AuthCard>
        <AuthHeader
          title="Create your MedCare Pro account"
          description="Set up your account and start managing your clinic operations."
        />

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
            <AuthAlert id="signup-error" tone="error">
              {error}
            </AuthAlert>
          )}

          <SectionLabel>Your details</SectionLabel>

          <AuthField
            id="name"
            name="name"
            type="text"
            label="Your name"
            autoComplete="name"
            autoFocus
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            icon={<UserIcon className="h-[18px] w-[18px]" strokeWidth={2} />}
            describedBy={error ? "signup-error" : undefined}
          />

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
            hint="This is the address you will sign in with."
            describedBy={error ? "signup-error" : undefined}
          />

          <PasswordField
            id="password"
            name="password"
            label="Password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            showGuidance
            minPasswordLength={MIN_PASSWORD_LENGTH}
          />

          <PasswordField
            id="confirmPassword"
            name="confirmPassword"
            label="Confirm password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            value={confirmPassword}
            onChange={(event) => {
              setConfirmPassword(event.target.value);
              if (confirmError) {
                setConfirmError(null);
              }
            }}
            error={confirmError ?? undefined}
          />

          <div className="pt-2">
            <SectionLabel>Your clinic</SectionLabel>
          </div>

          <AuthField
            id="clinicName"
            name="clinicName"
            type="text"
            label="Clinic or business name"
            autoComplete="organization"
            required
            value={clinicName}
            onChange={(event) => setClinicName(event.target.value)}
            icon={<Building2 className="h-[18px] w-[18px]" strokeWidth={2} />}
            hint="You can add more clinics to this account later."
          />

          <div className="grid gap-5 sm:grid-cols-2">
            <AuthField
              id="city"
              name="city"
              type="text"
              label="City"
              autoComplete="address-level2"
              required
              value={city}
              onChange={(event) => setCity(event.target.value)}
              icon={<MapPin className="h-[18px] w-[18px]" strokeWidth={2} />}
            />

            <AuthField
              id="phone"
              name="phone"
              type="tel"
              label="Phone"
              autoComplete="tel"
              required
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              icon={<Phone className="h-[18px] w-[18px]" strokeWidth={2} />}
            />
          </div>

          <AuthTextarea
            id="address"
            name="address"
            label="Address (optional)"
            autoComplete="street-address"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          />

          <AuthField
            id="businessEmail"
            name="businessEmail"
            type="email"
            label="Business contact email (optional)"
            value={businessEmail}
            onChange={(event) => setBusinessEmail(event.target.value)}
            hint="Used for billing and notices. You still sign in with the email above."
          />

          <label className="flex items-start gap-3 rounded-[14px] border border-auth-line bg-auth-bg p-3.5 text-[13.5px] leading-relaxed text-auth-ink-soft">
            <input
              id="acceptTerms"
              name="acceptTerms"
              type="checkbox"
              required
              checked={acceptTerms}
              onChange={(event) => setAcceptTerms(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded-[5px] border-auth-line-strong accent-auth-primary"
            />
            {/*
              No links yet: this repo has no /terms or /privacy route, and
              pointing a required consent at a 404 is worse than plain text.
              Wire both up when the documents exist — the timestamp stored in
              tenants.terms_accepted_at is what dates the acceptance.
            */}
            <span>
              By continuing, you agree to the MedCare Pro Terms of Service and
              Privacy Policy.
            </span>
          </label>

          <AuthButton
            type="submit"
            isBusy={isSubmitting}
            busyLabel="Creating account..."
            className="mt-1"
          >
            Create account
          </AuthButton>
        </form>
      </AuthCard>

      <AuthFooter>
        Already have an account?{" "}
        <Link href="/login" className={authLinkClasses}>
          Sign in
        </Link>
      </AuthFooter>
    </AuthLayout>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupContent />
    </Suspense>
  );
}
