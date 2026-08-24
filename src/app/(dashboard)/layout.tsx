import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Bell, Plus, Search, Settings } from "lucide-react";
import DashboardNav from "@/components/dashboard/DashboardNav";
import MobileNav from "@/components/dashboard/MobileNav";
import ClinicSwitcher from "@/components/dashboard/ClinicSwitcher";
import SignOutButton from "@/components/dashboard/SignOutButton";
import ThemeSwitcher from "@/components/ThemeSwitcher";
import { Avatar, ToastProvider, buttonClasses } from "@/components/ui";
import { listClinicsForActor } from "@/lib/clinics";
import { resolveModulesForActor } from "@/lib/features";
import { visibleNavLinks } from "@/lib/navigation";
import { countUnreadForActor } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { holdsAnywhere, permissionsHeldAnywhere, resolveRoleNameAtTime } from "@/lib/rbac";
import { resolveSelectedClinicId } from "@/lib/selectedClinic";
import { requireActor, UnauthenticatedError } from "@/lib/session";

/**
 * Shared shell for all signed-in pages — sidebar nav plus the FR-2.3 clinic
 * switcher.
 *
 * Route protection itself lives in src/middleware.ts (FR-1.2); the
 * `requireActor` call here is the backstop for a session that expires between
 * the middleware check and the render.
 *
 * THE SIDEBAR FLOATS. It is a raised panel inset from the window on all four
 * sides rather than a full-bleed column with a dividing border, because a
 * border is exactly the thing this design language does not have. The canvas
 * runs behind it, which is what makes the panel read as an object resting on
 * the page.
 */

interface DashboardLayoutProps {
  children: ReactNode;
}

/** Maps a refused session onto a screen that will actually render for it. */
function signedOutDestination(error: UnauthenticatedError): string {
  if (error.reason === "platform-tenant") {
    return "/owner/dashboard";
  }
  if (error.reason === "tenant") {
    if (error.tenantStatus === "SUSPENDED") {
      return "/pending-approval?status=suspended";
    }
    if (error.tenantStatus === "REJECTED") {
      return "/pending-approval?status=rejected";
    }
    return "/pending-approval?status=pending";
  }
  return "/login?ended=1";
}

/**
 * Routes the refusal through the one place that can DELETE the dead cookie.
 *
 * THE BUG THIS FIXES. This component is a Server Component, so `redirect()` is
 * all it can do — it cannot write a Set-Cookie header. The refused JWT therefore
 * survived every refusal and kept telling src/middleware.ts, which can only
 * decode the token, that the visitor was signed in. A user in that state who
 * clicked "Sign up" on the login screen went /signup → /dashboard → refused →
 * /login?ended=1, three redirects that read as the page simply not navigating.
 *
 * /api/auth/session-ended is a Route Handler, which CAN write cookies. It clears
 * the debris and forwards to the same destination this function already chose,
 * so the redirect target is unchanged — only the cookie state at the other end
 * is. The destination is re-derived from an allowlist there rather than trusted,
 * because that route is reachable by anyone.
 */
function signedOutRedirect(error: UnauthenticatedError): string {
  const destination = signedOutDestination(error);
  return `/api/auth/session-ended?to=${encodeURIComponent(destination)}`;
}

/**
 * The greeting is cosmetic, so it is derived from the SERVER's clock and may be
 * an hour or two off for a clinic in another timezone. That is an acceptable
 * trade for not shipping a client component purely to say "good afternoon";
 * nothing downstream depends on it.
 */
function greetingFor(hour: number): string {
  if (hour < 12) {
    return "Good morning";
  }
  if (hour < 17) {
    return "Good afternoon";
  }
  return "Good evening";
}

