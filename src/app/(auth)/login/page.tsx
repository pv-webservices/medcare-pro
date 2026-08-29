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
import {
  Mail,
  Lock,
  ArrowRight,
  ShieldCheck,
  TrendingUp,
  Users,
  Shield,
  Cloud,
  Hash,
} from "lucide-react";
import AuthAlert from "@/components/auth/AuthAlert";
import AuthButton, { authLinkClasses } from "@/components/auth/AuthButton";
import AuthField from "@/components/auth/AuthField";
import LoginCodeForm from "@/components/auth/LoginCodeForm";
import PasswordField from "@/components/auth/PasswordField";
import AuthBrandMark from "@/components/auth/AuthBrandMark";
import { getSessionEndedMessage } from "@/lib/sessionEndedMessage";
import { cx } from "@/components/ui/cx";

const INVALID_CREDENTIALS_MESSAGE = "Invalid email or password.";
const UNREACHABLE_MESSAGE =
  "Could not reach the server. Check your connection and try again.";
const EMAIL_NOT_VERIFIED_CODE = "EmailNotVerified";
const ACCOUNT_NOT_FOUND_CODE = "AccountNotFound";
const ACCOUNT_NOT_FOUND_MESSAGE = "No account exists for that email address.";
const CLINIC_STATE_CODES: Record<string, string> = {
  ClinicPending: "pending",
  ClinicRejected: "rejected",
  ClinicSuspended: "suspended",
};

const MODES = [
  { id: "password", label: "Password", icon: Lock },
  { id: "code", label: "Login code", icon: Hash },
] as const;

type LoginMode = (typeof MODES)[number]["id"];

function DashboardPreviewMockup() {
  return (
    <div className="mt-12 select-none w-full max-w-[500px] rounded-[22px] border border-white/40 bg-white/60 p-5 shadow-[0_8px_32px_rgb(0,0,0,0.04)] backdrop-blur-xl relative hidden md:block">
      <div className="flex items-center justify-between border-b border-gray-200/50 pb-4 mb-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#4F91FF] to-[#6557FF] text-white shadow-sm">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>
          </span>
          <span className="font-semibold text-[#17203D]">Overview</span>
        </div>
        <div className="rounded-full bg-white/80 border border-gray-200 px-3 py-1.5 text-[12px] font-medium text-gray-500 shadow-sm">
          This month ▾
        </div>
      </div>
      
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: "Total Patients", value: "2,543", trend: "↑ 12.5%", color: "text-[#12A06A]" },
          { label: "Appointments", value: "1,842", trend: "↑ 8.2%", color: "text-[#12A06A]" },
          { label: "Revenue", value: "$24,350", trend: "↑ 15.3%", color: "text-[#12A06A]" },
          { label: "Satisfaction", value: "98%", trend: "↑ 4.1%", color: "text-[#12A06A]" },
        ].map((stat, i) => (
          <div key={i} className="rounded-2xl bg-white/70 p-3 border border-white/50 shadow-sm flex flex-col justify-center">
            <span className="text-[10px] sm:text-[11px] font-semibold text-gray-500 mb-1 leading-tight">{stat.label}</span>
            <span className="text-[14px] sm:text-[16px] font-bold text-[#17203D]">{stat.value}</span>
            <span className={`text-[10px] font-medium mt-1 ${stat.color}`}>{stat.trend}</span>
          </div>
        ))}
      </div>
      
      <div className="h-[120px] w-full rounded-xl bg-white/50 border border-white/40 p-4 relative overflow-hidden flex items-end">
         <div className="absolute left-0 bottom-0 right-0 h-full w-full pointer-events-none">
            <svg viewBox="0 0 400 100" preserveAspectRatio="none" className="h-full w-full">
              <path d="M0,80 Q50,90 100,50 T200,60 T300,30 T400,20 L400,100 L0,100 Z" fill="url(#chart-gradient)" opacity="0.3"/>
              <path d="M0,80 Q50,90 100,50 T200,60 T300,30 T400,20" fill="none" stroke="#6557FF" strokeWidth="2.5"/>
              <circle cx="300" cy="30" r="4" fill="#6557FF" stroke="white" strokeWidth="2"/>
              <defs>
                <linearGradient id="chart-gradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6557FF" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#6557FF" stopOpacity="0" />
                </linearGradient>
              </defs>
            </svg>
         </div>
      </div>
      
      <div className="absolute -bottom-5 -right-5 sm:-right-8 flex h-14 w-14 items-center justify-center rounded-full bg-white shadow-[0_4px_20px_rgb(0,0,0,0.08)] border border-gray-100">
         <ShieldCheck className="w-6 h-6 text-[#3ED6D0]" />
      </div>
    </div>
  );
}

