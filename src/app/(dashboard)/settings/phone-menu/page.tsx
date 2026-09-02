import { redirect } from "next/navigation";
import PhoneMenuEditor from "@/components/settings/PhoneMenuEditor";
import ModuleLocked from "@/components/ui/ModuleLocked";
import PageHeader from "@/components/ui/PageHeader";
import { getClinicForActor, listClinicsForActor } from "@/lib/clinics";
import { MODULE_FEATURES, moduleLock } from "@/lib/features";
import { can, holdsAnywhere, permissionsHeldAnywhere } from "@/lib/rbac";
import { resolveSelectedClinicId } from "@/lib/selectedClinic";
import { requireActor, UnauthenticatedError } from "@/lib/session";
import { SETTINGS_SECTIONS } from "@/lib/settingsSections";
import { getClinicIvrProfileForActor } from "@/lib/telephony/ivrProfile";

const PHONE_MENU = SETTINGS_SECTIONS.find(
  (section) => section.href === "/settings/phone-menu",
)!;

function Shell({ children }: { children: React.ReactNode }) {
  return <section className="space-y-4">{children}</section>;
}

function Message({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-canvas px-6 py-10 text-center shadow-card">
      <p className="mx-auto max-w-xl text-body font-medium text-muted">
        {children}
      </p>
    </div>
  );
}

export default async function PhoneMenuSettingsPage() {
  let actor;
  try {
    actor = await requireActor();
  } catch (error: unknown) {
    if (error instanceof UnauthenticatedError) redirect("/login");
    throw error;
  }

  const locked = await moduleLock(actor, MODULE_FEATURES.clinics);
  if (locked) return <ModuleLocked title="Phone menu" reason={locked} />;

  const held = await permissionsHeldAnywhere(actor);
  const holds = (permission: string) => holdsAnywhere(held, permission);
  if (!PHONE_MENU.viewPermissions.some(holds)) {
    return (
      <Shell>
        <PageHeader title="Phone menu" />
        <Message>
          You don&apos;t have permission to configure clinic phone menus. Ask the
          account owner if you need access.
        </Message>
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
        <PageHeader title="Phone menu" />
        <Message>
          {holds("clinic:read")
            ? "This account has no clinic on record. Contact support if a clinic should be available here."
            : "Your role does not reach any clinic. Ask the account owner if you need access."}
        </Message>
      </Shell>
    );
  }

  const clinicId =
    selectedClinicId ?? (clinics.length === 1 ? clinics[0].id : null);
  if (!clinicId) {
    return (
      <Shell>
        <PageHeader
          title="Phone menu"
          description="Customize the greeting and keypad options callers hear when this clinic uses automated call handling."
          breadcrumbs={[
            { label: "Settings", href: "/settings" },
            { label: "Phone menu" },
          ]}
        />
        <Message>
          Select a clinic in the sidebar to configure its phone menu.
        </Message>
      </Shell>
    );
  }

  const clinic = await getClinicForActor(actor, clinicId);
  if (!(await can(actor, "clinic:edit", clinicId))) {
    return (
      <Shell>
        <PageHeader
          title="Phone menu"
          description="Customize the greeting and keypad options callers hear when this clinic uses automated call handling."
          breadcrumbs={[
            { label: "Settings", href: "/settings" },
            { label: "Phone menu" },
          ]}
          meta={clinic.name}
        />
        <Message>
          You don&apos;t have permission to change this clinic&apos;s phone menu.
        </Message>
      </Shell>
    );
  }

  // The service repeats the full tenant/scope/read/edit boundary. Loading the
  // virtual default is read-only; only the editor's explicit PUT creates rows.
  const profile = await getClinicIvrProfileForActor(actor, clinicId);

  return (
    <Shell>
      <PageHeader
        title="Phone menu"
        description="Customize the greeting and keypad options callers hear when this clinic uses automated call handling."
        breadcrumbs={[
          { label: "Settings", href: "/settings" },
          { label: "Phone menu" },
        ]}
        meta={`${clinic.name} · ${profile.source === "custom" ? "Custom menu" : "Default menu"}`}
      />

      <PhoneMenuEditor
        key={clinic.id}
        clinicId={clinic.id}
        clinicName={clinic.name}
        initialProfile={{
          ...profile,
          updatedAt: profile.updatedAt?.toISOString() ?? null,
        }}
      />
    </Shell>
  );
}
