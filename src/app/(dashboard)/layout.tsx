import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import DashboardNav from "@/components/dashboard/DashboardNav";
import ClinicSwitcher from "@/components/dashboard/ClinicSwitcher";
import SignOutButton from "@/components/dashboard/SignOutButton";
import { listClinicsForActor } from "@/lib/clinics";
import { visibleNavLinks } from "@/lib/navigation";
import { countUnreadForActor } from "@/lib/notifications";
import { holdsAnywhere, permissionsHeldAnywhere } from "@/lib/rbac";
import { resolveSelectedClinicId } from "@/lib/selectedClinic";
import { requireActor, UnauthenticatedError } from "@/lib/session";

/**
 * Shared shell for all signed-in pages — sidebar nav plus the FR-2.3 clinic
 * switcher.
 *
 * Route protection itself lives in src/middleware.ts (FR-1.2); the
 * `requireActor` call here is the backstop for a session that expires between
 * the middleware check and the render.
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
      redirect("/login");
    }
    throw error;
  }

  // The switcher only ever offers clinics this user can actually reach.
  // `countUnreadForActor` returns 0 rather than throwing for a Staff user, so
  // the shell renders the same for everyone — only the badge differs.
  const [clinics, selectedClinicId, unreadNotifications, held] = await Promise.all([
    listClinicsForActor(actor),
    resolveSelectedClinicId(actor),
    countUnreadForActor(actor),
    permissionsHeldAnywhere(actor),
  ]);

  // Tabs the user's roles cannot reach are dropped here rather than rendered
  // and refused. The pages behind them still enforce their own permissions —
  // see the note in src/lib/navigation.ts.
  const links = visibleNavLinks((permission) => holdsAnywhere(held, permission));

  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b border-black/15 p-4 md:w-56 md:shrink-0 md:border-b-0 md:border-r dark:border-white/20">
        <p className="mb-4 text-sm font-semibold">MEDCARE PRO</p>

        {clinics.length > 1 && (
          <div className="mb-4">
            <ClinicSwitcher
              clinics={clinics.map(({ id, name }) => ({ id, name }))}
              selectedClinicId={selectedClinicId}
            />
          </div>
        )}

        <DashboardNav links={links} unreadNotifications={unreadNotifications} />

        <div className="mt-4 md:mt-6">
          <SignOutButton />
        </div>
      </aside>

      <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
    </div>
  );
}
