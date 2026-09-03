import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Bell, CalendarPlus, MessageSquare, UserPlus } from "lucide-react";
import BrandMark from "@/components/dashboard/BrandMark";
import ClinicSwitcher from "@/components/dashboard/ClinicSwitcher";
import CommandPalette, {
  type PaletteAction,
} from "@/components/dashboard/CommandPalette";
import DashboardNav from "@/components/dashboard/DashboardNav";
import MobileNav from "@/components/dashboard/MobileNav";
import UserMenu from "@/components/dashboard/UserMenu";
import { ToastProvider } from "@/components/ui";
import { listClinicsForActor } from "@/lib/clinics";
import { resolveModulesForActor } from "@/lib/features";
import { visibleNavLinks } from "@/lib/navigation";
import { countUnreadForActor } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { holdsAnywhere, permissionsHeldAnywhere, resolveRoleNameAtTime } from "@/lib/rbac";
import { resolveSelectedClinicId } from "@/lib/selectedClinic";
import { requireActor, UnauthenticatedError } from "@/lib/session";

/**
 * The shell every signed-in page renders inside.
 *
 * THREE PARTS, EACH WITH ONE JOB. The sidebar answers "what is in this
 * product"; the header answers "whose data am I looking at, and who am I"; the
 * canvas is the page. Nothing is duplicated between them — the clinic switcher
 * lives in the header only, navigation in the sidebar only — because a control
 * that appears twice is a control the reader has to check twice.
 *
 * THE SIDEBAR IS A FIXED COLUMN, NOT A SCROLLING ONE. It stays put while the
 * page scrolls, and its own list scrolls independently when a role sees every
 * module. On a long registrations table, navigation that scrolls away is
 * navigation the user has to scroll back up to reach.
 *
 * Route protection itself lives in src/middleware.ts (FR-1.2); the
 * `requireActor` call here is the backstop for a session that expires between
 * the middleware check and the render.
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
 * clicked "Sign up" on the login screen went /signup -> /dashboard -> refused ->
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
      redirect(signedOutRedirect(error));
    }
    throw error;
  }

  // The switcher only ever offers clinics this user can actually reach.
  // `countUnreadForActor` returns 0 rather than throwing for a Staff user, so
  // the shell renders the same for everyone — only the badge differs.
  const selectedClinicId = await resolveSelectedClinicId(actor);
  const [clinics, unreadNotifications, held, modules, currentUser] =
    await Promise.all([
      listClinicsForActor(actor),
      countUnreadForActor(actor),
      permissionsHeldAnywhere(actor),
      resolveModulesForActor(actor),
      prisma.user.findFirst({
        where: { id: actor.userId, tenantId: actor.tenantId },
        select: { name: true, email: true },
      }),
    ]);

  const activeClinicId =
    selectedClinicId ?? (clinics.length === 1 ? clinics[0]?.id : null);
  const roleName = await resolveRoleNameAtTime(
    actor,
    activeClinicId ?? undefined,
  );

  const userName = currentUser?.name ?? "Admin User";

  // If the user corresponds to a registered doctor in the tenant, retrieve their gender profile
  const userDoctor = currentUser?.name
    ? await prisma.doctor.findFirst({
        where: {
          clinic: { tenantId: actor.tenantId },
          name: currentUser.name,
        },
        select: { gender: true },
      })
    : null;
  const userGender = userDoctor?.gender ?? null;

  // Tabs the user's roles cannot reach are dropped here rather than rendered
  // and refused, and Stage 8 adds the same courtesy for a module the
  // organisation or the role does not have. The pages behind them still enforce
  // both checks — see the note in src/lib/navigation.ts.
  const holdsPermission = (permission: string) => holdsAnywhere(held, permission);
  const links = visibleNavLinks(
    holdsPermission,
    // A key missing from the map means the catalogue row is missing, which
    // lib/features.ts already treats as a denial and logs. Hiding the tab keeps
    // the shell consistent with the page behind it.
    (feature) => modules.get(feature)?.allowed === true,
  );

  /**
   * The palette's quick actions, gated by the same permission AND the same
   * module switch as the pages they lead to. An action offered here that the
   * destination would refuse is a worse experience than no action at all.
   */
  const quickActions: PaletteAction[] = [
    {
      href: "/appointments/new",
      label: "Book an appointment",
      hint: "Schedule a visit",
      permission: "appointment:create",
      feature: "appointments",
    },
    {
      href: "/registration/new",
      label: "New registration",
      hint: "Register a patient visit",
      permission: "registration:create",
      feature: "registrations",
    },
  ]
    .filter(
      (action) =>
        holdsPermission(action.permission) &&
        modules.get(action.feature)?.allowed === true,
    )
    .map(({ href, label, hint }) => ({ href, label, hint }));

  const activeClinic =
    clinics.find((clinic) => clinic.id === activeClinicId) ?? null;
  const scopeLabel = activeClinic?.name ?? "All clinics";

  const switcherClinics = clinics.map(({ id, name, city, logoUrl }) => ({
    id,
    name,
    city,
    logoUrl,
  }));

  const canViewMessages = links.some((link) => link.href === "/messages");

  return (
    <div className="flex min-h-screen bg-app">
      {/* Desktop Dark Left Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 shrink-0 flex-col border-r border-slate-800/70 bg-[#090e23] text-white lg:flex">
        <div className="border-b border-slate-800/60 px-4 py-4">
          <BrandMark />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-4">
          <DashboardNav links={links} unreadNotifications={unreadNotifications} />
        </div>

        {/* Sidebar Viewing Scope Card */}
        <div className="border-t border-slate-800/60 p-3.5 mt-auto">
          <ClinicSwitcher
            clinics={switcherClinics}
            selectedClinicId={selectedClinicId}
            variant="sidebar"
          />
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        {/* Top Bar */}
        <header className="sticky top-0 z-20 border-b border-slate-200/90 bg-white shadow-xs">
          <div className="mx-auto flex h-18 w-full max-w-[1560px] items-center gap-3 px-3 sm:px-4 md:px-6 xl:px-7">
            {/* Mobile Nav Trigger & Brand */}
            <MobileNav
              links={links}
              unreadNotifications={unreadNotifications}
              clinics={switcherClinics}
              selectedClinicId={selectedClinicId}
              userName={userName}
              roleName={roleName}
              gender={userGender}
            />

            <BrandMark isCompact className="lg:hidden" />

            {/* Left: Clinic Selector */}
            <div className="hidden min-w-0 flex-1 sm:block lg:max-w-[17rem]">
              <ClinicSwitcher
                clinics={switcherClinics}
                selectedClinicId={selectedClinicId}
                variant="topbar"
              />
            </div>

            {/* Center: Global Search */}
            <div className="ml-auto hidden flex-1 justify-center md:flex">
              <CommandPalette links={links} actions={quickActions} />
            </div>

            {/* Right-side Action Buttons & User Profile */}
            <div className="ml-auto flex shrink-0 items-center gap-2 md:ml-0">
              {quickActions.length > 0 && (
                <Link
                  href={quickActions[0]!.href}
                  aria-label={quickActions[0]!.label}
                  title={quickActions[0]!.label}
                  className="hidden h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 shadow-xs transition-colors duration-150 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 xl:flex"
                >
                  {quickActions[0]!.href === "/appointments/new" ? (
                    <CalendarPlus aria-hidden="true" strokeWidth={2} className="h-[18px] w-[18px]" />
                  ) : (
                    <UserPlus aria-hidden="true" strokeWidth={2} className="h-[18px] w-[18px]" />
                  )}
                </Link>
              )}

              {canViewMessages && (
                <Link
                  href="/messages"
                  aria-label="Messages"
                  className="hidden h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 shadow-xs transition-colors duration-150 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 sm:flex"
                >
                  <MessageSquare aria-hidden="true" strokeWidth={2} className="h-[18px] w-[18px]" />
                </Link>
              )}

              <Link
                href="/notifications"
                aria-label={
                  unreadNotifications > 0
                    ? `Notifications, ${unreadNotifications} unread`
                    : "Notifications"
                }
                className="relative flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 shadow-xs transition-colors duration-150 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
              >
                <Bell aria-hidden="true" strokeWidth={2} className="h-[18px] w-[18px]" />
                {unreadNotifications > 0 && (
                  <span
                    aria-hidden="true"
                    className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-indigo-600 ring-2 ring-white"
                  />
                )}
              </Link>

              <UserMenu
                name={userName}
                role={roleName}
                scopeLabel={scopeLabel}
                gender={userGender}
              />
            </div>
          </div>

          <div className="grid gap-2 border-t border-slate-100 bg-slate-50/50 px-3 py-3 sm:hidden">
            <ClinicSwitcher
              clinics={switcherClinics}
              selectedClinicId={selectedClinicId}
              variant="topbar"
            />
            <CommandPalette links={links} actions={quickActions} />
          </div>
        </header>

        <main className="min-w-0 flex-1 px-3 pb-10 pt-4 sm:px-4 md:px-6 md:pt-5 xl:px-7">
          <div className="mx-auto w-full max-w-[1560px]">
            <ToastProvider>{children}</ToastProvider>
          </div>
        </main>
      </div>
    </div>
  );
}
