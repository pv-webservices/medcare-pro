import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import DashboardNav from "@/components/dashboard/DashboardNav";
import ClinicSwitcher from "@/components/dashboard/ClinicSwitcher";
import SignOutButton from "@/components/dashboard/SignOutButton";
import ThemeSwitcher from "@/components/ThemeSwitcher";
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
 * Shared shell for all signed-in pages — sidebar nav plus the FR-2.3 clinic
 * switcher.
 *
 * Route protection itself lives in src/middleware.ts (FR-1.2); the
 * `requireActor` call here is the backstop for a session that expires between
 * the middleware check and the render.
 *
 * This is also where the clinic accent is scoped. `--accent` is set from the
 * *selected* clinic's themeColor (FR-8.4), so switching clinics re-renders the
 * shell and every accent-bearing control changes with it — no client theming
 * layer, no flash. The switcher already refreshes the server tree on change,
 * so it needs no code of its own for this.
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

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-900">
      {/* Sidebar */}
      <aside className="hidden w-[280px] flex-col border-r border-slate-200 bg-white md:flex z-10 shadow-sm relative">
        <div className="flex items-center gap-3 px-6 py-6 border-b border-slate-100">
           <div>
             <div className="font-bold text-slate-900 text-lg tracking-tight leading-none">Medicare Pro</div>
             <div className="text-[10px] text-slate-500 font-medium mt-1 tracking-wide uppercase">Smart Clinic Management</div>
           </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-6">
          {clinics.length > 1 && (
            <div className="mb-6">
              <ClinicSwitcher
                clinics={clinics.map(({ id, name }) => ({ id, name }))}
                selectedClinicId={selectedClinicId}
              />
            </div>
          )}
          
          <DashboardNav links={links} unreadNotifications={unreadNotifications} />
        </div>

        {/* User profile / Logout at bottom */}
        <div className="border-t border-slate-100 p-4">
          <ThemeSwitcher />
          <div className="flex items-center gap-3 mb-4 px-2">
            {activeClinic?.logoUrl ? (
              <img
                src={activeClinic.logoUrl}
                alt={`${displayName} logo`}
                className="h-10 w-10 shrink-0 rounded-full object-cover border border-slate-200"
              />
            ) : (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-light text-primary font-bold">
                {displayName.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900">{displayName}</p>
              <p className="truncate text-xs text-slate-500 capitalize">{roleName}</p>
            </div>
          </div>
          <SignOutButton />
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-4 md:p-8 lg:p-10">
        <ToastProvider>{children}</ToastProvider>
      </main>
    </div>
  );
}
