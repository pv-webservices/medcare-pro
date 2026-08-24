import type { ReactNode } from "react";
import Image from "next/image";
import { Calendar, Globe, IndianRupee, Plus, Users } from "lucide-react";
import { Avatar } from "@/components/ui";

/**
 * The branded split-card shell every unauthenticated screen sits in.
 *
 * EXTRACTED, NOT INVENTED. This markup was written inline in
 * src/app/(auth)/login/page.tsx. Adding /forgot-password and /reset-password
 * meant either copying ~110 lines of decorative panel into each new page or
 * lifting it once — and three copies of a marketing panel drift within a
 * release. The login page renders its form into this shell.
 *
 * A SERVER COMPONENT ON PURPOSE. It holds no state and no handlers, so keeping
 * it off the client boundary means the decorative half — the image, the three
 * stat cards, the quote — never ships as client JavaScript. The interactive form
 * passed in as `children` carries its own "use client" and is unaffected.
 *
 * THE FLOATING CARDS BREAK THE DEPTH RULE, DELIBERATELY. Everywhere else a
 * surface is the same colour as what is behind it and the paired shadow does
 * the separating. These three sit on a photograph, where that trick reads as
 * nothing at all — a soft grey shadow is invisible over a mid-tone image. So
 * they are translucent and blurred instead, which is the honest way to float
 * something over a picture.
 */

interface AuthShellProps {
  /** The form column's content, below the wordmark. */
  children: ReactNode;
}

export default function AuthShell({ children }: AuthShellProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-4 sm:p-8">
      <div className="flex min-h-[720px] w-full max-w-[1200px] overflow-hidden rounded-4xl bg-canvas shadow-neu-raised">
        {/* Left side: the form */}
        <div className="flex w-full flex-col p-8 lg:w-[55%] lg:p-12 xl:p-16">
          <div className="mb-12 flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-ink shadow-neu-accent"
            >
              <Plus className="h-6 w-6" strokeWidth={3} />
            </span>
            <div>
              <div className="text-title/none font-extrabold text-ink">
                MedCare Pro
              </div>
              <div className="mt-1 text-micro font-semibold uppercase text-muted">
                Clinic CRM
              </div>
            </div>
          </div>

          <div className="mx-auto flex w-full max-w-sm flex-grow flex-col justify-center">
            {children}
          </div>
        </div>

        {/* Right side: image and stats */}
        <div className="relative hidden w-[45%] p-4 pl-0 lg:block">
          <div className="relative h-full w-full overflow-hidden rounded-3xl shadow-neu-inset">
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

            <div className="absolute right-6 top-6">
              <span className="flex items-center gap-2 rounded-2xl bg-canvas/95 px-4 py-2 text-body font-semibold text-ink shadow-neu-float backdrop-blur-md">
                <Globe aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
                EN
              </span>
            </div>

            <div className="absolute left-8 top-16 flex items-center gap-4 rounded-3xl bg-canvas/95 px-5 py-4 shadow-neu-float backdrop-blur-md">
              <span
                aria-hidden="true"
                className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent-soft text-accent-soft-ink"
              >
                <Calendar className="h-5 w-5" strokeWidth={2} />
              </span>
              <div>
                <div className="text-meta font-medium text-muted">
                  Today&apos;s appointments
                </div>
                <div className="text-body font-bold text-accent">8 scheduled</div>
              </div>
            </div>

            <div className="absolute bottom-16 left-8 w-64 rounded-3xl bg-canvas/95 p-6 shadow-neu-float backdrop-blur-md">
              <h3 className="mb-5 text-label font-bold text-ink">
                Today&apos;s overview
              </h3>
              <div className="space-y-4">
                {STATS.map((stat) => {
                  const Icon = stat.icon;
                  return (
                    <div
                      key={stat.label}
                      className="flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3">
                        <span
                          aria-hidden="true"
                          className="flex h-10 w-10 items-center justify-center rounded-2xl bg-accent-soft text-accent-soft-ink"
                        >
                          <Icon className="h-4 w-4" strokeWidth={2} />
                        </span>
                        <div>
                          <div className="text-meta font-medium text-muted">
                            {stat.label}
                          </div>
                          <div className="tnum text-label font-bold leading-tight text-ink">
                            {stat.value}
                          </div>
                        </div>
                      </div>
                      <span className="tnum rounded-full bg-ok-bg px-2 py-1 text-meta font-semibold text-ok-ink">
                        {stat.delta}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="absolute bottom-16 right-8 w-60 rounded-3xl bg-accent p-7 text-accent-ink shadow-neu-float">
              <div className="relative -top-12 -mt-2 mb-6 flex -space-x-3">
                {/*
                  The wrapper is not decoration. Avatar tints itself with alpha
                  so one palette works on both canvases, which over a photograph
                  means the picture shows straight through it. The opaque backing
                  gives the tint something to composite against.
                */}
                {TESTIMONIAL_NAMES.map((name) => (
                  <span
                    key={name}
                    className="inline-flex rounded-full bg-canvas ring-2 ring-accent"
                  >
                    <Avatar name={name} size="lg" />
                  </span>
                ))}
              </div>
              <div className="mb-2 font-serif text-5xl leading-none opacity-80">
                &ldquo;
              </div>
              <p className="-mt-2 mb-6 text-input font-medium leading-relaxed">
                Delivering better care, every day.
              </p>
              <p className="text-meta font-medium opacity-80">MedCare Pro Team</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const STATS = [
  { label: "Patients", value: "24", delta: "+12%", icon: Users },
  { label: "Appointments", value: "18", delta: "+8%", icon: Calendar },
  { label: "Revenue", value: "₹45,230", delta: "+15%", icon: IndianRupee },
] as const;

/**
 * Decorative placeholder faces, now drawn rather than fetched. These used to be
 * <img> tags pointing at ui-avatars.com — three third-party requests on the
 * sign-in screen, which is both a privacy leak on an unauthenticated page and a
 * hard dependency on someone else's uptime for a decoration.
 */
const TESTIMONIAL_NAMES = ["Jaya Desai", "Arun Shah", "Meera Rao"] as const;
