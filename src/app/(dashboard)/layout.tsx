import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import DashboardNav from "@/components/dashboard/DashboardNav";
import ClinicSwitcher from "@/components/dashboard/ClinicSwitcher";
import SignOutButton from "@/components/dashboard/SignOutButton";
import { ToastProvider } from "@/components/ui";
import { listClinicsForActor } from "@/lib/clinics";
import { visibleNavLinks } from "@/lib/navigation";
import { countUnreadForActor } from "@/lib/notifications";
import { holdsAnywhere, permissionsHeldAnywhere } from "@/lib/rbac";
import { resolveSelectedClinicId } from "@/lib/selectedClinic";
import { requireActor, UnauthenticatedError } from "@/lib/session";
import { accentStyle } from "@/lib/theme";

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

  // No extra query: the switcher's own list already carries every clinic's
  // branding. "All clinics" leaves themeColor undefined, which resolveAccent
  // answers with the house teal.
  const selectedClinic = clinics.find((clinic) => clinic.id === selectedClinicId);

  return (
    <div className="min-h-screen md:flex" style={accentStyle(selectedClinic?.themeColor)}>
      <aside className="border-b border-line bg-surface p-4 md:w-60 md:shrink-0 md:border-b-0 md:border-r">
        {/* The clinic rail at app scale — the same 4px bar the clinics list
            repeats per row, so the colour on a row and the colour in the
            sidebar are visibly the same fact. */}
        <div className="mb-4 flex items-stretch gap-2.5">
          <span
            aria-hidden="true"
            className={
              selectedClinic
                ? "w-1 shrink-0 rounded-full bg-accent"
                : "w-1 shrink-0 rounded-full bg-line"
            }
          />
          <div className="min-w-0">
            <p className="font-display text-section font-semibold text-ink">
              MEDCARE PRO
            </p>
            <p className="truncate text-label text-muted">
              {selectedClinic?.name ?? "All clinics"}
            </p>
          </div>
        </div>

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

      <main className="min-w-0 flex-1 p-4 md:p-6">
        <ToastProvider>{children}</ToastProvider>
      </main>
    </div>
  );
}
