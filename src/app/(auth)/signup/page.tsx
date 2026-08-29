"use client";

import { Suspense, useState, type FormEvent, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Building2, Mail, MapPin, Phone, User as UserIcon, Lock, ArrowRight, ShieldCheck, TrendingUp, Users, Shield, Cloud } from "lucide-react";
import AuthAlert from "@/components/auth/AuthAlert";
import AuthButton, { authLinkClasses } from "@/components/auth/AuthButton";
import AuthField, { AuthTextarea } from "@/components/auth/AuthField";
import PasswordField from "@/components/auth/PasswordField";
import AuthBrandMark from "@/components/auth/AuthBrandMark";
import { MIN_PASSWORD_LENGTH } from "@/lib/signupInput";
import { cx } from "@/components/ui/cx";

const UNREACHABLE_MESSAGE =
  "Could not reach the server. Check your connection and try again.";

const FALLBACK_ERROR_MESSAGE = "Could not create the account. Try again.";

const PASSWORD_MISMATCH_MESSAGE = "The two passwords do not match.";

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#687392] mb-3">
      {children}
    </p>
  );
}

function DashboardPreviewMockup() {
  return (
    <div className="mt-8 select-none w-full max-w-[520px] rounded-[22px] border border-white/60 bg-white/80 p-5 shadow-[0_20px_60px_rgba(70,82,135,0.10)] backdrop-blur-[10px] relative hidden md:block">
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

function SignupContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [name, setName] = useState("");
  const [clinicName, setClinicName] = useState("");
  const [email, setEmail] = useState(() => searchParams.get("email") ?? "");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [businessEmail, setBusinessEmail] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [error, setError] = useState<string | null>(null);
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
        setError(body.error ?? FALLBACK_ERROR_MESSAGE);
        setPassword("");
        setConfirmPassword("");
        return;
      }

      router.push(`/verify-email?email=${encodeURIComponent(email)}`);
    } catch {
      setError(UNREACHABLE_MESSAGE);
    } finally {
      setIsSubmitting(false);
    }
  }

  const inputClass = "h-[50px] md:h-[52px] rounded-[14px] bg-white/80 border-[#DDE4F0] focus:border-[#6758FF] focus:ring-1 focus:ring-[#6758FF]";

  return (
    <div className="auth-scope relative flex min-h-screen w-full justify-center overflow-hidden bg-[#F6F9FF]">
      {/* Background Image Layer */}
      <div
        className="pointer-events-none absolute inset-0 z-0 hidden lg:block fixed"
        style={{
          backgroundImage: "url('/login-bg.jpg')",
          backgroundSize: "cover",
          backgroundPosition: "center",
          filter: "blur(12px)",
          transform: "scale(1.04)",
          opacity: 0.45,
        }}
      />
      {/* Background Overlays */}
      <div
        className="pointer-events-none absolute inset-0 z-0 hidden lg:block fixed"
        style={{
          background:
            "linear-gradient(90deg, rgba(248, 251, 255, 0.92) 0%, rgba(248, 251, 255, 0.85) 45%, rgba(239, 246, 255, 0.65) 100%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 z-0 hidden lg:block fixed"
        style={{
          background:
            "radial-gradient(circle at 70% 65%, rgba(112, 88, 255, 0.12), transparent 45%), radial-gradient(circle at 20% 25%, rgba(75, 160, 255, 0.10), transparent 40%)",
        }}
      />

      {/* Main Content Container */}
      <div className="relative z-10 w-full max-w-[1440px] mx-auto px-6 lg:px-8 xl:px-12 py-10 lg:py-16">
        <div className="lg:grid lg:grid-cols-[minmax(0,0.85fr)_minmax(680px,1.15fr)] lg:gap-[clamp(32px,4vw,64px)] lg:items-center w-full min-h-[calc(100vh-128px)]">
          
          {/* LEFT COLUMN */}
          <div className="hidden lg:flex flex-col justify-center max-w-[500px] xl:max-w-[540px] w-full pt-4 lg:pt-0">
            <AuthBrandMark showTagline className="mb-12" />

            <h1 className="mb-5 text-[40px] xl:text-[44px] font-bold leading-[1.12] tracking-tight text-[#17203D]">
              Smart clinic management,<br />
              <span className="bg-gradient-to-r from-[#4898FF] to-[#6758FF] bg-clip-text text-transparent">
                elevated care.
              </span>
            </h1>

            <p className="mb-8 max-w-[440px] text-[17px] leading-relaxed text-[#687392]">
              Everything you need to manage patients, streamline operations, and grow your practice—securely and effortlessly.
            </p>

            <div className="mb-8 space-y-4">
              <BenefitRow
                icon={<Users className="h-[20px] w-[20px] text-[#4D9FFF]" />}
                title="Unified patient & clinic management"
                description="All your data, organized and accessible."
                iconBg="bg-[#EBF3FF]"
              />
              <BenefitRow
                icon={<TrendingUp className="h-[20px] w-[20px] text-[#6557FF]" />}
                title="Real-time insights & analytics"
                description="Make smarter decisions with live dashboards."
                iconBg="bg-[#F0EEFF]"
              />
              <BenefitRow
                icon={<ShieldCheck className="h-[20px] w-[20px] text-[#3ED6D0]" />}
                title="Secure, compliant & reliable"
                description="Your data is protected with enterprise-grade security."
                iconBg="bg-[#E6F9F8]"
              />
            </div>

            <DashboardPreviewMockup />
          </div>

          {/* RIGHT COLUMN */}
          <div className="flex w-full flex-col items-center lg:items-start justify-center max-w-[740px] mx-auto lg:mx-0">
            
            <div className="mb-8 w-full lg:hidden flex justify-center">
               <AuthBrandMark size="sm" />
            </div>

            <div className="w-full">
              {/* Security floating badge */}
              <div className="mb-[-25px] flex justify-center relative z-20">
                <div className="flex h-[50px] w-[50px] items-center justify-center rounded-[14px] bg-white shadow-[0_8px_24px_rgb(0,0,0,0.06)] border border-[#EBF3FF] bg-gradient-to-b from-white to-[#F8FBFF]">
                  <Shield className="h-6 w-6 fill-[#EAF6F6] text-[#3ED6D0]" />
                  <Lock className="absolute h-3 w-3 text-[#3ED6D0] stroke-[3]" />
                </div>
              </div>

              {/* Signup Card */}
              <div className="relative z-10 rounded-[24px] border border-white/75 bg-white/80 p-6 sm:p-10 shadow-[0_28px_80px_rgba(80,95,150,0.12),0_4px_18px_rgba(80,95,150,0.05)] backdrop-blur-[20px]">
                
                <div className="mb-8 flex justify-center">
                   <AuthBrandMark size="md" />
                </div>

                <div className="mb-8 text-center">
                  <h2 className="text-[28px] sm:text-[32px] font-bold leading-tight tracking-[-0.01em] text-[#17203D]">
                    Create your MedCare Pro account
                  </h2>
                  <p className="mt-2.5 text-[14.5px] text-[#687392]">
                    Set up your account and start managing your clinic operations.
                  </p>
                </div>

                <form method="post" onSubmit={handleSubmit} className="flex flex-col gap-y-7">
                  {error && (
                    <AuthAlert id="signup-error" tone="error">
                      {error}
                    </AuthAlert>
                  )}

                  <div className="flex flex-col gap-y-4">
                    <SectionLabel>Your details</SectionLabel>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-x-5 md:gap-y-5">
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
                        className={inputClass}
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
                        describedBy={error ? "signup-error" : undefined}
                        className={inputClass}
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-x-5 md:gap-y-5 items-start">
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
                        icon={<Lock className="h-[18px] w-[18px]" strokeWidth={2} />}
                        className={inputClass}
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
                        icon={<Lock className="h-[18px] w-[18px]" strokeWidth={2} />}
                        className={inputClass}
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-y-4">
                    <SectionLabel>Your clinic</SectionLabel>

                    <div className="grid grid-cols-1 md:grid-cols-[1.2fr_0.8fr] gap-4 md:gap-x-5 md:gap-y-5 items-start">
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
                        className={inputClass}
                      />

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
                        className={inputClass}
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-[0.8fr_1.2fr] gap-4 md:gap-x-5 md:gap-y-5 items-start">
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
                        className={inputClass}
                      />

                      <AuthField
                        id="businessEmail"
                        name="businessEmail"
                        type="email"
                        label="Business contact email (optional)"
                        value={businessEmail}
                        onChange={(event) => setBusinessEmail(event.target.value)}
                        hint="Used for billing and notices. You still sign in with the email above."
                        className={inputClass}
                      />
                    </div>

                    <AuthTextarea
                      id="address"
                      name="address"
                      label="Address (optional)"
                      autoComplete="street-address"
                      value={address}
                      onChange={(event) => setAddress(event.target.value)}
                      className="rounded-[14px] bg-white/80 border-[#DDE4F0] focus:border-[#6758FF] focus:ring-1 focus:ring-[#6758FF] h-[76px]"
                      rows={2}
                    />
                  </div>

                  <label className="mt-2 flex items-start gap-3 rounded-[12px] border border-white/60 bg-white/50 p-4 text-[13.5px] leading-relaxed text-[#39415C]">
                    <input
                      id="acceptTerms"
                      name="acceptTerms"
                      type="checkbox"
                      required
                      checked={acceptTerms}
                      onChange={(event) => setAcceptTerms(event.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded-[5px] border-[#D7DBEA] accent-[#6557FF]"
                    />
                    <span>
                      By continuing, you agree to the MedCare Pro Terms of Service and Privacy Policy.
                    </span>
                  </label>

                  <div className="pt-2">
                    <AuthButton
                      type="submit"
                      isBusy={isSubmitting}
                      busyLabel="Creating account..."
                      className="h-[54px] w-full rounded-[14px] bg-gradient-to-r from-[#4C91FF] via-[#615EFF] to-[#7353FF] shadow-[0_4px_14px_rgba(97,94,255,0.25)] hover:shadow-[0_6px_20px_rgba(97,94,255,0.35)] text-[16px] border-none"
                    >
                      Create account
                    </AuthButton>
                  </div>
                  
                  <div className="text-center text-[14px] text-[#687392]">
                    Already have an account?{" "}
                    <Link href="/login" className="font-semibold text-[#6557FF] hover:underline underline-offset-4">
                      Sign in
                    </Link>
                  </div>
                </form>
              </div>

              <div className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-3 text-[12.5px] font-medium text-[#687392]">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 opacity-70" /> Secure platform
                </span>
                <span className="flex items-center gap-1.5">
                  <Lock className="h-4 w-4 opacity-70" /> Encrypted sign-in
                </span>
                <span className="flex items-center gap-1.5">
                  <Cloud className="h-4 w-4 opacity-70" /> Reliable infrastructure
                </span>
              </div>

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
