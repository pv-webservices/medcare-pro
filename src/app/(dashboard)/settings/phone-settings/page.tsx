import { redirect } from "next/navigation";
import PhoneSettingsEditor from "@/components/settings/PhoneSettingsEditor";
import ModuleLocked from "@/components/ui/ModuleLocked";
import PageHeader from "@/components/ui/PageHeader";
import { getClinicForActor, listClinicsForActor } from "@/lib/clinics";
import { MODULE_FEATURES, moduleLock } from "@/lib/features";
import { can, holdsAnywhere, permissionsHeldAnywhere } from "@/lib/rbac";
import { resolveSelectedClinicId } from "@/lib/selectedClinic";
import { requireActor, UnauthenticatedError } from "@/lib/session";
import { SETTINGS_SECTIONS } from "@/lib/settingsSections";
import { getClinicBusinessHoursForActor } from "@/lib/telephony/businessHours";
import { getClinicPhoneSettingsForActor } from "@/lib/telephony/clinicPhoneSettings";
import { getTelephonyTestCallPanelForActor } from "@/lib/telephony/testCall";

const PHONE_SETTINGS = SETTINGS_SECTIONS.find(
  (section) => section.href === "/settings/phone-settings",
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

function supportedTimezones(current: string): string[] {
  const values =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [];
  return [...new Set(["UTC", "Asia/Kolkata", current, ...values])].sort(
    (left, right) => left.localeCompare(right),
  );
}

export default async function PhoneSettingsPage() {
  let actor;
  try {
    actor = await requireActor();
  } catch (error: unknown) {
    if (error instanceof UnauthenticatedError) redirect("/login");
    throw error;
  }

  const locked = await moduleLock(actor, MODULE_FEATURES.clinics);
  if (locked) return <ModuleLocked title="Phone settings" reason={locked} />;

  const held = await permissionsHeldAnywhere(actor);
  const holds = (permission: string) => holdsAnywhere(held, permission);
  if (!PHONE_SETTINGS.viewPermissions.some(holds)) {
    return (
      <Shell>
        <PageHeader title="Phone settings" />
        <Message>
          You don&apos;t have permission to configure clinic phone settings. Ask
          the account owner if you need access.
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
        <PageHeader title="Phone settings" />
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
          title="Phone settings"
          description="Configure call destinations and the weekly schedule used by automatic call handling."
          breadcrumbs={[
            { label: "Settings", href: "/settings" },
            { label: "Phone settings" },
          ]}
        />
        <Message>
          Select a clinic in the sidebar to configure its phone settings.
        </Message>
      </Shell>
    );
  }

  const clinic = await getClinicForActor(actor, clinicId);
  if (!(await can(actor, "clinic:edit", clinicId))) {
    return (
      <Shell>
        <PageHeader
          title="Phone settings"
          description="Configure call destinations and the weekly schedule used by automatic call handling."
          breadcrumbs={[
            { label: "Settings", href: "/settings" },
            { label: "Phone settings" },
          ]}
          meta={clinic.name}
        />
        <Message>
          You don&apos;t have permission to change this clinic&apos;s phone settings.
        </Message>
      </Shell>
    );
  }

  const [settings, businessHours, testCall] = await Promise.all([
    getClinicPhoneSettingsForActor(actor, clinicId),
    getClinicBusinessHoursForActor(actor, clinicId),
    getTelephonyTestCallPanelForActor(actor, clinicId),
  ]);

  return (
    <Shell>
      <PageHeader
        title="Phone settings"
        description="Configure call destinations and the weekly schedule used by automatic call handling."
        breadcrumbs={[
          { label: "Settings", href: "/settings" },
          { label: "Phone settings" },
        ]}
        meta={`${clinic.name} · ${settings.readiness.status === "ready" ? "Ready" : settings.readiness.status === "attention" ? "Needs attention" : "Inactive"}`}
      />

      <PhoneSettingsEditor
        key={clinic.id}
        clinicId={clinic.id}
        clinicName={clinic.name}
        initialSettings={settings}
        initialHours={businessHours.hours}
        initialTestCall={testCall}
        timezoneOptions={supportedTimezones(settings.timezone)}
      />
    </Shell>
  );
}
