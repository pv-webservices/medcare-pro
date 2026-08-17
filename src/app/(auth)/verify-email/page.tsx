"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Globe, Calendar, Users, IndianRupee, Mail, Plus } from "lucide-react";

// Email verification screen — PRD §6.1 (FR-1.2, FR-1.5).

const UNREACHABLE_MESSAGE =
  "Could not reach the server. Check your connection and try again.";

const STATUS_MESSAGES: Record<string, string> = {
  invalid: "That verification link is not valid. Request a new one below.",
  expired: "That verification link has expired. Request a new one below.",
  error: "Something went wrong verifying your email. Request a new link below.",
};

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const status = searchParams.get("status");
  const emailFromSignup = searchParams.get("email") ?? "";

  const [email, setEmail] = useState(emailFromSignup);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const statusMessage = status ? STATUS_MESSAGES[status] : undefined;
  const isPostSignup = !status;

  async function handleResend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
        setError(body.error ?? "Could not send the link. Try again shortly.");
        return;
      }

      setNotice(body.message ?? "If that address needs verification, a new link is on its way.");
    } catch {
      setError(UNREACHABLE_MESSAGE);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 sm:p-8">
      <div className="flex w-full max-w-[1200px] overflow-hidden rounded-[2rem] bg-white shadow-xl min-h-[720px]">
        
        {/* Left side: Verify Email Form */}
        <div className="flex w-full flex-col p-8 lg:w-[55%] lg:p-12 xl:p-16">
          <div className="flex items-center gap-3 mb-12">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-light text-primary">
              <Plus className="h-6 w-6 stroke-[3]" />
            </div>
            <div>
              <div className="font-bold text-slate-900 text-xl tracking-tight leading-none">Medicare Pro</div>
              <div className="text-xs text-slate-500 font-medium mt-0.5">Smart Clinic Management</div>
            </div>
          </div>

          <div className="mx-auto w-full max-w-sm flex-grow flex flex-col justify-center">
            <div className="mb-10 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary-light text-primary mb-6">
                <Mail className="h-8 w-8" />
              </div>
              <h1 className="text-3xl font-bold tracking-tight text-slate-900">
                {isPostSignup ? "Check your email" : "Verify your email"}
              </h1>
              {isPostSignup ? (
                <p className="mt-3 text-sm text-slate-500 leading-relaxed">
                  We&apos;ve sent a verification link{emailFromSignup ? ` to ` : ""}{emailFromSignup ? <span className="font-semibold text-slate-900">{emailFromSignup}</span> : ""}. 
                  Open it to activate your account — you won&apos;t be able to log in until you do.
                </p>
              ) : (
                <p className="mt-3 text-sm text-slate-500">
                  Enter your email to request a new verification link.
                </p>
              )}
            </div>

            <form onSubmit={handleResend} noValidate={false} className="space-y-6">
              {statusMessage && (
                <p
                  role="alert"
                  className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
                >
                  {statusMessage}
                </p>
              )}

              {notice && (
                <p
                  role="status"
                  className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800"
                >
                  {notice}
                </p>
              )}

              {error && (
                <p
                  role="alert"
                  id="resend-error"
                  className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
                >
                  {error}
                </p>
              )}

              <div>
                <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-2">
                  Email address
                </label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                    <Mail className="h-5 w-5 text-slate-400" aria-hidden="true" />
                  </div>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    aria-describedby={error ? "resend-error" : undefined}
                    placeholder="dr.amelia@dentalcare.com"
                    className="block w-full rounded-xl border border-slate-200 py-3.5 pl-11 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="mt-2 flex w-full justify-center rounded-xl bg-primary hover:bg-primary-hover py-3.5 px-4 text-sm font-semibold text-primary-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-70 transition-colors"
              >
                {isSubmitting ? "Sending..." : "Resend verification link"}
              </button>
            </form>

            <p className="mt-10 text-center text-sm text-slate-500">
              Already verified?{" "}
              <Link href="/login" className="font-semibold text-primary hover:text-primary-hover">
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
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-light text-primary">
                <Calendar className="h-5 w-5" />
              </div>
              <div>
                <div className="text-xs font-medium text-slate-500 mb-0.5">Today's Appointments</div>
                <div className="text-[15px] font-bold text-primary">8 Scheduled</div>
              </div>
              {/* Little purple dot */}
              <div className="absolute top-3 right-3 h-2 w-2 rounded-full bg-primary" />
            </div>

            {/* Bottom Left floating card */}
            <div className="absolute bottom-16 left-8 rounded-3xl bg-white/95 backdrop-blur-md p-6 shadow-xl border border-white/30 w-64">
              <h3 className="text-sm font-bold text-slate-900 mb-5">Today's Overview</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-light text-slate-700">
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
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-light text-slate-700">
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
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-light text-slate-700">
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
            <div className="absolute bottom-16 right-8 rounded-3xl bg-primary p-7 shadow-xl w-60 text-white border border-white/10">
              {/* Avatars */}
              <div className="flex -space-x-3 mb-6 relative -top-12 -mt-2">
                <img src="https://ui-avatars.com/api/?name=J+D&background=e0e7ff&color=4f46e5&size=128" alt="Doctor" className="h-12 w-12 rounded-full border-2 border-primary bg-white object-cover shadow-sm" />
                <img src="https://ui-avatars.com/api/?name=A+S&background=dcfce7&color=16a34a&size=128" alt="Doctor" className="h-12 w-12 rounded-full border-2 border-primary bg-white object-cover shadow-sm" />
                <img src="https://ui-avatars.com/api/?name=M+R&background=fce7f3&color=db2777&size=128" alt="Doctor" className="h-12 w-12 rounded-full border-2 border-primary bg-white object-cover shadow-sm" />
              </div>
              <div className="text-5xl font-serif leading-none mb-2 text-white opacity-80">&ldquo;</div>
              <p className="text-base font-medium leading-relaxed mb-6 -mt-2">
                Delivering better care, every day.
              </p>
              <p className="text-xs font-medium text-primary-light">
                Medicare Pro Team
              </p>
            </div>
            
          </div>
        </div>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailContent />
    </Suspense>
  );
}
