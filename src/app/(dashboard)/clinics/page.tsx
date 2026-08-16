import { redirect } from "next/navigation";
import ClinicsTable from "@/components/clinics/ClinicsTable";
import AddClinicPanel from "@/components/clinics/AddClinicPanel";
import { listClinicsForActor } from "@/lib/clinics";
import { can } from "@/lib/rbac";
import { resolveSelectedClinicId } from "@/lib/selectedClinic";
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

  const [clinics, canCreate, selectedClinicId] = await Promise.all([
    listClinicsForActor(actor),
    // Gates the button only. src/lib/clinics.ts re-checks on the write itself —
    // a hidden button is not access control.
    can(actor, "clinic:create"),
    // Not for scoping: this page always lists everything the actor can read.
    // It is here so the row matching the switcher can say that it matches.
    resolveSelectedClinicId(actor),
  ]);

  // Sums of what is already on screen, so the header answers "how big is this
  // account?" without a second query or a second page.
  const doctorTotal = clinics.reduce((sum, clinic) => sum + clinic.doctorCount, 0);
  const patientTotal = clinics.reduce((sum, clinic) => sum + clinic.patientCount, 0);

  const heading = (
    <div>
      <h1 className="font-display text-title font-semibold text-ink">Clinics</h1>
      <p className="mt-1 text-label text-muted">
        <span className="font-medium tabular-nums text-ink">{clinics.length}</span>{" "}
        {clinics.length === 1 ? "clinic" : "clinics"}
        {clinics.length > 0 && (
          <>
            {" · "}
            <span className="font-medium tabular-nums text-ink">{doctorTotal}</span>{" "}
            {doctorTotal === 1 ? "doctor" : "doctors"}
            {" · "}
            <span className="font-medium tabular-nums text-ink">{patientTotal}</span>{" "}
            {patientTotal === 1 ? "patient" : "patients"}
          </>
        )}
      </p>
    </div>
  );

  return (
    <section>
      {/* Adding a clinic is the only action on this page. The button lives with
          the title; the form it opens needs the full width, so the component
          owns both slots rather than being wedged into the header. */}
      {canCreate ? (
        <AddClinicPanel heading={heading} />
      ) : (
        <header className="mb-5">{heading}</header>
      )}

      <ClinicsTable clinics={clinics} selectedClinicId={selectedClinicId} />
    </section>
  );
}
