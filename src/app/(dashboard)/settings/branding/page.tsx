import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import BrandingForm from "@/components/settings/BrandingForm";
import PageHeader from "@/components/ui/PageHeader";
import { getClinicForActor, listClinicsForActor } from "@/lib/clinics";
import { can, holdsAnywhere, permissionsHeldAnywhere } from "@/lib/rbac";
import { resolveSelectedClinicId } from "@/lib/selectedClinic";
import { requireActor, UnauthenticatedError } from "@/lib/session";
import { SETTINGS_SECTIONS } from "@/lib/settingsSections";

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
    <section className="max-w-[1400px] mx-auto w-full animate-in fade-in duration-500 space-y-6">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1.5 text-label font-medium text-muted transition hover:text-primary"
      >
        <ArrowLeft aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
        Settings
      </Link>
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
        <PageHeader title="Branding" />
        <div className="rounded-xl bg-canvas-deep px-5 py-4 text-sm font-medium text-muted">
          Your role cannot view branding. Ask the account owner if you need
          access.
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
        <PageHeader title="Branding" />
        <div className="rounded-2xl bg-canvas px-6 py-8 text-center shadow-neu-raised-sm">
          <p className="text-sm font-medium text-muted">
            {holds("clinic:read")
              ? "No clinics to brand yet. Add a clinic first — its logo and colour are set here."
              : "Your role does not reach any clinic, and branding is set per clinic. Ask the account owner if you need access."}
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
        <PageHeader title="Branding" />
        <div className="rounded-2xl bg-canvas px-6 py-8 text-center shadow-neu-raised-sm">
          <p className="text-sm font-medium text-muted">
            Pick a clinic in the sidebar to set its logo and colour. Each clinic is
            branded separately.
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
        title="Branding"
        meta={
          <span>
            {clinic.name}
            {clinics.length > 1 && "· switch clinics in the sidebar to brand another"}
            {!canEdit && "· view only"}
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
    </Shell>
  );
}
