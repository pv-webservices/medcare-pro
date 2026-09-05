import Link from "next/link";
import { Activity, AlertTriangle, CheckCircle2, Clock3, PhoneCall } from "lucide-react";
import BookingFollowUpsPanel from "@/components/ivr/BookingFollowUpsPanel";
import PhoneDiagnosticsPanel from "@/components/ivr/PhoneDiagnosticsPanel";
import PhoneMenuTestPanel from "@/components/ivr/PhoneMenuTestPanel";
import PhoneReadinessPanel from "@/components/ivr/PhoneReadinessPanel";
import { buttonClasses, ModuleLocked, PageHeader } from "@/components/ui";
import { listClinicsForActor } from "@/lib/clinics";
import { MODULE_FEATURES, moduleLock } from "@/lib/features";
import { can, holdsAnywhere, permissionsHeldAnywhere } from "@/lib/rbac";
import { resolveSelectedClinicId } from "@/lib/selectedClinic";
import { requireActor } from "@/lib/session";
import { getBookingFollowUpsForActor } from "@/lib/telephony/bookingFollowUps";
import { getPhoneDiagnosticsForActor } from "@/lib/telephony/callDiagnostics";
import { getClinicPhoneSettingsForActor } from "@/lib/telephony/clinicPhoneSettings";
import { getTelephonyTestCallPanelForActor } from "@/lib/telephony/testCall";

function Message({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-canvas px-6 py-10 text-center shadow-card">
      <p className="mx-auto max-w-xl text-body font-medium text-muted">{children}</p>
    </div>
  );
}

function OverviewCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: typeof PhoneCall;
}) {
  return (
    <div className="rounded-2xl border border-line bg-canvas p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-meta font-medium text-muted">{label}</p>
          <p className="mt-1 text-title font-semibold text-ink">{value}</p>
          <p className="mt-1 text-meta text-muted">{detail}</p>
        </div>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <Icon aria-hidden="true" className="h-4 w-4" />
        </span>
      </div>
    </div>
  );
}

export default async function IvrPage() {
  const actor = await requireActor();
  const locked = await moduleLock(actor, MODULE_FEATURES.ivr);
  if (locked) return <ModuleLocked title="IVR" reason={locked} />;

  const held = await permissionsHeldAnywhere(actor);
  const canHandleBookings = holdsAnywhere(held, "appointment:create");
  const canManageSomeTelephony = holdsAnywhere(held, "clinic:edit");
  const [clinics, selectedClinicId] = await Promise.all([
    listClinicsForActor(actor),
    resolveSelectedClinicId(actor),
  ]);
  const clinicId = selectedClinicId ?? (clinics.length === 1 ? clinics[0].id : null);
  const clinic = clinicId ? clinics.find((item) => item.id === clinicId) ?? null : null;
  const canManageSelectedTelephony =
    clinic !== null && canManageSomeTelephony
      ? await can(actor, "clinic:edit", clinic.id)
      : false;
  const now = new Date();

  const bookingFollowUps = canHandleBookings
    ? await getBookingFollowUpsForActor(actor, selectedClinicId)
    : null;
  const operations = canManageSelectedTelephony && clinic
    ? await Promise.all([
        getClinicPhoneSettingsForActor(actor, clinic.id),
        getTelephonyTestCallPanelForActor(actor, clinic.id),
        getPhoneDiagnosticsForActor(actor, clinic.id, now),
      ])
    : null;
  const [settings, testCall, diagnostics] = operations ?? [null, null, null];
  const pendingCount = bookingFollowUps?.items.length ?? 0;
  const issues = diagnostics
    ? diagnostics.health.incompleteCalls +
      diagnostics.health.receptionFailures +
      diagnostics.health.urgentTransferFailures
    : null;
  const readinessLabel = settings
    ? settings.readiness.status === "ready"
      ? "Ready"
      : settings.readiness.status === "attention"
        ? "Needs attention"
        : "Inactive"
    : "Select clinic";

  return (
    <section className="space-y-5">
      <PageHeader
        title="IVR"
        description="Monitor incoming calls, booking follow-ups, phone-menu readiness and call diagnostics."
        scope={clinic?.name ?? "All clinics"}
        actions={
          <>
            <Link href="/settings/phone-settings" className={buttonClasses("secondary", "sm")}>Phone settings</Link>
            <Link href="/settings/phone-menu" className={buttonClasses("secondary", "sm")}>Phone menu</Link>
          </>
        }
      />

      {!canHandleBookings && !canManageSomeTelephony ? (
        <Message>You don&apos;t have permission to work with IVR operations.</Message>
      ) : (
        <>
          <section aria-labelledby="ivr-overview-title" className="space-y-3">
            <div>
              <h2 id="ivr-overview-title" className="text-section font-semibold text-ink">IVR operational overview</h2>
              <p className="mt-0.5 text-meta text-muted">Current operational signals from existing phone records.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <OverviewCard label="Phone status" value={readinessLabel} detail={settings ? clinic!.name : "Clinic-specific"} icon={settings?.readiness.status === "ready" ? CheckCircle2 : PhoneCall} />
              <OverviewCard
                label="Pending booking follow-ups"
                value={canHandleBookings ? pendingCount : "—"}
                detail={canHandleBookings ? (selectedClinicId ? "Selected clinic" : "Accessible clinics") : "Permission required"}
                icon={Clock3}
              />
              <OverviewCard label="Calls observed" value={diagnostics?.health.recentCalls ?? "—"} detail="Last 24 hours" icon={Activity} />
              <OverviewCard label="Issues" value={issues === null ? "—" : issues} detail={issues === null ? "Clinic-specific" : issues === 1 ? "1 issue" : `${issues} issues`} icon={AlertTriangle} />
            </div>
          </section>

          {canHandleBookings && (
            <BookingFollowUpsPanel model={bookingFollowUps} now={now} showEmpty />
          )}

          {operations && clinic && settings && testCall && diagnostics ? (
            <>
              <PhoneReadinessPanel readiness={settings.readiness} routingMode={settings.routingMode} effectiveRoute={settings.effectiveRoute} />
              <PhoneMenuTestPanel key={clinic.id} clinicId={clinic.id} initialTestCall={testCall} />
              <PhoneDiagnosticsPanel diagnostics={diagnostics} />
            </>
          ) : canManageSomeTelephony ? (
            <Message>
              {clinics.length === 0
                ? "No accessible clinic is available for telephone operations."
                : clinic && !canManageSelectedTelephony
                  ? "You don't have permission to manage telephone operations for this clinic."
                  : "Select a clinic to view readiness, run a phone-menu test and inspect call diagnostics."}
            </Message>
          ) : null}
        </>
      )}
    </section>
  );
}
