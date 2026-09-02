import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";
import BrandingForm from "@/components/settings/BrandingForm";
import { getClinicForActor, listClinicsForActor } from "@/lib/clinics";
import { can, holdsAnywhere, permissionsHeldAnywhere } from "@/lib/rbac";
import { resolveSelectedClinicId } from "@/lib/selectedClinic";
import { requireActor, UnauthenticatedError } from "@/lib/session";
import { SETTINGS_SECTIONS } from "@/lib/settingsSections";

// Clinic details — PRD §6.8 (FR-8.3, FR-8.4) plus the clinic's own name,
// address and city.

const BRANDING = SETTINGS_SECTIONS.find(
  (section) => section.href === "/settings/branding",
)!;

export default async function BrandingSettingsPage() {
  let actor;
  try {
    actor = await requireActor();
  } catch (error: unknown) {
    if (error instanceof UnauthenticatedError) {
      redirect("/login");
    }
    throw error;
  }

  const held = await permissionsHeldAnywhere(actor);
  const holds = (permission: string) => holdsAnywhere(held, permission);

  if (!BRANDING.viewPermissions.some(holds)) {
    return (
      <div className="space-y-6">
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5 text-sm text-slate-600 shadow-sm">
          Your role cannot view this clinic&apos;s details. Ask the account
          owner if you need access.
        </div>
      </div>
    );
  }

  const [clinics, selectedClinicId] = await Promise.all([
    listClinicsForActor(actor),
    resolveSelectedClinicId(actor),
  ]);

  if (clinics.length === 0) {
    return (
      <div className="space-y-6">
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-8 text-center text-sm text-slate-600 shadow-sm">
          {holds("clinic:read")
            ? "This account has no clinic on record. An account is normally given one when it is created — contact support so it can be restored."
            : "Your role does not reach any clinic. Ask the account owner if you need access."}
        </div>
      </div>
    );
  }

  const clinicId =
    selectedClinicId ?? (clinics.length === 1 ? clinics[0].id : null);

  if (!clinicId) {
    return (
      <div className="space-y-6">
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-8 text-center text-sm text-slate-600 shadow-sm">
          Pick a clinic in the sidebar to edit its details. Each clinic keeps
          its own name, address and logo.
        </div>
      </div>
    );
  }

  const clinic = await getClinicForActor(actor, clinicId);

  const canEdit = (
    await Promise.all(
      BRANDING.managePermissions.map((permission) =>
        can(actor, permission, clinicId),
      ),
    )
  ).some(Boolean);

  return (
    <div className="space-y-5">
      {/* Breadcrumbs */}
      <nav aria-label="Breadcrumb">
        <ol className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
          <li>
            <Link href="/settings" className="hover:text-slate-800 transition-colors">
              Settings
            </Link>
          </li>
          <li className="text-slate-400">&gt;</li>
          <li className="text-slate-700 font-semibold">Clinic details</li>
        </ol>
      </nav>

      {/* Page Heading */}
      <div className="flex items-start gap-3.5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50 text-indigo-600 shadow-2xs">
          <Building2 className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            Clinic details
          </h1>
          <p className="mt-0.5 text-xs sm:text-sm text-slate-500">
            Manage your clinic&apos;s name, address, and branding information.
          </p>
        </div>
      </div>

      {/* Main 2-Column Responsive Form & Branding Tips Layout */}
      <BrandingForm
        clinicId={clinic.id}
        clinicName={clinic.name}
        clinicAddress={clinic.address}
        clinicCity={clinic.city}
        logoUrl={clinic.logoUrl}
        themeColor={clinic.themeColor}
        canEdit={canEdit}
      />
    </div>
  );
}
