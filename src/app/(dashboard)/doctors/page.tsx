import { redirect } from "next/navigation";
import DoctorsTable from "@/components/doctors/DoctorsTable";
import AddDoctorPanel from "@/components/doctors/AddDoctorPanel";
import PageHeader from "@/components/ui/PageHeader";
import { listClinicsForActor } from "@/lib/clinics";
import { listDoctorsForActor } from "@/lib/doctors";
import { can } from "@/lib/rbac";
import { resolveSelectedClinicId } from "@/lib/selectedClinic";
import { requireActor, UnauthenticatedError } from "@/lib/session";
import ModuleLocked from "@/components/ui/ModuleLocked";
import { MODULE_FEATURES, moduleLock } from "@/lib/features";

// Doctors — PRD §6.4 (FR-4.1, FR-4.2).
//
// FR-4.1's "filterable by clinic" is driven by the sidebar clinic switcher
// (FR-2.3) rather than a second filter control on this page: one place to
// choose a clinic, applying to every module.

export default async function DoctorsListPage() {
  let actor;
  try {
    actor = await requireActor();
  } catch (error: unknown) {
    if (error instanceof UnauthenticatedError) {
      redirect("/login");
    }
    throw error;
  }

  const locked = await moduleLock(actor, MODULE_FEATURES.doctors);
  if (locked) {
    return <ModuleLocked title="Doctors" reason={locked} />;
  }

  const selectedClinicId = await resolveSelectedClinicId(actor);

  const [doctors, clinics, canCreate] = await Promise.all([
    listDoctorsForActor(actor, { clinicId: selectedClinicId }),
    // The add form needs somewhere to put a new doctor; only clinics this user
    // can actually reach are offered.
    listClinicsForActor(actor),
    can(actor, "doctor:create", selectedClinicId ?? undefined),
  ]);

  const selectedClinic = selectedClinicId
    ? clinics.find((clinic) => clinic.id === selectedClinicId)
    : undefined;

  return (
    <section className="space-y-6">
      <PageHeader
        title="Doctors"
        description="Manage doctors, availability and leave."
        scope={selectedClinic ? selectedClinic.name : "All clinics"}
        meta={
          <>
            {/* FR-4.1 — the total, reflecting the current clinic filter. */}
            {doctors.length === 1 ? "1 doctor" : `${doctors.length} doctors`}
            {selectedClinic ? ` at ${selectedClinic.name}` : " across all clinics"}.
          </>
        }
        actions={
          canCreate ? (
            <AddDoctorPanel clinics={clinics.map(({ id, name }) => ({ id, name }))} />
          ) : undefined
        }
      />

      <DoctorsTable doctors={doctors} showClinic={!selectedClinic} />
    </section>
  );
}
