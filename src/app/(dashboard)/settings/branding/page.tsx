import { redirect } from "next/navigation";
import BrandingForm from "@/components/settings/BrandingForm";
import PageHeader from "@/components/ui/PageHeader";
import { getClinicForActor, listClinicsForActor } from "@/lib/clinics";
import { can } from "@/lib/rbac";
import { resolveSelectedClinicId } from "@/lib/selectedClinic";
import { requireActor, UnauthenticatedError } from "@/lib/session";

// Branding — PRD §6.8 (FR-8.3, FR-8.4): logo and theme colour.
//
// Branding is per clinic, because that is where PRD §7 puts `logo_url` and
// `theme_color`; the account carries no such columns. The clinic edited is the
// one selected in the sidebar switcher (FR-2.3), so there is no second clinic
// control here to disagree with it.
//
// The write goes through PATCH /api/clinics/[id], which already enforces
// `clinic:edit` and records the FR-7.1 notification. Nothing here needs its own
// endpoint, and giving it one would mean two ways to edit the same two columns.

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

  const [clinics, selectedClinicId] = await Promise.all([
    listClinicsForActor(actor),
    resolveSelectedClinicId(actor),
  ]);

  if (clinics.length === 0) {
    return (
      <section className="max-w-[1400px] mx-auto w-full animate-in fade-in duration-500 space-y-6">
        <PageHeader title="Branding" />
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-8 text-center shadow-sm">
          <p className="text-sm font-medium text-slate-500">
            No clinics to brand yet. Add a clinic first — its logo and colour are
            set here.
          </p>
        </div>
      </section>
    );
  }

  // The sidebar switcher only renders when there is more than one clinic, so a
  // single-clinic account has nothing to select and is resolved directly.
  const clinicId =
    selectedClinicId ?? (clinics.length === 1 ? clinics[0].id : null);

  if (!clinicId) {
    return (
      <section className="max-w-[1400px] mx-auto w-full animate-in fade-in duration-500 space-y-6">
        <PageHeader title="Branding" />
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-8 text-center shadow-sm">
          <p className="text-sm font-medium text-slate-500">
            Pick a clinic in the sidebar to set its logo and colour. Each clinic is
            branded separately.
          </p>
        </div>
      </section>
    );
  }

  // Throws ScopeError (→ the not-found boundary) if the selection is outside
  // the actor's reach, which resolveSelectedClinicId has already ruled out.
  const clinic = await getClinicForActor(actor, clinicId);
  const canEdit = await can(actor, "clinic:edit", clinicId);

  return (
    <section className="max-w-[1400px] mx-auto w-full animate-in fade-in duration-500 space-y-8">
      <PageHeader
        title="Branding"
        meta={
          <span>
            {clinic.name}
            {clinics.length > 1 && " · switch clinics in the sidebar to brand another"}
          </span>
        }
      />

      <BrandingForm
        clinicId={clinic.id}
        clinicName={clinic.name}
        logoUrl={clinic.logoUrl}
        themeColor={clinic.themeColor}
        canEdit={canEdit}
      />
    </section>
  );
}
