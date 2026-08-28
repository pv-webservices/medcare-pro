import { redirect } from "next/navigation";
import BrandingForm from "@/components/settings/BrandingForm";
import PageHeader from "@/components/ui/PageHeader";
import { getClinicForActor, listClinicsForActor } from "@/lib/clinics";
import { can, holdsAnywhere, permissionsHeldAnywhere } from "@/lib/rbac";
import { resolveSelectedClinicId } from "@/lib/selectedClinic";
import { requireActor, UnauthenticatedError } from "@/lib/session";
import { SETTINGS_SECTIONS } from "@/lib/settingsSections";

// Clinic details — PRD §6.8 (FR-8.3, FR-8.4) plus the clinic's own name,
// address and city.
//
// The name/address/city half arrived when the Clinics tab was removed: an
// account is created with its clinic (api/auth/signup), so the screen whose job
// was ADDING one had nothing left to do, and its remaining job — editing those
// fields — belongs next to the logo rather than on a tab of its own. The route
// keeps its /settings/branding path; only the label changed.
//
// Branding is per clinic, because that is where PRD §7 puts `logo_url` and
// `theme_color`; the account carries no such columns. The clinic edited is the
// one selected in the sidebar switcher (FR-2.3), so there is no second clinic
// control here to disagree with it.
//
// The write goes through PATCH /api/clinics/[id], which already enforces
// `clinic:edit` and records the FR-7.1 notification. Nothing here needs its own
// endpoint, and giving it one would mean two ways to edit the same two columns.
//
// STAGE 10 — WHICH PERMISSION OPENS THIS. Until now the page had no gate of its
// own: anyone signed in reached it, and `clinic:edit` decided whether the form
// was live. Stage 10 makes `settings:view` and `settings:manage` real without
// narrowing that, so the lists in src/lib/settingsSections.ts are folded with
// ANY:
//
//   open it       settings:view, settings:manage, clinic:read or clinic:edit
//   change it     settings:manage or clinic:edit
//
// A custom role holding only the clinic permissions keeps exactly what it had.
// The two settings keys are what they now additionally open — which is what
// makes them enforced rather than decorative, per the rule in lib/permissions.ts
// that a catalogue string no call site checks grants nothing.

const BRANDING = SETTINGS_SECTIONS.find(
  (section) => section.href === "/settings/branding",
)!;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      {children}
    </section>
  );
}

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

  // Checked here as well as in the sidebar, because hiding a tab is not access
  // control — reaching this URL directly gets the same answer.
  if (!BRANDING.viewPermissions.some(holds)) {
    return (
      <Shell>
        <PageHeader title="Clinic details" />
        <div className="rounded-2xl border border-line bg-canvas-deep px-5 py-4 text-body text-muted">
          Your role cannot view this clinic&apos;s details. Ask the account
          owner if you need access.
        </div>
      </Shell>
    );
  }

  const [clinics, selectedClinicId] = await Promise.all([
    listClinicsForActor(actor),
    resolveSelectedClinicId(actor),
  ]);

  if (clinics.length === 0) {
    return (
      <Shell>
        <PageHeader title="Clinic details" />
        <div className="rounded-2xl bg-canvas px-6 py-8 text-center border border-line shadow-card">
          <p className="text-body font-medium text-muted">
            {holds("clinic:read")
              ? "This account has no clinic on record. An account is normally given one when it is created — contact support so it can be restored."
              : "Your role does not reach any clinic. Ask the account owner if you need access."}
          </p>
        </div>
      </Shell>
    );
  }

  // The sidebar switcher only renders when there is more than one clinic, so a
  // single-clinic account has nothing to select and is resolved directly.
  const clinicId =
    selectedClinicId ?? (clinics.length === 1 ? clinics[0].id : null);

  if (!clinicId) {
    return (
      <Shell>
        <PageHeader title="Clinic details" />
        <div className="rounded-2xl bg-canvas px-6 py-8 text-center border border-line shadow-card">
          <p className="text-body font-medium text-muted">
            Pick a clinic in the sidebar to edit its details. Each clinic keeps
            its own name, address and logo.
          </p>
        </div>
      </Shell>
    );
  }

  // Throws ScopeError (→ the not-found boundary) if the selection is outside
  // the actor's reach, which resolveSelectedClinicId has already ruled out.
  const clinic = await getClinicForActor(actor, clinicId);

  // Resolved against THIS clinic rather than anywhere: a role scoped to the Beta
  // branch may brand Beta and must not brand Alpha. The page-level check above
  // is deliberately the looser one — it decides whether the screen exists for
  // this person, not what they may save from it.
  const canEdit = (
    await Promise.all(
      BRANDING.managePermissions.map((permission) =>
        can(actor, permission, clinicId),
      ),
    )
  ).some(Boolean);

  return (
    <Shell>
      <PageHeader
        title="Clinic details"
        description="Name, address and branding for this clinic."
        breadcrumbs={[{ label: "Settings", href: "/settings" }, { label: "Clinic details" }]}
        meta={
          <span>
            {clinic.name}
            {clinics.length > 1 && "· switch clinics in the sidebar to edit another"}
            {!canEdit && "· view only"}
          </span>
        }
      />

      <BrandingForm
        clinicId={clinic.id}
        clinicName={clinic.name}
        clinicAddress={clinic.address}
        clinicCity={clinic.city}
        logoUrl={clinic.logoUrl}
        themeColor={clinic.themeColor}
        canEdit={canEdit}
      />
    </Shell>
  );
}
