"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import {
  AlertCircle,
  BarChart3,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  ShieldAlert,
  ShieldCheck,
  Users,
} from "lucide-react";

/**
 * Platform Owner sign-in form — Stage 2.
 *
 * ONE error message for every failure. Unknown address, wrong password,
 * suspended account and "correct credentials, but not an Owner" are
 * indistinguishable here, so the form cannot be used to enumerate which
 * addresses hold platform access.
 */

const SIGN_IN_FAILED_MESSAGE = "Sign in failed. Check your details and try again.";
const UNREACHABLE_MESSAGE = "Could not reach the server. Check your connection and try again.";

function ShieldPulseIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M8.5 12h2l1.5-3 2 6 1.5-3h2" />
    </svg>
  );
}

function DigitalWavePattern() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute bottom-0 left-0 h-[380px] w-full max-w-3xl overflow-hidden opacity-35 mix-blend-screen"
    >
      <svg
        className="h-full w-full"
        viewBox="0 0 800 400"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="wave-grad-1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#818cf8" stopOpacity="0.8" />
            <stop offset="50%" stopColor="#c084fc" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.2" />
          </linearGradient>
          <linearGradient id="wave-fade" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
            <stop offset="80%" stopColor="#ffffff" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          <mask id="fade-mask">
            <rect width="800" height="400" fill="url(#wave-fade)" />
          </mask>
        </defs>

        <g mask="url(#fade-mask)">
          {Array.from({ length: 16 }).map((_, rowIndex) => {
            const yBase = 220 + rowIndex * 9;
            const dotCount = 38;
            return (
              <g key={rowIndex}>
                {Array.from({ length: dotCount }).map((_, colIndex) => {
                  const x = (colIndex / (dotCount - 1)) * 800;
                  const waveOffset =
                    Math.sin(colIndex * 0.22 + rowIndex * 0.32) * (22 + rowIndex * 2);
                  const y = yBase + waveOffset;
                  const opacity =
                    0.2 + (rowIndex / 16) * 0.7 - Math.abs(colIndex - 19) * 0.018;
                  const r = 1 + (rowIndex % 3 === 0 ? 0.8 : 0.4);

                  return (
                    <circle
                      key={colIndex}
                      cx={x}
                      cy={y}
                      r={Math.max(0.6, r)}
                      fill="url(#wave-grad-1)"
                      opacity={Math.max(0.04, Math.min(1, opacity))}
                    />
                  );
                })}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

export default function OwnerLoginForm() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    setError(null);
    setIsSubmitting(true);

    try {
      const result = await signIn("credentials", { email, password, redirect: false });

      if (!result || result.error) {
        setError(SIGN_IN_FAILED_MESSAGE);
        setPassword("");
        return;
      }

      // Authorization is decided by the destination page, which reads platformRole
      // from the database. A non-Owner lands on a 404.
      router.push("/owner/dashboard");
      router.refresh();
    } catch {
      setError(UNREACHABLE_MESSAGE);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="owner-auth-scope relative flex min-h-screen w-full flex-col justify-center overflow-x-hidden bg-[#070d1d] font-sans text-white selection:bg-indigo-500/30 selection:text-indigo-200">
      {/* Background ambient lighting */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full bg-indigo-600/10 blur-[130px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-20 top-1/3 h-[600px] w-[600px] rounded-full bg-violet-600/15 blur-[140px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-20 left-10 h-[400px] w-[400px] rounded-full bg-indigo-500/10 blur-[120px]"
      />

      {/* Decorative tech dot-wave pattern */}
      <DigitalWavePattern />

      {/* Main Content Layout */}
      <div className="relative z-10 mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8 lg:py-16">
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-12 xl:gap-16">
          {/* Left Column: Presentation & Value Proposition */}
          <div className="flex flex-col justify-center lg:col-span-6 xl:col-span-6">
            {/* MEDCARE PRO Header Logo */}
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-indigo-400/30 bg-gradient-to-br from-indigo-500/20 to-purple-600/30 text-indigo-400 shadow-md shadow-indigo-500/10">
                <ShieldPulseIcon className="h-5 w-5" />
              </div>
              <div>
                <div className="text-base font-bold tracking-wide text-white sm:text-lg">
                  MEDCARE <span className="text-indigo-400">PRO</span>
                </div>
                <div className="text-xs font-medium text-slate-400">
                  Healthcare. Simplified.
                </div>
              </div>
            </div>

            {/* Hero Headline */}
            <div className="mt-8 sm:mt-12 lg:mt-14">
              <h1 className="text-3xl font-extrabold leading-[1.12] tracking-tight text-white sm:text-4xl lg:text-[46px]">
                Powering healthcare
                <br />
                with{" "}
                <span className="bg-gradient-to-r from-violet-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">
                  intelligence
                </span>
              </h1>
              <p className="mt-4 max-w-lg text-sm leading-relaxed text-slate-400 sm:text-base">
                MedCare Pro is a comprehensive healthcare management platform built to
                streamline operations and elevate patient care.
              </p>
            </div>

            {/* Feature Benefits List */}
            <div className="mt-8 space-y-4.5 sm:mt-10 sm:space-y-5">
              {/* Feature 1 */}
              <div className="flex items-start gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-700/60 bg-slate-900/80 text-indigo-400 shadow-sm">
                  <Users className="h-5 w-5" strokeWidth={2} />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-white sm:text-base">
                    Centralized Management
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-400 sm:text-sm">
                    Manage users, facilities, and services from one secure platform.
                  </p>
                </div>
              </div>

              {/* Feature 2 */}
              <div className="flex items-start gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-700/60 bg-slate-900/80 text-indigo-400 shadow-sm">
                  <BarChart3 className="h-5 w-5" strokeWidth={2} />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-white sm:text-base">
                    Real-time Insights
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-400 sm:text-sm">
                    Monitor performance and make data-driven decisions.
                  </p>
                </div>
              </div>

              {/* Feature 3 */}
              <div className="flex items-start gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-700/60 bg-slate-900/80 text-indigo-400 shadow-sm">
                  <ShieldCheck className="h-5 w-5" strokeWidth={2} />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-white sm:text-base">
                    Enterprise Security
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-400 sm:text-sm">
                    Bank-level security to protect your data and your patients.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Superadmin Login Card */}
          <div className="w-full max-w-[500px] mx-auto lg:col-span-6 lg:ml-auto xl:col-span-6">
            <div className="relative rounded-[28px] border border-slate-700/60 bg-[#0d1428]/85 p-6.5 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.8)] backdrop-blur-xl sm:p-9">
              {/* Card Shield Icon Badge */}
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-indigo-500/30 bg-gradient-to-b from-indigo-500/20 to-purple-600/30 text-indigo-400 shadow-lg shadow-indigo-500/10">
                <ShieldPulseIcon className="h-7 w-7" />
              </div>

              <div className="mb-6 text-center">
                <h3 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
                  Superadmin access
                </h3>
                <p className="mt-1 text-xs text-slate-400 sm:text-sm">
                  MEDCARE PRO administration
                </p>
              </div>

              <form method="post" onSubmit={handleSubmit} className="space-y-4.5">
                {error && (
                  <div
                    role="alert"
                    className="flex items-start gap-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300 sm:text-sm"
                  >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                    <span>{error}</span>
                  </div>
                )}

                {/* Email Field */}
                <div>
                  <label
                    htmlFor="owner-email"
                    className="mb-1.5 block text-xs font-medium text-slate-300 sm:text-sm"
                  >
                    Email
                  </label>
                  <div className="relative">
                    <Mail
                      aria-hidden="true"
                      className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    />
                    <input
                      id="owner-email"
                      name="email"
                      type="email"
                      required
                      autoComplete="username"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="brainqurious@gmail.com"
                      className="w-full rounded-xl border border-slate-700/60 bg-[#121a2e] py-3 pl-10 pr-4 text-sm text-white placeholder:text-slate-500 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                {/* Password Field */}
                <div>
                  <label
                    htmlFor="owner-password"
                    className="mb-1.5 block text-xs font-medium text-slate-300 sm:text-sm"
                  >
                    Password
                  </label>
                  <div className="relative">
                    <Lock
                      aria-hidden="true"
                      className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    />
                    <input
                      id="owner-password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="••••••••••••"
                      className="w-full rounded-xl border border-slate-700/60 bg-[#121a2e] py-3 pl-10 pr-10 text-sm text-white placeholder:text-slate-500 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 transition-colors hover:text-slate-200 focus:outline-none"
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Secondary Controls: Remember Me & Forgot Password */}
                <div className="flex items-center justify-between pt-1 text-xs sm:text-sm">
                  <label className="flex cursor-pointer select-none items-center gap-2 text-slate-300">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(event) => setRememberMe(event.target.checked)}
                      className="h-4 w-4 rounded border-slate-700 bg-[#121a2e] text-indigo-600 focus:ring-1 focus:ring-indigo-500/30 focus:ring-offset-0"
                    />
                    <span>Remember me</span>
                  </label>
                  <Link
                    href="/forgot-password"
                    className="font-medium text-indigo-400 transition-colors hover:text-indigo-300"
                  >
                    Forgot password?
                  </Link>
                </div>

                {/* Submit Action */}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 py-3.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 transition-all duration-150 hover:from-indigo-500 hover:to-purple-500 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-60 sm:text-base"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-white" />
                      <span>Signing in…</span>
                    </>
                  ) : (
                    "Sign in"
                  )}
                </button>
              </form>

              {/* Subtle Divider */}
              <div className="relative my-5 flex items-center justify-center">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-800" />
                </div>
                <span className="relative bg-[#0d1428] px-3 text-[11px] font-medium uppercase tracking-wider text-slate-500">
                  or
                </span>
              </div>

              {/* Help Area */}
              <div className="text-center">
                <a
                  href="mailto:support@medcarepro.com"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-400 transition-colors hover:text-indigo-300 sm:text-sm"
                >
                  <ShieldAlert className="h-4 w-4 text-indigo-400" />
                  <span>Need help? Contact system administrator</span>
                </a>
              </div>

              {/* Bottom Security Card */}
              <div className="mt-6 flex items-center gap-3.5 rounded-2xl border border-slate-800/80 bg-[#0f172a]/70 p-3.5 sm:p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-indigo-500/20 bg-indigo-950/60 text-indigo-400">
                  <Lock className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-white sm:text-sm">
                    Secure &amp; Trusted
                  </div>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400 sm:text-xs">
                    Your data is encrypted and protected with enterprise-grade security.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

