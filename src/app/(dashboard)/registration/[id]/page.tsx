import Link from "next/link";
import PrescriptionHistory from "@/components/prescriptions/PrescriptionHistory";
import { getConsultationForRegistration, listPatientPrescriptions } from "@/lib/prescriptions";
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

  // Entitlement AND clinical read permission: front-desk visit access alone
  // must not load or disclose consultation content/history.
  const clinicalAccess = !(await moduleLock(actor, MODULE_FEATURES.prescriptions)) && await can(actor, "prescription:read", registration.clinicId);
  const clinical = clinicalAccess ? await getConsultationForRegistration(actor, id) : null;
  const prescriptions = clinicalAccess ? await listPatientPrescriptions(actor, registration.patientId) : null;

  return (
    <section className="space-y-6">
      {clinical && <div className="space-y-4 rounded-2xl border border-line bg-canvas p-5">
        <h2 className="text-lg font-semibold">Clinical consultation</h2>
        <p className="text-muted">{clinical.prescription ? `${clinical.prescription.status} · Version ${clinical.prescription.version}` : "No consultation recorded yet."}</p>
        {(clinical.prescription || clinical.mayDraft) && <Link className="font-semibold text-accent underline"
          href={clinical.prescription && clinical.prescription.status !== "DRAFT" ? `/prescriptions/${clinical.prescription.id}` : `/registration/${id}/consultation`}>
          {clinical.prescription ? clinical.prescription.status === "DRAFT" ? "Continue Consultation" : "View Prescription" : "Start Consultation"}
        </Link>}
        {clinical.prescription && clinical.prescription.status !== "DRAFT" && <Link className="ml-4 text-accent underline" href={`/prescriptions/${clinical.prescription.id}/print`}>Print Prescription</Link>}
      </div>}
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
      {prescriptions && <section className="space-y-3"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Patient prescription history</h2><Link className="text-accent underline" href={`/prescriptions?patientId=${registration.patientId}`}>All patient prescriptions ({prescriptions.total})</Link></div><PrescriptionHistory history={prescriptions} /></section>}
    </section>
  );
}
