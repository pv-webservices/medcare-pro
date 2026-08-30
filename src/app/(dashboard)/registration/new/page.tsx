import { redirect } from "next/navigation";
import RegistrationForm from "@/components/registration/RegistrationForm";
import EmptyState from "@/components/ui/EmptyState";
import PageHeader from "@/components/ui/PageHeader";
import { listClinicsForActor } from "@/lib/clinics";
import { nowClockTime, todayDateOnly } from "@/lib/dates";
import { listDoctorsForActor } from "@/lib/doctors";
import { accessibleClinicScope } from "@/lib/rbac";
import { listDepartmentsForActor } from "@/lib/registrations";
import { requireActor, UnauthenticatedError } from "@/lib/session";
import ModuleLocked from "@/components/ui/ModuleLocked";
import { MODULE_FEATURES, moduleLock } from "@/lib/features";

// New registration — PRD §6.3 (FR-3.1).
//
// The Patient ID is generated server-side inside the same transaction as the
// record itself (see src/lib/registrations.ts), so nothing on this page asks
// for one or predicts what it will be.

export default async function NewRegistrationPage() {
  let actor;
  try {
    actor = await requireActor();
  } catch (error: unknown) {
    if (error instanceof UnauthenticatedError) {
      redirect("/login");
    }
    throw error;
  }

  const locked = await moduleLock(actor, MODULE_FEATURES.registrations);
  if (locked) {
    return <ModuleLocked title="Register patient" reason={locked} />;
  }

  // Only clinics this user may actually register into are offered. A read-only
  // role would otherwise see a form that cannot save.
  const creatable = await accessibleClinicScope(actor, "registration:create");

  const [allClinics, doctors, departments] = await Promise.all([
    listClinicsForActor(actor),
    listDoctorsForActor(actor),
    listDepartmentsForActor(actor),
  ]);

  const clinics =
    creatable.scope === "all"
      ? allClinics
      : creatable.scope === "clinics"
        ? allClinics.filter((clinic) => creatable.clinicIds.includes(clinic.id))
        : [];

  return (
    <section className="w-full space-y-6">
      <PageHeader
        title="New registration"
        description="Record a patient visit. A Patient ID is assigned when you save."
        breadcrumbs={[{ label: "Registrations", href: "/registration" }, { label: "New registration" }]}
      />

      {clinics.length === 0 ? (
        <EmptyState
          title={
            allClinics.length === 0
              ? "No clinics yet"
              : "You cannot register patients here"
          }
          guidance={
            allClinics.length === 0
              ? "Add a clinic before registering patients — every registration belongs to one."
              : "Your role does not allow registering patients at any of your clinics. Ask an account owner to change it."
          }
        />
      ) : (
        <RegistrationForm
          clinics={clinics.map(({ id, name }) => ({ id, name }))}
          doctors={doctors.map(({ id, name, clinicId, department }) => ({
            id,
            name,
            clinicId,
            department,
          }))}
          departments={departments}
          // Resolved on the server so the value is identical either side of
          // hydration, and so "today" matches the UTC dates in storage.
          today={todayDateOnly()}
          now={nowClockTime()}
        />
      )}
    </section>
  );
}
