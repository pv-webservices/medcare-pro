import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import DashboardNav from "@/components/dashboard/DashboardNav";
import ClinicSwitcher from "@/components/dashboard/ClinicSwitcher";
import SignOutButton from "@/components/dashboard/SignOutButton";
import ThemeSwitcher from "@/components/ThemeSwitcher";
import { ToastProvider } from "@/components/ui";
import { listClinicsForActor } from "@/lib/clinics";
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

export default async function DashboardLayout({ children }: DashboardLayoutProps) {
  let actor;
  try {
    actor = await requireActor();
  } catch (error: unknown) {
    if (error instanceof UnauthenticatedError) {
      // A Platform Owner belongs to the reserved platform tenant, which
      // requireActor() refuses to scope to (Stage 2). Sending them to /login
      // would loop: the middleware bounces a signed-in user off /login and
      // straight back here. They go to their own surface instead.
      redirect(error.reason === "platform-tenant" ? "/owner/dashboard" : "/login");
    }
    throw error;
  }

  // The switcher only ever offers clinics this user can actually reach.
  // `countUnreadForActor` returns 0 rather than throwing for a Staff user, so
  // the shell renders the same for everyone — only the badge differs.
  const selectedClinicId = await resolveSelectedClinicId(actor);
  const [clinics, unreadNotifications, held, currentUser, roleName] = await Promise.all([
    listClinicsForActor(actor),
    countUnreadForActor(actor),
    permissionsHeldAnywhere(actor),
    prisma.user.findFirst({
      where: { id: actor.userId, tenantId: actor.tenantId },
      select: { name: true },
    }),
    resolveRoleNameAtTime(actor, selectedClinicId ?? undefined),
  ]);

  const userName = currentUser?.name ?? "Admin User";

  // Tabs the user's roles cannot reach are dropped here rather than rendered
  // and refused. The pages behind them still enforce their own permissions —
  // see the note in src/lib/navigation.ts.
  const links = visibleNavLinks((permission) => holdsAnywhere(held, permission));

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