export default async function DashboardLayout({ children }: DashboardLayoutProps) {
  let actor;
  try {
    actor = await requireActor();
  } catch (error: unknown) {
    if (error instanceof UnauthenticatedError) {
      // WHERE A REFUSED SESSION GOES, and why it is not always /login.
      //
      // The cookie may still be a perfectly valid, unexpired JWT — what failed
      // is the database check behind it. The middleware only sees the token, so
      // it bounces a "signed in" user off /login and straight back here: plain
      // `redirect("/login")` is an infinite loop for exactly these cases.
      //
      //   platform-tenant  an Owner, who has their own surface (Stage 2)
      //   tenant           their organisation is pending, suspended or rejected
      //                    — /pending-approval explains which, and the
      //                    middleware does not bounce anyone off it
      //   anything else    the session itself is gone, revoked or expired, or
      //                    the refusal is personal. `ended=1` tells the
      //                    middleware to let the login screen render even
      //                    though a token is present.
      redirect(signedOutRedirect(error));
    }
    throw error;
  }

  // The switcher only ever offers clinics this user can actually reach.
  // `countUnreadForActor` returns 0 rather than throwing for a Staff user, so
  // the shell renders the same for everyone — only the badge differs.
  const selectedClinicId = await resolveSelectedClinicId(actor);
  const [clinics, unreadNotifications, held, modules, currentUser, roleName] = await Promise.all([
    listClinicsForActor(actor),
    countUnreadForActor(actor),
    permissionsHeldAnywhere(actor),
    resolveModulesForActor(actor),
    prisma.user.findFirst({
      where: { id: actor.userId, tenantId: actor.tenantId },
      select: { name: true },
    }),
    resolveRoleNameAtTime(actor, selectedClinicId ?? undefined),
  ]);

  const userName = currentUser?.name ?? "Admin User";

  // Tabs the user's roles cannot reach are dropped here rather than rendered
  // and refused, and Stage 8 adds the same courtesy for a module the
  // organisation or the role does not have. The pages behind them still enforce
  // both checks — see the note in src/lib/navigation.ts.
  const links = visibleNavLinks(
    (permission) => holdsAnywhere(held, permission),
    // A key missing from the map means the catalogue row is missing, which
    // lib/features.ts already treats as a denial and logs. Hiding the tab keeps
    // the shell consistent with the page behind it.
    (feature) => modules.get(feature)?.allowed === true,
  );

  // No extra query: the switcher's own list already carries every clinic's
  // branding. "All clinics" leaves themeColor undefined, which resolveAccent
  // answers with the house teal.
  const activeClinic = clinics.find((clinic) => clinic.id === selectedClinicId) ?? (clinics.length === 1 ? clinics[0] : null);
  const displayName = activeClinic?.name ?? userName;

  const greeting = greetingFor(new Date().getHours());

  return (
    <div className="flex min-h-screen gap-0 bg-canvas p-4">
      {/*
        Sticky rather than fixed, so the panel scrolls with a short page but
        stays put on a long one without the content needing a left margin.
      */}
      <aside className="sticky top-4 hidden h-[calc(100vh-2rem)] w-[270px] shrink-0 flex-col rounded-4xl bg-canvas p-5 shadow-neu-raised lg:flex">
        <div className="mb-6 flex items-center gap-3 px-1">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-ink shadow-neu-accent"
          >
            <Plus strokeWidth={3} className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-section font-extrabold leading-none text-ink">
              MedCare Pro
            </div>
            <div className="mt-1 text-micro font-semibold uppercase text-muted">
              Clinic CRM
            </div>
          </div>
        </div>

        <div className="-mx-1 flex-1 space-y-6 overflow-y-auto px-1 pb-2">
          {clinics.length > 1 && (
            <ClinicSwitcher
              clinics={clinics.map(({ id, name }) => ({ id, name }))}
              selectedClinicId={selectedClinicId}
            />
          )}

          <DashboardNav links={links} unreadNotifications={unreadNotifications} />
        </div>

        {/*
          The support card is the one piece of chrome that is allowed to be
          warm. Everything above it is a tool; this is the reminder that a
          person is behind it.
        */}
        <div className="mt-4 space-y-4">
          <div className="rounded-3xl bg-canvas p-4 shadow-neu-raised-sm">
            <p className="text-label font-bold text-ink">Need a hand?</p>
            <p className="mt-1 text-meta font-medium leading-relaxed text-muted">
              Our team can walk you through any screen.
            </p>
            <Link
              href="/settings"
              className={buttonClasses("commit", "sm", "mt-3 w-full")}
            >
              Get support
            </Link>
          </div>

          <ThemeSwitcher />
          <SignOutButton />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/*
          The sidebar beside this column is `hidden lg:flex`, so below that
          breakpoint it is the ONLY navigation and it is not on screen. This is
          the replacement for those widths — see the note in MobileNav.tsx for
          what its absence did. It takes the same already-filtered `links`, so
          the two surfaces cannot offer different tabs.
        */}
        <MobileNav links={links} unreadNotifications={unreadNotifications} />

        <header className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 md:px-7 md:py-6">
          <div className="min-w-0">
            <h2 className="truncate text-title font-extrabold text-ink">
              {greeting}, {userName}
            </h2>
            <p className="mt-1 text-label font-medium text-muted">
              Here&apos;s what&apos;s happening across your clinic today.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/*
              PRESENTATIONAL FOR NOW. There is no search endpoint behind this —
              it is the reference design's chrome, and it stays inert until a
              search route exists to point it at. It is a real input rather than
              a picture of one so that wiring it up later is a one-line change.
            */}
            <div className="relative hidden xl:block">
              <Search
                aria-hidden="true"
                strokeWidth={2}
                className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-faint"
              />
              <input
                type="search"
                aria-label="Search"
                placeholder="Search anything…"
                className="h-11 w-72 rounded-2xl border-0 bg-canvas pl-11 pr-4 text-body text-ink shadow-neu-inset placeholder:text-faint"
              />
            </div>

            <Link
              href="/notifications"
              aria-label={
                unreadNotifications > 0
                  ? `Notifications, ${unreadNotifications} unread`
                  : "Notifications"
              }
              className="relative flex h-11 w-11 items-center justify-center rounded-full bg-canvas text-muted shadow-neu-raised-sm transition-shadow duration-200 hover:text-ink hover:shadow-neu-raised active:shadow-neu-pressed"
            >
              <Bell aria-hidden="true" strokeWidth={2} className="h-5 w-5" />
              {unreadNotifications > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute right-3 top-3 h-2 w-2 rounded-full bg-accent ring-2 ring-canvas"
                />
              )}
            </Link>

            <Link
              href="/settings"
              aria-label="Settings"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-canvas text-muted shadow-neu-raised-sm transition-shadow duration-200 hover:text-ink hover:shadow-neu-raised active:shadow-neu-pressed"
            >
              <Settings aria-hidden="true" strokeWidth={2} className="h-5 w-5" />
            </Link>

            {/*
              The clinic's own logo wins over initials when it is set — that is
              FR-8.4 branding, and it is the fastest way for someone covering
              two clinics to see which one they are looking at.
            */}
            <div className="flex items-center gap-3">
              {activeClinic?.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={activeClinic.logoUrl}
                  alt={`${displayName} logo`}
                  className="h-10 w-10 shrink-0 rounded-full object-cover shadow-neu-raised-sm"
                />
              ) : (
                <Avatar name={displayName} isRaised />
              )}
              <div className="hidden min-w-0 md:block">
                <p className="truncate text-label font-bold text-ink">
                  {displayName}
                </p>
                <p className="truncate text-meta font-medium capitalize text-muted">
                  {roleName}
                </p>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 pb-8 md:px-7">
          <div className="mx-auto w-full max-w-[1440px]">
            <ToastProvider>{children}</ToastProvider>
          </div>
        </main>
      </div>
    </div>
  );
}
