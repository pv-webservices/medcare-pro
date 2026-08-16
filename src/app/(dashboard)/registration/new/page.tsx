import Link from "next/link";
import { redirect } from "next/navigation";
import RegistrationForm from "@/components/registration/RegistrationForm";
import { listClinicsForActor } from "@/lib/clinics";
import { nowClockTime, todayDateOnly } from "@/lib/dates";
import { listDoctorsForActor } from "@/lib/doctors";
import { accessibleClinicScope } from "@/lib/rbac";
import { listDepartmentsForActor } from "@/lib/registrations";
import { requireActor, UnauthenticatedError } from "@/lib/session";

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
    <section>
      <Link
        href="/registration"
        className="mb-4 inline-block text-sm text-black/60 underline dark:text-white/60"
      >
        ← All registrations
      </Link>

      <h1 className="mb-4 text-2xl font-semibold">New registration</h1>

      {clinics.length === 0 ? (
        <p className="rounded border border-black/15 px-4 py-3 text-sm text-black/60 dark:border-white/20 dark:text-white/60">
          {allClinics.length === 0
            ? "Add a clinic before registering patients — every registration belongs to one."
            : "You do not have permission to register patients at any of your clinics."}
        </p>
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
