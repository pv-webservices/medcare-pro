import { redirect } from "next/navigation";
import ClinicsTable from "@/components/clinics/ClinicsTable";
import AddClinicPanel from "@/components/clinics/AddClinicPanel";
import PageHeader, { Count } from "@/components/ui/PageHeader";
import { listClinicsForActor } from "@/lib/clinics";
import { can } from "@/lib/rbac";
import { resolveSelectedClinicId } from "@/lib/selectedClinic";
import { requireActor, UnauthenticatedError } from "@/lib/session";
import ModuleLocked from "@/components/ui/ModuleLocked";
import { MODULE_FEATURES, moduleLock } from "@/lib/features";

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

  const locked = await moduleLock(actor, MODULE_FEATURES.clinics);
  if (locked) {
    return <ModuleLocked title="Clinics" reason={locked} />;
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

  const meta = (
    <>
      <Count>{clinics.length}</Count> {clinics.length === 1 ? "clinic" : "clinics"}
      {clinics.length > 0 && (
        <>
          {"·"}
          <Count>{doctorTotal}</Count> {doctorTotal === 1 ? "doctor" : "doctors"}
          {"·"}
          <Count>{patientTotal}</Count>{""}
          {patientTotal === 1 ? "patient" : "patients"}
        </>
      )}
    </>
  );

  return (
    <section className="max-w-[1400px] mx-auto w-full animate-in fade-in duration-500 space-y-6">
      {/* Adding a clinic is the only action on this page. The button lives with
          the title; the form it opens needs the full width, so the component
          owns both slots rather than being wedged into the header. */}
      {canCreate ? (
        <AddClinicPanel meta={meta} />
      ) : (
        <PageHeader title="Clinics" meta={meta} />
      )}

      <ClinicsTable clinics={clinics} selectedClinicId={selectedClinicId} />
    </section>
  );
}
