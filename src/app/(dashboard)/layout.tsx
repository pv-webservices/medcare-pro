import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Bell, CalendarPlus, UserPlus } from "lucide-react";
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
  const [clinics, unreadNotifications, held, modules, currentUser, roleName] =
    await Promise.all([
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
    clinics.find((clinic) => clinic.id === selectedClinicId) ?? null;
  const scopeLabel = activeClinic?.name ?? "All clinics";

  const switcherClinics = clinics.map(({ id, name, city, logoUrl }) => ({
    id,
    name,
    city,
    logoUrl,
  }));

  return (
    <div className="flex min-h-screen bg-app">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[268px] shrink-0 flex-col border-r border-line bg-canvas lg:flex">
        <div className="px-4 py-4">
          <BrandMark />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          <DashboardNav links={links} unreadNotifications={unreadNotifications} />
        </div>

        {/*
          A quiet reminder of the scope the sidebar's links will open into. The
          switcher itself is in the header; repeating the control here would give
          the reader two places to change one thing.
        */}
        <div className="border-t border-line px-4 py-3">
          <p className="text-micro font-semibold uppercase text-faint">Viewing</p>
          <p className="mt-1 truncate text-label font-medium text-ink">
            {scopeLabel}
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-[268px]">
        <header className="sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur-md">
          <div className="mx-auto flex w-full max-w-[1500px] items-center gap-3 px-4 py-3 md:px-6 xl:px-8">
            {/*
              Below `lg` the sidebar is not on screen, so the drawer and the
              wordmark stand in for it. They take the same already-filtered
              `links`, so the two surfaces cannot offer different tabs.
            */}
            <MobileNav
              links={links}
              unreadNotifications={unreadNotifications}
              clinics={switcherClinics}
              selectedClinicId={selectedClinicId}
              userName={userName}
              roleName={roleName}
            />

            <div className="min-w-0 flex-1 lg:max-w-[17rem]">
              <ClinicSwitcher
                clinics={switcherClinics}
                selectedClinicId={selectedClinicId}
              />
            </div>

            <div className="ml-auto hidden flex-1 justify-center md:flex">
              <CommandPalette links={links} actions={quickActions} />
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-1.5 md:ml-0">
              {quickActions.length > 0 && (
                <Link
                  href={quickActions[0]!.href}
                  aria-label={quickActions[0]!.label}
                  title={quickActions[0]!.label}
                  className="hidden h-10 w-10 items-center justify-center rounded-2xl border border-line bg-canvas text-muted shadow-card transition-colors duration-150 hover:border-line-strong hover:text-ink sm:flex"
                >
                  {quickActions[0]!.href === "/appointments/new" ? (
                    <CalendarPlus aria-hidden="true" strokeWidth={2} className="h-[18px] w-[18px]" />
                  ) : (
                    <UserPlus aria-hidden="true" strokeWidth={2} className="h-[18px] w-[18px]" />
                  )}
                </Link>
              )}

              <Link
                href="/notifications"
                aria-label={
                  unreadNotifications > 0
                    ? `Notifications, ${unreadNotifications} unread`
                    : "Notifications"
                }
                className="relative flex h-10 w-10 items-center justify-center rounded-2xl border border-line bg-canvas text-muted shadow-card transition-colors duration-150 hover:border-line-strong hover:text-ink"
              >
                <Bell aria-hidden="true" strokeWidth={2} className="h-[18px] w-[18px]" />
                {unreadNotifications > 0 && (
                  <span
                    aria-hidden="true"
                    className="absolute right-2 top-2 h-2 w-2 rounded-full bg-accent ring-2 ring-canvas"
                  />
                )}
              </Link>

              <UserMenu name={userName} role={roleName} scopeLabel={scopeLabel} />
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 pb-10 pt-5 md:px-6 md:pt-6 xl:px-8">
          <div className="mx-auto w-full max-w-[1500px]">
            <ToastProvider>{children}</ToastProvider>
          </div>
        </main>
      </div>
    </div>
  );
}