function BenefitRow({ icon, title, description, iconBg }: { icon: React.ReactNode, title: string, description: string, iconBg: string }) {
  return (
    <div className="flex items-start gap-4">
      <div className={cx("flex h-12 w-12 shrink-0 items-center justify-center rounded-xl", iconBg)}>
        {icon}
      </div>
      <div>
        <h3 className="text-[16px] font-semibold text-[#17203D]">{title}</h3>
        <p className="text-[14.5px] text-[#687392] mt-0.5 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const justVerified = searchParams.get("verified") === "1";
  const justReset = searchParams.get("reset") === "1";
  const sessionEndedMessage = getSessionEndedMessage(searchParams);

  const [mode, setMode] = useState<LoginMode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isUnverified, setIsUnverified] = useState(false);
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
    setPassword("");
    setError(null);
    setIsUnverified(false);
    setIsUnknownAccount(false);
  }

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
          setIsUnknownAccount(true);
          setError(ACCOUNT_NOT_FOUND_MESSAGE);
        } else if (clinicState) {
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
    <div className="auth-scope flex min-h-screen w-full bg-[#FAFCFF] overflow-hidden">
      <div className="pointer-events-none absolute inset-0 z-0">
        <div className="absolute top-[-10%] left-[-10%] h-[700px] w-[700px] rounded-full bg-[#E5EDFF] opacity-70 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-5%] h-[600px] w-[600px] rounded-full bg-[#F3E8FF] opacity-60 blur-[140px]" />
      </div>

      <div className="relative z-10 hidden lg:flex lg:w-[52%] xl:w-[55%] flex-col justify-center px-12 xl:px-20 2xl:px-28 py-10">
        <div className="w-full max-w-[560px]">
          <AuthBrandMark showTagline className="mb-14" />

          <h1 className="mb-6 text-[42px] xl:text-[48px] font-bold leading-[1.12] tracking-tight text-[#17203D]">
            Smart clinic management, <br />
            <span className="bg-gradient-to-r from-[#4D9FFF] to-[#6557FF] bg-clip-text text-transparent">
              elevated care.
            </span>
          </h1>

          <p className="mb-12 max-w-[460px] text-[17px] leading-relaxed text-[#687392]">
            Everything you need to manage patients, streamline operations, and grow your practice—securely and effortlessly.
          </p>

          <div className="mb-4 space-y-7">
            <BenefitRow
              icon={<Users className="h-[22px] w-[22px] text-[#4D9FFF]" />}
              title="Unified patient & clinic management"
              description="All your data, organized and accessible."
              iconBg="bg-[#EBF3FF]"
            />
            <BenefitRow
              icon={<TrendingUp className="h-[22px] w-[22px] text-[#6557FF]" />}
              title="Real-time insights & analytics"
              description="Make smarter decisions with live dashboards."
              iconBg="bg-[#F0EEFF]"
            />
            <BenefitRow
              icon={<ShieldCheck className="h-[22px] w-[22px] text-[#3ED6D0]" />}
              title="Secure, compliant & reliable"
              description="Your data is protected with enterprise-grade security."
              iconBg="bg-[#E6F9F8]"
            />
          </div>

          <DashboardPreviewMockup />
        </div>
      </div>

      <div className="relative z-10 flex w-full flex-col items-center justify-center p-5 sm:p-8 lg:w-[48%] xl:w-[45%]">
        <div className="mb-8 w-full max-w-[460px] lg:hidden flex justify-center">
           <AuthBrandMark size="sm" />
        </div>

        <div className="w-full max-w-[460px] 2xl:max-w-[480px]">
          <div className="mb-[-22px] flex justify-center relative z-20">
            <div className="flex h-[44px] w-[44px] items-center justify-center rounded-xl bg-white shadow-[0_8px_24px_rgb(0,0,0,0.06)] border border-[#EBF3FF] bg-gradient-to-b from-white to-[#F8FBFF]">
              <Shield className="h-5 w-5 fill-[#EAF6F6] text-[#3ED6D0]" />
              <Lock className="absolute h-2.5 w-2.5 text-[#3ED6D0] stroke-[3]" />
            </div>
          </div>

          <div className="relative z-10 rounded-[24px] border border-white/60 bg-white/85 p-7 sm:p-10 shadow-[0_16px_64px_-16px_rgb(23,32,61,0.1)] backdrop-blur-md">
            
            <div className="mb-6 flex justify-center lg:mb-8">
               <AuthBrandMark size="md" />
            </div>

            <div className="mb-8 text-center">
              <h2 className="text-[28px] sm:text-[32px] font-bold leading-tight tracking-[-0.01em] text-[#17203D]">
                Welcome back
              </h2>
              <p className="mt-2 text-[14.5px] text-[#687392]">
                Sign in to continue to your MedCare Pro workspace.
              </p>
            </div>

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
              className="mb-8 grid grid-cols-2 gap-1 rounded-2xl bg-[#F3F5F9] p-1.5"
            >
              {MODES.map((entry) => {
                const isActive = entry.id === mode;
                const Icon = entry.icon;
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
                    tabIndex={isActive ? 0 : -1}
                    onClick={() => selectMode(entry.id)}
                    onKeyDown={handleTabKeyDown}
                    className={cx(
                      "flex min-h-[44px] items-center justify-center gap-2 rounded-[12px] text-[14px] font-semibold transition-all duration-200",
                      isActive
                        ? "bg-gradient-to-r from-[#5B8EFF] to-[#695AFB] text-white shadow-md"
                        : "text-[#687392] hover:text-[#17203D]",
                    )}
                  >
                    {!isActive && <Icon className="h-4 w-4 opacity-70" />}
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
                  className="bg-white/80 border-gray-200"
                />

                <PasswordField
                  id="password"
                  name="password"
                  label="Password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  icon={<Lock className="h-[18px] w-[18px]" strokeWidth={2} />}
                  aria-invalid={error ? true : undefined}
                  describedBy={error ? "login-password-error" : undefined}
                  placeholder="Enter your password"
                  className="bg-white/80 border-gray-200"
                  labelAction={
                    <Link
                      href={
                        email
                          ? `/forgot-password?email=${encodeURIComponent(email)}`
                          : "/forgot-password"
                      }
                      className="rounded text-[13px] font-medium text-[#6557FF] transition-colors hover:text-[#4A39EC]"
                    >
                      Forgot password?
                    </Link>
                  }
                />

                <label className="flex w-fit items-center gap-2.5 pt-1 text-[13.5px] font-medium text-[#39415C]">
                  <input
                    id="remember-me"
                    name="rememberMe"
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(event) => setRememberMe(event.target.checked)}
                    className="h-4 w-4 rounded-[5px] border-[#D7DBEA] accent-[#6557FF]"
                  />
                  Keep me signed in
                </label>

                <div className="pt-2">
                  <AuthButton
                    type="submit"
                    isBusy={isSubmitting}
                    busyLabel="Signing in..."
                    className="h-[54px] rounded-2xl bg-gradient-to-r from-[#4F91FF] to-[#6557FF] shadow-md hover:shadow-lg hover:from-[#4480EF] hover:to-[#5A4CE6] text-[16px] border-none"
                  >
                    Sign in <ArrowRight className="ml-1 h-[18px] w-[18px]" />
                  </AuthButton>
                </div>
                
                <div className="mt-6 text-center text-[14px] text-[#687392]">
                  Don&apos;t have an account?{" "}
                  <Link href="/signup" className="font-semibold text-[#6557FF] hover:underline underline-offset-4">
                    Create one
                  </Link>
                </div>
              </form>
            </div>

            <div
              role="tabpanel"
              id="login-panel-code"
              aria-labelledby="login-tab-code"
              hidden={mode !== "code"}
            >
              <LoginCodeForm email={email} onEmailChange={setEmail} />
              
              <div className="mt-6 text-center text-[14px] text-[#687392]">
                  Don&apos;t have an account?{" "}
                  <Link href="/signup" className="font-semibold text-[#6557FF] hover:underline underline-offset-4">
                    Create one
                  </Link>
              </div>
            </div>

          </div>

          <div className="mt-10 flex flex-wrap justify-center gap-x-8 gap-y-3 text-[12.5px] font-medium text-[#687392]">
            <span className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 opacity-70" /> Secure platform
            </span>
            <span className="flex items-center gap-2">
              <Lock className="h-4 w-4 opacity-70" /> Encrypted sign-in
            </span>
            <span className="flex items-center gap-2">
              <Cloud className="h-4 w-4 opacity-70" /> Reliable infrastructure
            </span>
          </div>

        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
