"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Mail, Eye, EyeOff, Globe, Calendar, Users, IndianRupee, Plus, Building2 } from "lucide-react";

// Signup screen — PRD §6.1 (FR-1.1, FR-1.2).
// Creates one Tenant + one owner User, then sends a verification link.

/** Kept in step with MIN_PASSWORD_LENGTH in src/app/api/auth/signup/route.ts. */
const MIN_PASSWORD_LENGTH = 12;

const UNREACHABLE_MESSAGE =
  "Could not reach the server. Check your connection and try again.";

const FALLBACK_ERROR_MESSAGE = "Could not create the account. Try again.";

function SignupContent() {
  const router = useRouter();
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
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
        body: JSON.stringify({ businessName, email, password }),
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
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 sm:p-8">
      <div className="flex w-full max-w-[1200px] overflow-hidden rounded-[2rem] bg-white shadow-xl min-h-[720px]">
        {/* Left side: Signup Form */}
        <div className="flex w-full flex-col p-8 lg:w-[55%] lg:p-12 xl:p-16">
          <div className="flex items-center gap-3 mb-8">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-600">
              <Plus className="h-6 w-6 stroke-[3]" />
            </div>
            <div>
              <div className="font-bold text-slate-900 text-xl tracking-tight leading-none">Medicare Pro</div>
              <div className="text-xs text-slate-500 font-medium mt-0.5">Smart Clinic Management</div>
            </div>
          </div>

          <div className="mx-auto w-full max-w-sm flex-grow flex flex-col justify-center">
            <div className="mb-8">
              <h1 className="text-3xl font-bold tracking-tight text-slate-900">
                Create Account
              </h1>
              <p className="mt-2 text-sm text-slate-500">
                Join MEDCARE PRO to manage your clinic
              </p>
            </div>

            <form onSubmit={handleSubmit} noValidate={false} className="space-y-5">
              {error && (
                <p
                  role="alert"
                  id="signup-error"
                  className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
                >
                  {error}
                </p>
              )}

              <div>
                <label htmlFor="businessName" className="block text-sm font-medium text-slate-700 mb-2">
                  Business or clinic name
                </label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                    <Building2 className="h-5 w-5 text-violet-600" aria-hidden="true" />
                  </div>
                  <input
                    id="businessName"
                    name="businessName"
                    type="text"
                    autoComplete="organization"
                    autoFocus
                    required
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    aria-describedby={error ? "signup-error" : undefined}
                    placeholder="Dental Care Clinic"
                    className="block w-full rounded-xl border border-slate-200 py-3.5 pl-11 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-600 focus:outline-none focus:ring-1 focus:ring-violet-600"
                  />
                </div>
              </div>

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
                    aria-describedby={error ? "signup-error" : undefined}
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
                    autoComplete="new-password"
                    required
                    minLength={MIN_PASSWORD_LENGTH}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    aria-describedby="password-hint"
                    placeholder="••••••••••••••••"
                    className="block w-full rounded-xl border border-slate-200 py-3.5 pl-4 pr-11 text-sm tracking-[0.2em] text-slate-900 placeholder:text-slate-400 placeholder:tracking-[0.2em] focus:border-violet-600 focus:outline-none focus:ring-1 focus:ring-violet-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 flex items-center pr-4 text-violet-600 hover:text-violet-700 focus:outline-none"
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
                <p id="password-hint" className="mt-1.5 text-xs text-slate-500">
                  At least {MIN_PASSWORD_LENGTH} characters.
                </p>
              </div>

              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-slate-700 mb-2">
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
                    className="block w-full rounded-xl border border-slate-200 py-3.5 pl-4 pr-11 text-sm tracking-[0.2em] text-slate-900 placeholder:text-slate-400 placeholder:tracking-[0.2em] focus:border-violet-600 focus:outline-none focus:ring-1 focus:ring-violet-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute inset-y-0 right-0 flex items-center pr-4 text-violet-600 hover:text-violet-700 focus:outline-none"
                  >
                    {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="mt-4 flex w-full justify-center rounded-xl bg-[#6B46C1] hover:bg-[#5a3aa6] py-3.5 px-4 text-sm font-semibold text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-[#6B46C1] focus:ring-offset-2 disabled:opacity-70 transition-colors"
              >
                {isSubmitting ? "Creating Account..." : "Create Account"}
              </button>
            </form>
            
            <p className="mt-8 text-center text-sm text-slate-500">
              Already have an account?{" "}
              <Link href="/login" className="font-semibold text-violet-600 hover:text-violet-700">
                Sign In
              </Link>
            </p>
          </div>
        </div>

        {/* Right side: Image and Stats */}
        <div className="relative hidden w-[45%] lg:block p-4 pl-0">
          <div className="relative h-full w-full rounded-2xl overflow-hidden shadow-sm">
            <Image
              src="/clinic-bg-generic.jpg"
              alt="Generic Clinic"
              fill
              className="object-cover"
              priority
            />
            {/* Top Right EN button */}
            <div className="absolute top-6 right-6">
              <button className="flex items-center gap-2 rounded-xl bg-white/95 backdrop-blur-md px-4 py-2 text-sm font-medium text-slate-700 shadow-sm border border-white/20">
                <Globe className="h-4 w-4" />
                EN
                <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>

            {/* Top Left floating card */}
            <div className="absolute top-16 left-8 rounded-2xl bg-white/95 backdrop-blur-md px-5 py-4 shadow-xl border border-white/30 flex items-center gap-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-100 text-[#6B46C1]">
                <Calendar className="h-5 w-5" />
              </div>
              <div>
                <div className="text-xs font-medium text-slate-500 mb-0.5">Today's Appointments</div>
                <div className="text-[15px] font-bold text-[#6B46C1]">8 Scheduled</div>
              </div>
              {/* Little purple dot */}
              <div className="absolute top-3 right-3 h-2 w-2 rounded-full bg-[#6B46C1]" />
            </div>

            {/* Bottom Left floating card */}
            <div className="absolute bottom-16 left-8 rounded-3xl bg-white/95 backdrop-blur-md p-6 shadow-xl border border-white/30 w-64">
              <h3 className="text-sm font-bold text-slate-900 mb-5">Today's Overview</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-slate-700">
                      <Users className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-[11px] font-medium text-slate-500">Patients</div>
                      <div className="font-bold text-sm text-slate-900 leading-tight">24</div>
                    </div>
                  </div>
                  <div className="text-xs font-bold text-emerald-500 bg-emerald-50 px-2 py-1 rounded-md">+12%</div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-slate-700">
                      <Calendar className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-[11px] font-medium text-slate-500">Appointments</div>
                      <div className="font-bold text-sm text-slate-900 leading-tight">18</div>
                    </div>
                  </div>
                  <div className="text-xs font-bold text-emerald-500 bg-emerald-50 px-2 py-1 rounded-md">+8%</div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-slate-700">
                      <IndianRupee className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-[11px] font-medium text-slate-500">Revenue</div>
                      <div className="font-bold text-sm text-slate-900 leading-tight">₹45,230</div>
                    </div>
                  </div>
                  <div className="text-xs font-bold text-emerald-500 bg-emerald-50 px-2 py-1 rounded-md">+15%</div>
                </div>
              </div>
            </div>

            {/* Bottom Right Quote card */}
            <div className="absolute bottom-16 right-8 rounded-3xl bg-[#6B46C1] p-7 shadow-xl w-60 text-white border border-white/10">
              {/* Avatars */}
              <div className="flex -space-x-3 mb-6 relative -top-12 -mt-2">
                <img src="https://ui-avatars.com/api/?name=J+D&background=e0e7ff&color=4f46e5&size=128" alt="Doctor" className="h-12 w-12 rounded-full border-2 border-[#6B46C1] bg-white object-cover shadow-sm" />
                <img src="https://ui-avatars.com/api/?name=A+S&background=dcfce7&color=16a34a&size=128" alt="Doctor" className="h-12 w-12 rounded-full border-2 border-[#6B46C1] bg-white object-cover shadow-sm" />
                <img src="https://ui-avatars.com/api/?name=M+R&background=fce7f3&color=db2777&size=128" alt="Doctor" className="h-12 w-12 rounded-full border-2 border-[#6B46C1] bg-white object-cover shadow-sm" />
              </div>
              <div className="text-5xl font-serif leading-none mb-2 text-white opacity-80">&ldquo;</div>
              <p className="text-base font-medium leading-relaxed mb-6 -mt-2">
                Delivering better care, every day.
              </p>
              <p className="text-xs font-medium text-violet-200">
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
