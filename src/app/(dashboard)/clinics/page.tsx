import { redirect } from "next/navigation";
import ClinicsTable from "@/components/clinics/ClinicsTable";
import AddClinicPanel from "@/components/clinics/AddClinicPanel";
import { listClinicsForActor } from "@/lib/clinics";
import { can } from "@/lib/rbac";
import { requireActor, UnauthenticatedError } from "@/lib/session";

// Clinic list — PRD §6.2 (FR-2.1, FR-2.2).

export default async function ClinicsListPage() {
  let actor;
  try {
    actor = await requireActor();
  } catch (error: unknown) {
    // The middleware normally catches this first; this is the backstop for a
    // session that expires between the middleware check and the render.
    if (error instanceof UnauthenticatedError) {
      redirect("/login");
    }
    throw error;
  }

  const [clinics, canCreate] = await Promise.all([
    listClinicsForActor(actor),
    // Gates the button only. src/lib/clinics.ts re-checks on the write itself —
    // a hidden button is not access control.
    can(actor, "clinic:create"),
  ]);

  return (
    <section>
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">Clinics</h1>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          {clinics.length === 1 ? "1 clinic" : `${clinics.length} clinics`} in
          this account.
        </p>
      </div>

      {/* Above the list: adding a clinic is the only action on this page, and
          the expanded form needs the full width. */}
      {canCreate && (
        <div className="mb-6">
          <AddClinicPanel />
        </div>
      )}

      <ClinicsTable clinics={clinics} />
    </section>
  );
}
