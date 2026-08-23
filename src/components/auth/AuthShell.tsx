import type { ReactNode } from "react";
import Image from "next/image";
import { Globe, Calendar, Users, IndianRupee, Plus } from "lucide-react";

/**
 * The branded split-card shell every unauthenticated screen sits in.
 *
 * EXTRACTED, NOT INVENTED. This markup was written inline in
 * src/app/(auth)/login/page.tsx. Adding /forgot-password and /reset-password
 * meant either copying ~110 lines of decorative panel into each new page or
 * lifting it once — and three copies of a marketing panel drift within a
 * release. The login page now renders its form into this shell; the panel is
 * pixel-identical to what it replaced.
 *
 * A SERVER COMPONENT ON PURPOSE. It holds no state and no handlers, so keeping
 * it off the client boundary means the decorative half — the image, the three
 * stat cards, the quote — never ships as client JavaScript. The interactive form
 * passed in as `children` carries its own "use client" and is unaffected.
 */

interface AuthShellProps {
  /** The form column's content, below the wordmark. */
  children: ReactNode;
}

export default function AuthShell({ children }: AuthShellProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 sm:p-8">
      <div className="flex w-full max-w-[1200px] overflow-hidden rounded-[2rem] bg-white shadow-xl min-h-[720px]">
        {/* Left side: the form */}
        <div className="flex w-full flex-col p-8 lg:w-[55%] lg:p-12 xl:p-16">
          <div className="flex items-center gap-3 mb-12">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-600">
              <Plus className="h-6 w-6 stroke-[3]" />
            </div>
            <div>
              <div className="font-bold text-slate-900 text-xl tracking-tight leading-none">
                Medicare Pro
              </div>
              <div className="text-xs text-slate-500 font-medium mt-0.5">
                Smart Clinic Management
              </div>
            </div>
          </div>

          <div className="mx-auto w-full max-w-sm flex-grow flex flex-col justify-center">
            {children}
          </div>
        </div>

        {/* Right side: image and stats */}
        <div className="relative hidden w-[45%] lg:block p-4 pl-0">
          <div className="relative h-full w-full rounded-2xl overflow-hidden shadow-sm">
            <Image
              src="/clinic-bg-generic.jpg"
              alt=""
              fill
              // The panel is 45% of a 1200px card, so it never renders wider
              // than ~540px. Without this, Next serves the full-width source to
              // every viewport.
              sizes="(min-width: 1024px) 540px, 0px"
              className="object-cover"
              priority
            />

            <div className="absolute top-6 right-6">
              <button
                type="button"
                className="flex items-center gap-2 rounded-xl bg-white/95 backdrop-blur-md px-4 py-2 text-sm font-medium text-slate-700 shadow-sm border border-white/20"
              >
                <Globe className="h-4 w-4" />
                EN
                <svg
                  className="h-4 w-4 text-slate-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>
            </div>

            <div className="absolute top-16 left-8 rounded-2xl bg-white/95 backdrop-blur-md px-5 py-4 shadow-xl border border-white/30 flex items-center gap-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-light text-primary">
                <Calendar className="h-5 w-5" />
              </div>
              <div>
                <div className="text-xs font-medium text-slate-500 mb-0.5">
                  Today&apos;s Appointments
                </div>
                <div className="text-[15px] font-bold text-primary">8 Scheduled</div>
              </div>
              <div className="absolute top-3 right-3 h-2 w-2 rounded-full bg-primary" />
            </div>

            <div className="absolute bottom-16 left-8 rounded-3xl bg-white/95 backdrop-blur-md p-6 shadow-xl border border-white/30 w-64">
              <h3 className="text-sm font-bold text-slate-900 mb-5">
                Today&apos;s Overview
              </h3>
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
                  <div className="text-xs font-bold text-emerald-500 bg-emerald-50 px-2 py-1 rounded-md">
                    +12%
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-slate-700">
                      <Calendar className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-[11px] font-medium text-slate-500">
                        Appointments
                      </div>
                      <div className="font-bold text-sm text-slate-900 leading-tight">18</div>
                    </div>
                  </div>
                  <div className="text-xs font-bold text-emerald-500 bg-emerald-50 px-2 py-1 rounded-md">
                    +8%
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-slate-700">
                      <IndianRupee className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-[11px] font-medium text-slate-500">Revenue</div>
                      <div className="font-bold text-sm text-slate-900 leading-tight">
                        ₹45,230
                      </div>
                    </div>
                  </div>
                  <div className="text-xs font-bold text-emerald-500 bg-emerald-50 px-2 py-1 rounded-md">
                    +15%
                  </div>
                </div>
              </div>
            </div>

            <div className="absolute bottom-16 right-8 rounded-3xl bg-primary p-7 shadow-xl w-60 text-white border border-white/10">
              <div className="flex -space-x-3 mb-6 relative -top-12 -mt-2">
                {AVATARS.map((avatar) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={avatar.initials}
                    src={avatar.src}
                    alt=""
                    className="h-12 w-12 rounded-full border-2 border-primary bg-white object-cover shadow-sm"
                  />
                ))}
              </div>
              <div className="text-5xl font-serif leading-none mb-2 text-white opacity-80">
                &ldquo;
              </div>
              <p className="text-base font-medium leading-relaxed mb-6 -mt-2">
                Delivering better care, every day.
              </p>
              <p className="text-xs font-medium text-violet-200">Medicare Pro Team</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Decorative placeholder faces. Not real people, so `alt` is empty. */
const AVATARS = [
  {
    initials: "JD",
    src: "https://ui-avatars.com/api/?name=J+D&background=e0e7ff&color=4f46e5&size=128",
  },
  {
    initials: "AS",
    src: "https://ui-avatars.com/api/?name=A+S&background=dcfce7&color=16a34a&size=128",
  },
  {
    initials: "MR",
    src: "https://ui-avatars.com/api/?name=M+R&background=fce7f3&color=db2777&size=128",
  },
] as const;
