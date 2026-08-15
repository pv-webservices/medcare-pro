import { redirect } from "next/navigation";
import DoctorsTable from "@/components/doctors/DoctorsTable";
import AddDoctorPanel from "@/components/doctors/AddDoctorPanel";
import { listClinicsForActor } from "@/lib/clinics";
import { listDoctorsForActor } from "@/lib/doctors";
import { can } from "@/lib/rbac";
import { resolveSelectedClinicId } from "@/lib/selectedClinic";
import { requireActor, UnauthenticatedError } from "@/lib/session";

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
    <section>
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">Doctors</h1>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          {/* FR-4.1 — the total, reflecting the current clinic filter. */}
          {doctors.length === 1 ? "1 doctor" : `${doctors.length} doctors`}
          {selectedClinic ? ` at ${selectedClinic.name}` : " across all clinics"}.
        </p>
      </div>

      {canCreate && (
        <div className="mb-6">
          <AddDoctorPanel
            clinics={clinics.map(({ id, name }) => ({ id, name }))}
          />
        </div>
      )}

      <DoctorsTable doctors={doctors} showClinic={!selectedClinic} />
    </section>
  );
}
