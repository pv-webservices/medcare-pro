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
import { resolveClinicCapacity } from "@/lib/clinicCapacity";
import ClinicCapacityPanel from "@/components/clinics/ClinicCapacityPanel";

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

  const [clinics, canCreate, selectedClinicId, capacity] = await Promise.all([
    listClinicsForActor(actor),
    // Gates the button only. src/lib/clinics.ts re-checks on the write itself —
    // a hidden button is not access control.
    can(actor, "clinic:create"),
    // Not for scoping: this page always lists everything the actor can read.
    // It is here so the row matching the switcher can say that it matches.
    resolveSelectedClinicId(actor),
    resolveClinicCapacity(actor.tenantId, { includePlans: true }),
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
    <section className="space-y-4">
      {/* Adding a clinic is the only action on this page. The button lives with
          the title; the form it opens needs the full width, so the component
          owns both slots rather than being wedged into the header. */}
      {canCreate && !capacity.isAtLimit && capacity.capacityConfigured ? (
        <AddClinicPanel meta={meta} back={{ href: "/settings/branding", label: "Clinics & branding" }} />
      ) : (
        <PageHeader
          back={{ href: "/settings/branding", label: "Clinics & branding" }}
          title="Clinics"
          description="Every clinic in this account, with its doctors and patients."
          meta={meta}
        />
      )}

      <ClinicCapacityPanel
        canRequest={canCreate}
        capacity={{
          planId: capacity.planId,
          planName: capacity.planName,
          includedClinics: capacity.includedClinics,
          activeGrantQuantity: capacity.activeGrantQuantity,
          effectiveLimit: capacity.effectiveLimit,
          usedClinics: capacity.usedClinics,
          remainingClinics: capacity.remainingClinics,
          isAtLimit: capacity.isAtLimit,
          isOverLimit: capacity.isOverLimit,
          capacityConfigured: capacity.capacityConfigured,
          usesCompatibilityPlan: capacity.usesCompatibilityPlan,
          compatibilityPlanName: capacity.compatibilityPlanName,
          status: capacity.status,
          additionalClinicPrice: capacity.additionalClinicPrice,
          additionalClinicCurrency: capacity.additionalClinicCurrency,
          additionalClinicBillingInterval: capacity.additionalClinicBillingInterval,
          pendingRequest: capacity.pendingRequest
            ? { id: capacity.pendingRequest.id, requestType: capacity.pendingRequest.requestType, requestedQuantity: capacity.pendingRequest.requestedQuantity, status: capacity.pendingRequest.status, paymentStatus: capacity.pendingRequest.paymentStatus, createdAt: capacity.pendingRequest.createdAt.toISOString(), requestedPlan: capacity.pendingRequest.requestedPlan ? { name: capacity.pendingRequest.requestedPlan.name, includedClinics: capacity.pendingRequest.requestedPlan.includedClinics } : null }
            : null,
          latestRequest: capacity.latestRequest
            ? { id: capacity.latestRequest.id, requestType: capacity.latestRequest.requestType, requestedQuantity: capacity.latestRequest.requestedQuantity, status: capacity.latestRequest.status, paymentStatus: capacity.latestRequest.paymentStatus, rejectionReason: capacity.latestRequest.rejectionReason, createdAt: capacity.latestRequest.createdAt.toISOString(), requestedPlan: capacity.latestRequest.requestedPlan ? { name: capacity.latestRequest.requestedPlan.name, includedClinics: capacity.latestRequest.requestedPlan.includedClinics } : null }
            : null,
          higherPlans: capacity.higherPlans.map((plan) => ({ id: plan.id, name: plan.name, includedClinics: plan.includedClinics })),
        }}
      />

      <ClinicsTable clinics={clinics} selectedClinicId={selectedClinicId} />
    </section>
  );
}
