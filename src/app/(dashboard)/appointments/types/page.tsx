import Link from "next/link";
import { redirect } from "next/navigation";
import AddServicePanel from "@/components/appointments/AddServicePanel";
import AppointmentTypesTable, {
  type ServiceRow,
} from "@/components/appointments/AppointmentTypesTable";
import { buttonClasses } from "@/components/ui/Button";
import ModuleLocked from "@/components/ui/ModuleLocked";
import PageHeader, { Count } from "@/components/ui/PageHeader";
import {
  listAppointmentTypes,
  type AppointmentTypeRecord,
} from "@/lib/appointmentTypes";
import { listClinicsForActor } from "@/lib/clinics";
import { MODULE_FEATURES, moduleLock } from "@/lib/features";
import { can, PermissionError } from "@/lib/rbac";
import { resolveSelectedClinicId } from "@/lib/selectedClinic";
import { requireActor, UnauthenticatedError } from "@/lib/session";

// The price list — AP-7, over AP-3's appointment type API.
//
// WHY THIS LIVES UNDER /appointments AND NOT UNDER /settings. Every other
// configuration screen in this app is account-level and deliberately
// feature-ungated: if a feature switch could hide /settings/features, an
// organisation could switch away the only control that would put it back (see
// UNGATED_MODULES in lib/features.ts, and the Settings tab's `feature: null` in
// lib/navigation.ts). Appointments is a PREMIUM feature. Listing this screen in
// Settings would therefore have shown a card to organisations with no
// appointments module at all, and — because SETTINGS_VIEW_PERMISSIONS is
// derived from the section list — put a Settings tab in front of every
// receptionist holding `appointment:read`. Kept here, it inherits the gate the
// rest of the module already has and changes nobody's navigation.
//
// USEFUL READ-ONLY, which is why `appointment:read` opens it rather than
// `appointment:type:manage`. The desk quotes these prices; deciding them is
// Admin's job. Retired services are the exception — lib/appointmentTypes.ts
// only honours `includeInactive` for someone who may manage, so a reader who
// cannot edit never sees a service they could not book anyway.

interface ServicesPageProps {
  // Next 16 hands search params to the page as a promise.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function single(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function AppointmentServicesPage({
  searchParams,
}: ServicesPageProps) {
  let actor;
  try {
    actor = await requireActor();
  } catch (error: unknown) {
    if (error instanceof UnauthenticatedError) {
      redirect("/login");
    }
    throw error;
  }

  const locked = await moduleLock(actor, MODULE_FEATURES.appointments);
  if (locked) {
    return <ModuleLocked title="Appointments" reason={locked} />;
  }

  const params = await searchParams;
  const showRetired = single(params.retired) === "true";
  const selectedClinicId = await resolveSelectedClinicId(actor);

  let services: AppointmentTypeRecord[];
  try {
    services = await listAppointmentTypes(actor, {
      clinicId: selectedClinicId ?? undefined,
      includeInactive: showRetired,
    });
  } catch (error: unknown) {
    if (!(error instanceof PermissionError)) {
      throw error;
    }
    return (
      <section className="w-full">
        <PageHeader
          title="Services"
          breadcrumbs={[
          { label: "Appointments", href: "/appointments" },
          { label: "Services" },
        ]}
        />
        <div className="rounded-2xl border border-line bg-canvas-deep px-5 py-4 text-body text-muted">
          Your role cannot view the services this organisation offers. Ask the
          account owner if you need access.
        </div>
      </section>
    );
  }

  const clinics = await listClinicsForActor(actor);

  // ONE `can` PER SCOPE, not one for the page. A tenant-wide service needs the
  // permission tenant-wide; a clinic's service needs it at that clinic. Both
  // are re-checked by lib/appointmentTypes.ts on every write — this is only so
  // the screen does not offer a button the server would refuse.
  const [canScopeTenantWide, ...clinicFlags] = await Promise.all([
    can(actor, "appointment:type:manage"),
    ...clinics.map((clinic) => can(actor, "appointment:type:manage", clinic.id)),
  ]);

  const manageableClinicIds = new Set(
    clinics.filter((_, index) => clinicFlags[index]).map((clinic) => clinic.id),
  );

  const rows: ServiceRow[] = services.map((service) => ({
    ...service,
    canManage: service.clinicId
      ? manageableClinicIds.has(service.clinicId)
      : canScopeTenantWide,
  }));

  const manageableClinics = clinics
    .filter((clinic) => manageableClinicIds.has(clinic.id))
    .map(({ id, name }) => ({ id, name }));

  const canAdd = canScopeTenantWide || manageableClinics.length > 0;

  // Exactly the check lib/appointmentTypes.ts makes before honouring
  // `includeInactive` — the permission at the clinic being listed. Offering the
  // toggle on any looser test would produce a button that silently does
  // nothing for a clinic-scoped admin.
  const canSeeRetired = selectedClinicId
    ? manageableClinicIds.has(selectedClinicId)
    : canScopeTenantWide;
  const bookable = rows.filter((service) => service.isActive).length;
  const selectedClinic = selectedClinicId
    ? clinics.find((clinic) => clinic.id === selectedClinicId)
    : undefined;

  return (
    <section className="space-y-4">
      <PageHeader
        title="Services"
        description="Visit types offered for appointment booking."
        breadcrumbs={[
          { label: "Appointments", href: "/appointments" },
          { label: "Services" },
        ]}
        meta={
          <>
            <Count>{bookable}</Count>{" "}
            {bookable === 1 ? "service" : "services"} bookable
            {selectedClinic ? ` at ${selectedClinic.name}` : " across all clinics"}
            . Duration controls slot length; price is quoted at booking.
          </>
        }
        scope={selectedClinic ? selectedClinic.name : "All clinics"}
        actions={
          <>
            {canSeeRetired && (
              <Link
                href={
                  showRetired
                    ? "/appointments/types"
                    : "/appointments/types?retired=true"
                }
                className={buttonClasses("secondary", "md")}
              >
                {showRetired ? "Hide retired" : "Show retired"}
              </Link>
            )}
            {canAdd && (
              <AddServicePanel
                clinics={manageableClinics}
                canScopeTenantWide={canScopeTenantWide}
              />
            )}
          </>
        }
      />

      <AppointmentTypesTable
        services={rows}
        clinics={manageableClinics}
        canScopeTenantWide={canScopeTenantWide}
        showsRetired={showRetired}
      />
    </section>
  );
}
