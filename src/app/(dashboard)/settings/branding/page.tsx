import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Building2, Plus } from "lucide-react";
import BrandingForm from "@/components/settings/BrandingForm";
import { buttonClasses } from "@/components/ui/Button";
import { getClinicForActor, listClinicsForActor } from "@/lib/clinics";
import { MODULE_FEATURES, moduleLock } from "@/lib/features";
import {
  accessibleClinicScope,
  can,
  holdsAnywhere,
  permissionsHeldAnywhere,
} from "@/lib/rbac";
import { resolveSelectedClinicId } from "@/lib/selectedClinic";
import { requireActor, UnauthenticatedError } from "@/lib/session";
import { SETTINGS_SECTIONS } from "@/lib/settingsSections";

// Clinics & branding — PRD §6.8 (FR-8.3, FR-8.4) plus the clinic's own name,
// address and city, and organization-level clinic management discoverability.

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

  const [
    clinics,
    selectedClinicId,
    clinicsLockReason,
    readScope,
    canCreateClinic,
  ] = await Promise.all([
    listClinicsForActor(actor),
    resolveSelectedClinicId(actor),
    moduleLock(actor, MODULE_FEATURES.clinics),
    accessibleClinicScope(actor, "clinic:read"),
    can(actor, "clinic:create"),
  ]);

  const isClinicsModuleUnlocked = clinicsLockReason === null;
  const canManageAnywhere =
    holds("clinic:edit") || holds("settings:manage") || canCreateClinic;

  // Organization-level management CTA logic:
  // - Organization Owner or Tenant-wide Admin has readScope.scope === "all" and canManageAnywhere
  // - Clinic-scoped manager with multiple clinics has readScope.scope === "clinics" && readScope.clinicIds.length > 1
  const showManageAllClinics =
    isClinicsModuleUnlocked &&
    readScope.scope === "all" &&
    canManageAnywhere;

  const showViewScopedClinics =
    !showManageAllClinics &&
    isClinicsModuleUnlocked &&
    readScope.scope === "clinics" &&
    readScope.clinicIds.length > 1 &&
    canManageAnywhere;

  if (clinics.length === 0) {
    if (canCreateClinic && isClinicsModuleUnlocked) {
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
              <li className="text-slate-700 font-semibold">Clinics & branding</li>
            </ol>
          </nav>

          {/* Page Heading */}
          <div className="flex items-start gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50 text-indigo-600 shadow-2xs">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
                Clinics & branding
              </h1>
              <p className="mt-0.5 text-xs sm:text-sm text-slate-500">
                Manage this clinic&apos;s details and branding, or open organization-level clinic management.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white px-6 py-8 text-center text-sm text-slate-600 shadow-sm space-y-4">
            <p>
              No clinic has been added yet. Create your first clinic to configure its doctors, appointments, branding and operations.
            </p>
            <div>
              <Link
                href="/clinics"
                className={buttonClasses("primary", "md", "gap-2")}
              >
                <Plus aria-hidden="true" className="h-4 w-4" />
                Add clinic
              </Link>
            </div>
          </div>
        </div>
      );
    }

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
            <li className="text-slate-700 font-semibold">Clinics & branding</li>
          </ol>
        </nav>

        {/* Page Heading with CTA if authorized */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50 text-indigo-600 shadow-2xs">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
                Clinics & branding
              </h1>
              <p className="mt-0.5 text-xs sm:text-sm text-slate-500">
                Manage this clinic&apos;s details and branding, or open organization-level clinic management.
              </p>
            </div>
          </div>

          {showManageAllClinics && (
            <Link
              href="/clinics"
              className={buttonClasses("secondary", "md", "gap-2 shrink-0")}
            >
              <Building2 aria-hidden="true" className="h-4 w-4 text-muted" />
              <span>Manage all clinics</span>
              <ArrowRight aria-hidden="true" className="h-4 w-4 text-muted" />
            </Link>
          )}

          {showViewScopedClinics && (
            <Link
              href="/clinics"
              className={buttonClasses("secondary", "md", "gap-2 shrink-0")}
            >
              <span>View clinics</span>
              <ArrowRight aria-hidden="true" className="h-4 w-4 text-muted" />
            </Link>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-8 text-center text-sm text-slate-600 shadow-sm space-y-4">
          <p>
            Pick a clinic in the sidebar to edit its details. Each clinic keeps
            its own name, address and logo.
          </p>
          {showManageAllClinics && (
            <div>
              <Link
                href="/clinics"
                className={buttonClasses("secondary", "md", "gap-2")}
              >
                <span>Manage all clinics</span>
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            </div>
          )}
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
          <li className="text-slate-700 font-semibold">Clinics & branding</li>
        </ol>
      </nav>

      {/* Page Heading & Manage all clinics CTA */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50 text-indigo-600 shadow-2xs">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
              Clinics & branding
            </h1>
            <p className="mt-0.5 text-xs sm:text-sm text-slate-500">
              Manage this clinic&apos;s details and branding, or open organization-level clinic management.
            </p>
          </div>
        </div>

        {showManageAllClinics && (
          <div className="flex flex-col sm:items-end gap-1 shrink-0">
            <Link
              href="/clinics"
              className={buttonClasses("secondary", "md", "gap-2 shrink-0")}
            >
              <Building2 aria-hidden="true" className="h-4 w-4 text-muted" />
              <span>Manage all clinics</span>
              <ArrowRight aria-hidden="true" className="h-4 w-4 text-muted" />
            </Link>
            <span className="text-[11px] text-muted hidden sm:inline">
              Need another location? Manage organization branches
            </span>
          </div>
        )}

        {showViewScopedClinics && (
          <Link
            href="/clinics"
            className={buttonClasses("secondary", "md", "gap-2 shrink-0")}
          >
            <span>View clinics</span>
            <ArrowRight aria-hidden="true" className="h-4 w-4 text-muted" />
          </Link>
        )}
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
