"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Mail, Eye, EyeOff, Globe, Calendar, Users, IndianRupee, Plus, Building2, User as UserIcon, MapPin, Phone } from "lucide-react";
import { MIN_PASSWORD_LENGTH } from "@/lib/signupInput";

// Clinic registration — PRD §6.1 (FR-1.1, FR-1.2), widened by Stage 3.
//
// Creates one Tenant plus one applicant User as PENDING, then sends a
// verification link. Approval by the Platform Owner is a separate step, so
// finishing this form does NOT grant access — see /pending-approval.
//
// The field list and its rules live in src/lib/signupInput.ts, which the route
// validates against too. The constants below are imported from there rather
// than restated, so the two cannot drift.

const FIELD_CLASS =
  "block w-full rounded-2xl shadow-neu-inset py-3.5 px-4 text-sm text-ink placeholder:text-faint";

const FIELD_CLASS_ICON =
  "block w-full rounded-2xl shadow-neu-inset py-3.5 pl-11 pr-4 text-sm text-ink placeholder:text-faint";

const LABEL_CLASS = "block text-sm font-medium text-ink mb-2";

const UNREACHABLE_MESSAGE =
  "Could not reach the server. Check your connection and try again.";

const FALLBACK_ERROR_MESSAGE = "Could not create the account. Try again.";

