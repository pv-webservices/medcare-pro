import { notFound, redirect } from "next/navigation";
import RegistrationDetail from "@/components/registration/RegistrationDetail";
import { nowClockTime, todayDateOnly } from "@/lib/dates";
import { listDoctorsForActor } from "@/lib/doctors";
import { can, ScopeError } from "@/lib/rbac";
import {
  getRegistrationForActor,
  listDepartmentsForActor,
  listPatientVisitsForActor,
} from "@/lib/registrations";
import { requireActor, UnauthenticatedError } from "@/lib/session";
import ModuleLocked from "@/components/ui/ModuleLocked";
import { MODULE_FEATURES, moduleLock } from "@/lib/features";

// Registration detail and edit — PRD §6.3 (FR-3.5, FR-3.6).
//
// The "Edit History" link is shown only to roles holding
// `registration:history:read`, but that is presentation, not protection: the
// history route enforces the same permission server-side (PRD §9).

interface RegistrationDetailPageProps {
  // Next 16 hands route params to the page as a promise.
  params: Promise<{ id: string }>;
}

export default async function RegistrationDetailPage({
  params,
}: RegistrationDetailPageProps) {
  const { id } = await params;

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
    return <ModuleLocked title="Registration" reason={locked} />;
  }

  let registration;
  try {
    registration = await getRegistrationForActor(actor, id);
  } catch (error: unknown) {
    // Another tenant's registration, an unknown id, and one in a clinic outside
    // this user's scope all render the same 404 — see src/lib/registrations.ts.
    if (error instanceof ScopeError) {
      notFound();
    }
    throw error;
  }

  const [doctors, departments, visits, canEdit, canViewHistory] =
    await Promise.all([
      listDoctorsForActor(actor, { clinicId: registration.clinicId }),
      listDepartmentsForActor(actor, registration.clinicId),
      listPatientVisitsForActor(actor, id),
      can(actor, "registration:edit", registration.clinicId),
      can(actor, "registration:history:read", registration.clinicId),
    ]);

  return (
    <section className="space-y-4">
      <RegistrationDetail
        registration={registration}
        doctors={doctors.map(({ id: doctorId, name, clinicId, department }) => ({
          id: doctorId,
          name,
          clinicId,
          department,
        }))}
        departments={departments}
        visits={visits}
        today={todayDateOnly()}
        now={nowClockTime()}
        canEdit={canEdit}
        canViewHistory={canViewHistory}
      />
    </section>
  );
}
