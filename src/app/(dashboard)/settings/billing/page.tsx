import { redirect } from "next/navigation";
import Link from "next/link";
import { requireActor, UnauthenticatedError } from "@/lib/session";
import { MODULE_FEATURES, moduleLock } from "@/lib/features";
import { accessibleClinicScope, can } from "@/lib/rbac";
import { clinicWhereForActor } from "@/lib/clinicScope";
import { prisma } from "@/lib/prisma";
import { resolveSelectedClinicId } from "@/lib/selectedClinic";
import { getBillingSettingsForClinic } from "@/lib/billing/billingSettings";
import { listServiceItemsForActor } from "@/lib/billing/serviceItems";
import BillingSettingsForm from "@/components/billing/BillingSettingsForm";
import ServiceItemList from "@/components/billing/ServiceItemList";
import ModuleLocked from "@/components/ui/ModuleLocked";

export default async function BillingSettingsPage() {
  let actor;
  try { actor = await requireActor(); }
  catch (error) { if (error instanceof UnauthenticatedError) redirect("/login"); throw error; }
  const locked = await moduleLock(actor, MODULE_FEATURES.billing);
  if (locked) return <ModuleLocked title="Patient billing" reason={locked} />;
  const where = await clinicWhereForActor(actor, "invoice:read");
  if (!where) return <p className="text-sm text-muted">Your role cannot view billing settings.</p>;
  const [rows, manageScope, canManageAll, selectedClinicId, items] = await Promise.all([
    prisma.clinic.findMany({ where, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    accessibleClinicScope(actor, "billing:settings:manage"), can(actor, "billing:settings:manage"),
    resolveSelectedClinicId(actor, "invoice:read"), listServiceItemsForActor(actor, { includeInactive: true }),
  ]);
  const clinics = rows.map((row) => ({ ...row, canManage: manageScope.scope === "all" || (manageScope.scope === "clinics" && manageScope.clinicIds.includes(row.id)) }));
  const settings = await Promise.all(clinics.map((clinic) => getBillingSettingsForClinic(actor, clinic.id)));
  return <div className="space-y-6">
    <Link href="/settings" className="text-sm text-muted hover:text-ink">Settings</Link>
    <div><h1 className="text-2xl font-semibold text-ink">Patient billing</h1><p className="text-sm text-muted">Clinic settings and service prices for patient bills.</p></div>
    <BillingSettingsForm key={`settings-${selectedClinicId ?? "all"}`} clinics={clinics} settings={settings} selectedClinicId={selectedClinicId} />
    <ServiceItemList key={`services-${selectedClinicId ?? "all"}`} initialItems={items} clinics={clinics} canManageAll={canManageAll} selectedClinicId={selectedClinicId} />
  </div>;
}