function SignupContent() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [clinicName, setClinicName] = useState("");
  const [email, setEmail] = useState("");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [businessEmail, setBusinessEmail] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    
    if (password !== confirmPassword) {
      setError("Passwords do not match. Please check and try again.");
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
    <div className="flex min-h-screen items-center justify-center bg-canvas-deep p-4 sm:p-8">
      <div className="flex w-full max-w-[1200px] overflow-hidden rounded-[2rem] bg-canvas shadow-neu-float min-h-[720px]">
        {/* Left side: Signup Form */}
        <div className="flex w-full flex-col p-8 lg:w-[55%] lg:p-12 xl:p-16">
          <div className="flex items-center gap-3 mb-8">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <Plus className="h-6 w-6 stroke-[3]" />
            </div>
            <div>
              <div className="font-bold text-ink text-xl tracking-tight leading-none">Medicare Pro</div>
              <div className="text-xs text-muted font-medium mt-0.5">Smart Clinic Management</div>
            </div>
          </div>

          <div className="mx-auto w-full max-w-sm flex-grow flex flex-col justify-center">
            <div className="mb-8">
              <h1 className="text-3xl font-bold tracking-tight text-ink">
                Create Account
              </h1>
              <p className="mt-2 text-sm text-muted">
                Join MEDCARE PRO to manage your clinic
              </p>
            </div>

            {/*
              `method="post"` guards the instant before hydration: a <form> with no
              `method` defaults to GET, so a submit landing before React attaches its
              handler would send the password as a QUERY STRING — into the URL bar,
              into history, and into every proxy log on the way. POST puts it in a
              body instead. handleSubmit still preventDefaults and posts with fetch;
              this only bounds what a stray native submit can do. Longer note in
              src/components/auth/ResetPasswordForm.tsx.
            */}
            <form method="post" onSubmit={handleSubmit} noValidate={false} className="space-y-5">
              {error && (
                <p
                  role="alert"
                  id="signup-error"
                  className="rounded-xl bg-alert-bg p-3 text-sm text-alert-ink"
                >
                  {error}
                </p>
              )}

              <div>
                <label htmlFor="name" className={LABEL_CLASS}>
                  Your name
                </label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                    <UserIcon className="h-5 w-5 text-accent" aria-hidden="true" />
                  </div>
                  <input
                    id="name"
                    name="name"
                    type="text"
                    autoComplete="name"
                    autoFocus
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    aria-describedby={error ? "signup-error" : undefined}
                    placeholder="Dr Amelia Rao"
                    className={FIELD_CLASS_ICON}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="clinicName" className={LABEL_CLASS}>
                  Clinic name
                </label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                    <Building2 className="h-5 w-5 text-accent" aria-hidden="true" />
                  </div>
                  <input
                    id="clinicName"
                    name="clinicName"
                    type="text"
                    autoComplete="organization"
                    required
                    value={clinicName}
                    onChange={(e) => setClinicName(e.target.value)}
                    placeholder="Dental Care Clinic"
                    className={FIELD_CLASS_ICON}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="email" className="block text-sm font-medium text-ink mb-2">
                  Email
                </label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                    <Mail className="h-5 w-5 text-accent" aria-hidden="true" />
                  </div>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    aria-describedby={error ? "signup-error" : undefined}
                    placeholder="dr.amelia@dentalcare.com"
                    className="block w-full rounded-2xl shadow-neu-inset py-3.5 pl-11 pr-4 text-sm text-ink placeholder:text-faint"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="city" className={LABEL_CLASS}>
                    City
                  </label>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                      <MapPin className="h-5 w-5 text-accent" aria-hidden="true" />
                    </div>
                    <input
                      id="city"
                      name="city"
                      type="text"
                      autoComplete="address-level2"
                      required
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="Pune"
                      className={FIELD_CLASS_ICON}
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="phone" className={LABEL_CLASS}>
                    Phone
                  </label>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                      <Phone className="h-5 w-5 text-accent" aria-hidden="true" />
                    </div>
                    <input
                      id="phone"
                      name="phone"
                      type="tel"
                      autoComplete="tel"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+91 98765 43210"
                      className={FIELD_CLASS_ICON}
                    />
                  </div>
                </div>
              </div>

              <div>
                <label htmlFor="address" className={LABEL_CLASS}>
                  Address <span className="font-normal text-faint">(optional)</span>
                </label>
                <textarea
                  id="address"
                  name="address"
                  rows={2}
                  autoComplete="street-address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Shop 4, MG Road"
                  className={FIELD_CLASS}
                />
              </div>

              <div>
                <label htmlFor="businessEmail" className={LABEL_CLASS}>
                  Business contact email{""}
                  <span className="font-normal text-faint">(optional)</span>
                </label>
                <input
                  id="businessEmail"
                  name="businessEmail"
                  type="email"
                  value={businessEmail}
                  onChange={(e) => setBusinessEmail(e.target.value)}
                  placeholder="accounts@dentalcare.com"
                  className={FIELD_CLASS}
                />
                <p className="mt-1.5 text-xs text-muted">
                  Used for billing and notices. You still sign in with the email
                  above.
                </p>
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-ink mb-2">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    minLength={MIN_PASSWORD_LENGTH}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    aria-describedby="password-hint"
                    placeholder="••••••••••••••••"
                    className="block w-full rounded-2xl shadow-neu-inset py-3.5 pl-4 pr-11 text-sm tracking-[0.2em] text-ink placeholder:text-faint placeholder:tracking-[0.2em]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 flex items-center pr-4 text-accent hover:text-accent"
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
                <p id="password-hint" className="mt-1.5 text-xs text-muted">
                  At least {MIN_PASSWORD_LENGTH} characters.
                </p>
              </div>

              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-ink mb-2">
                  Confirm Password
                </label>
                <div className="relative">
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    minLength={MIN_PASSWORD_LENGTH}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••••••••••"
                    className="block w-full rounded-2xl shadow-neu-inset py-3.5 pl-4 pr-11 text-sm tracking-[0.2em] text-ink placeholder:text-faint placeholder:tracking-[0.2em]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute inset-y-0 right-0 flex items-center pr-4 text-accent hover:text-accent"
                  >
                    {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              <label className="flex items-start gap-3 text-sm text-muted">
                <input
                  id="acceptTerms"
                  name="acceptTerms"
                  type="checkbox"
                  required
                  checked={acceptTerms}
                  onChange={(e) => setAcceptTerms(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-line text-accent"
                />
                {/*
                  No links yet: this repo has no /terms or /privacy route, and
                  pointing a required consent at a 404 is worse than plain text.
                  Wire both up when the documents exist — the timestamp stored in
                  tenants.terms_accepted_at is what dates the acceptance.
                */}
                <span>
                  I accept the terms of service and privacy policy.
                </span>
              </label>

              <button
                type="submit"
                disabled={isSubmitting}
                className="mt-4 flex w-full justify-center rounded-xl bg-primary hover:bg-primary-hover py-3.5 px-4 text-sm font-semibold text-accent-ink shadow-neu-raised-sm focus:ring-primary disabled:opacity-70 transition-colors"
              >
                {isSubmitting ? "Creating Account..." : "Create Account"}
              </button>
            </form>
            
            <p className="mt-8 text-center text-sm text-muted">
              Already have an account?{""}
              <Link href="/login" className="font-semibold text-accent hover:text-accent">
                Sign In
              </Link>
            </p>
          </div>
        </div>

        {/* Right side: Image and Stats */}
        <div className="relative hidden w-[45%] lg:block p-4 pl-0">
          <div className="relative h-full w-full rounded-2xl overflow-hidden shadow-neu-raised-sm">
            <Image
              src="/clinic-bg-generic.jpg"
              alt="Generic Clinic"
              fill
              className="object-cover"
              priority
            />
            {/* Top Right EN button */}
            <div className="absolute top-6 right-6">
              <button className="flex items-center gap-2 rounded-xl bg-canvas/95 backdrop-blur-md px-4 py-2 text-sm font-medium text-ink shadow-neu-raised-sm">
                <Globe className="h-4 w-4" />
                EN
                <svg className="h-4 w-4 text-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>

            {/* Top Left floating card */}
            <div className="absolute top-16 left-8 rounded-2xl bg-canvas/95 backdrop-blur-md px-5 py-4 shadow-neu-float flex items-center gap-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-light text-primary">
                <Calendar className="h-5 w-5" />
              </div>
              <div>
                <div className="text-xs font-medium text-muted mb-0.5">Today's Appointments</div>
                <div className="text-[15px] font-bold text-primary">8 Scheduled</div>
              </div>
              {/* Little purple dot */}
              <div className="absolute top-3 right-3 h-2 w-2 rounded-full bg-primary" />
            </div>

            {/* Bottom Left floating card */}
            <div className="absolute bottom-16 left-8 rounded-3xl bg-canvas/95 backdrop-blur-md p-6 shadow-neu-float w-64">
              <h3 className="text-sm font-bold text-ink mb-5">Today's Overview</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-ink">
                      <Users className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-[11px] font-medium text-muted">Patients</div>
                      <div className="font-bold text-sm text-ink leading-tight">24</div>
                    </div>
                  </div>
                  <div className="text-xs font-bold text-ok-mark bg-ok-bg px-2 py-1 rounded-md">+12%</div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-ink">
                      <Calendar className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-[11px] font-medium text-muted">Appointments</div>
                      <div className="font-bold text-sm text-ink leading-tight">18</div>
                    </div>
                  </div>
                  <div className="text-xs font-bold text-ok-mark bg-ok-bg px-2 py-1 rounded-md">+8%</div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-ink">
                      <IndianRupee className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-[11px] font-medium text-muted">Revenue</div>
                      <div className="font-bold text-sm text-ink leading-tight">₹45,230</div>
                    </div>
                  </div>
                  <div className="text-xs font-bold text-ok-mark bg-ok-bg px-2 py-1 rounded-md">+15%</div>
                </div>
              </div>
            </div>

            {/* Bottom Right Quote card */}
            <div className="absolute bottom-16 right-8 rounded-3xl bg-accent p-7 shadow-neu-float w-60 text-accent-ink">
              {/* Avatars */}
              <div className="flex -space-x-3 mb-6 relative -top-12 -mt-2">
                <img src="https://ui-avatars.com/api/?name=J+D&background=e0e7ff&color=4f46e5&size=128" alt="Doctor" className="h-12 w-12 rounded-full border-2 border-primary bg-canvas object-cover shadow-neu-raised-sm" />
                <img src="https://ui-avatars.com/api/?name=A+S&background=dcfce7&color=16a34a&size=128" alt="Doctor" className="h-12 w-12 rounded-full border-2 border-primary bg-canvas object-cover shadow-neu-raised-sm" />
                <img src="https://ui-avatars.com/api/?name=M+R&background=fce7f3&color=db2777&size=128" alt="Doctor" className="h-12 w-12 rounded-full border-2 border-primary bg-canvas object-cover shadow-neu-raised-sm" />
              </div>
              <div className="text-5xl font-serif leading-none mb-2 text-accent-ink opacity-80">&ldquo;</div>
              <p className="text-base font-medium leading-relaxed mb-6 -mt-2">
                Delivering better care, every day.
              </p>
              <p className="text-xs font-medium text-accent-ink/80">
                Medicare Pro Team
              </p>
            </div>
            
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupContent />
    </Suspense>
  );
}
