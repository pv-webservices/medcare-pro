/** PB-2 acceptance on a disposable local database only; no retained tenant fixtures. */
import "dotenv/config";
import assert from "node:assert/strict";
import { testBillingInvoices } from "./test-billing-invoices.mjs";
import { prisma } from "@/lib/prisma";
import { seedFeatureCatalogue, DEFAULT_PLAN_KEY } from "@/lib/defaultFeatures";
import { DEFAULT_ROLES } from "@/lib/defaultRoles";
import { ScopeError, PermissionError, type ActorContext } from "@/lib/rbac";
import { FeatureError } from "@/lib/featureResolution";
import { BadRequestError, ConflictError } from "@/lib/domainErrors";
import { getBillingSettingsForClinic, saveBillingSettings } from "@/lib/billing/billingSettings";
import { createServiceItem, updateServiceItem, listServiceItemsForActor, listBillableServicesForClinic } from "@/lib/billing/serviceItems";

const url = new URL(process.env.DATABASE_URL ?? "mysql://invalid");
if (!["127.0.0.1", "localhost"].includes(url.hostname) || !/^\/medcare_pb2(?:_[a-z0-9]+)?$/.test(url.pathname)) {
  throw new Error("Billing tests require a disposable localhost medcare_pb2 database.");
}
const tenantIds: string[] = [];
const stamp = crypto.randomUUID();
let checks = 0;
function check(label: string, value: unknown) { assert.ok(value, label); checks++; console.log(`PASS ${label}`); }
async function rejects(label: string, work: () => Promise<unknown>, kind: new (...args: never[]) => Error) {
  await assert.rejects(work, (error: unknown) => error instanceof kind);
  checks++; console.log(`PASS ${label}`);
}
const input = (name: string, clinicId: string | null = null) => ({ name, clinicId, category: "CONSULTATION", price: "123.45" });

async function main() {
  await seedFeatureCatalogue(prisma);
  const plan = await prisma.plan.findUniqueOrThrow({ where: { key: DEFAULT_PLAN_KEY } });
  async function tenant(kind: string) {
    const row = await prisma.tenant.create({ data: { businessName: `PB-2 ${kind}`, email: `pb2-${kind}-${stamp}@example.test`, slug: `pb2-${kind}-${stamp}`, status: "ACTIVE", emailVerifiedAt: new Date(), planId: plan.id } });
    tenantIds.push(row.id);
    return row;
  }
  const own = await tenant("own");
  const foreign = await tenant("foreign");
  const a = await prisma.clinic.create({ data: { tenantId: own.id, name: "PB-2 Clinic A" } });
  const b = await prisma.clinic.create({ data: { tenantId: own.id, name: "PB-2 Clinic B" } });
  const f = await prisma.clinic.create({ data: { tenantId: foreign.id, name: "PB-2 Foreign Clinic" } });
  async function actor(kind: string, tenantId: string, clinicId: string | null, permissions: readonly string[]) {
    const role = await prisma.role.create({ data: { tenantId, name: kind, permissions: [...permissions] } });
    const user = await prisma.user.create({ data: { tenantId, name: kind, email: `pb2-${kind}-${stamp}@example.test`, passwordHash: "synthetic-no-login", userRoles: { create: { roleId: role.id, clinicId } } } });
    return { actor: { tenantId, userId: user.id } satisfies ActorContext, roleId: role.id };
  }
  const owner = (await actor("owner", own.id, null, ["*"])).actor;
  const otherOwner = (await actor("foreign", foreign.id, null, ["*"])).actor;
  const staff = (await actor("staff", own.id, a.id, DEFAULT_ROLES.find((role) => role.key === "STAFF")!.permissions)).actor;
  const reception = (await actor("reception", own.id, a.id, DEFAULT_ROLES.find((role) => role.key === "RECEPTIONIST")!.permissions)).actor;
  const managerRow = await actor("manager", own.id, a.id, ["invoice:read", "billing:settings:manage"]);
  const manager = managerRow.actor;
  const nobody = (await actor("nobody", own.id, null, [])).actor;
  const defaults = await getBillingSettingsForClinic(staff, a.id);
  check("Defaults are INV, zero discount and blank optional fields", defaults.invoicePrefix === "INV" && defaults.staffDiscountLimitPercent === "0.00" && defaults.gstin === null && defaults.legalName === null && defaults.footerNote === null);
  check("Reading defaults creates no settings row", await prisma.clinicBillingSettings.count({ where: { tenantId: own.id } }) === 0);
  await rejects("Staff cannot read Clinic B settings by ID", () => getBillingSettingsForClinic(staff, b.id), ScopeError);
  await rejects("Foreign clinic settings are not found", () => getBillingSettingsForClinic(owner, f.id), ScopeError);
  await rejects("Missing clinic settings are not found", () => getBillingSettingsForClinic(owner, "missing"), ScopeError);
  await rejects("Receptionist cannot save settings", () => saveBillingSettings(reception, a.id, {}), PermissionError);
  await rejects("Clinic A manager cannot save B settings", () => saveBillingSettings(manager, b.id, {}), ScopeError);
  const settings = await saveBillingSettings(manager, a.id, { gstin: "27AAPFU0939F1ZV", legalName: " Synthetic legal name ", invoicePrefix: "A1", staffDiscountLimitPercent: "12.5", footerNote: "Synthetic footer" });
  check("Scoped manager saves settings with exact decimals", settings.legalName === "Synthetic legal name" && settings.staffDiscountLimitPercent === "12.50");
  await saveBillingSettings(manager, a.id, settingsInput(settings));
  check("Settings upsert retains one row", await prisma.clinicBillingSettings.count({ where: { clinicId: a.id } }) === 1);
  const global = await createServiceItem(owner, { ...input("Shared service"), taxRatePercent: "18", sacCode: "999311" });
  check("Tenant-wide taxed service is allowed", global.clinicId === null && global.taxRatePercent === "18.00");
  const local = await createServiceItem(manager, { ...input("Clinic service", a.id), taxRatePercent: "5" });
  const other = await createServiceItem(owner, input("Clinic B service", b.id));
  const foreignService = await createServiceItem(otherOwner, input("Foreign service", f.id));
  check("Service ownership derives from actor", (await prisma.serviceItem.findUniqueOrThrow({ where: { id: local.id } })).tenantId === own.id);
  await rejects("Receptionist cannot create a service", () => createServiceItem(reception, input("Denied", a.id)), PermissionError);
  await rejects("Receptionist cannot edit a service", () => updateServiceItem(reception, local.id, { price: "1" }), PermissionError);
  await rejects("Receptionist cannot retire a service", () => updateServiceItem(reception, local.id, { isActive: false }), PermissionError);
  await rejects("Scoped manager cannot create tenant-wide services", () => createServiceItem(manager, input("Denied")), PermissionError);
  await rejects("Scoped manager cannot edit tenant-wide services", () => updateServiceItem(manager, global.id, { name: "Denied" }), PermissionError);
  await rejects("Manager cannot move a service to tenant-wide scope", () => updateServiceItem(manager, local.id, { clinicId: null }), PermissionError);
  await rejects("Manager cannot move a service into another clinic", () => updateServiceItem(manager, local.id, { clinicId: b.id }), ScopeError);
  await rejects("Foreign service update is not found", () => updateServiceItem(owner, foreignService.id, { isActive: false }), ScopeError);
  await rejects("Out-of-clinic service update is not found", () => updateServiceItem(manager, other.id, { isActive: false }), ScopeError);
  await rejects("Foreign clinic create is not found", () => createServiceItem(owner, input("Denied", f.id)), ScopeError);
  await rejects("Unconfigured clinic rejects non-zero GST", () => createServiceItem(owner, { ...input("Taxed", b.id), taxRatePercent: "0.01" }), BadRequestError);
  await rejects("Updating untaxed service to taxed needs GSTIN", () => updateServiceItem(owner, other.id, { taxRatePercent: "18" }), BadRequestError);
  await rejects("Moving taxed service to a clinic without GSTIN is rejected", () => updateServiceItem(owner, global.id, { clinicId: b.id }), BadRequestError);
  await rejects("Duplicate tenant-wide NULL names rejected", () => createServiceItem(owner, input("Shared service")), ConflictError);
  await rejects("Duplicate clinic names rejected", () => createServiceItem(owner, input("Clinic service", a.id)), ConflictError);
  const sameName = await createServiceItem(owner, input("Shared service", a.id));
  check("Same name allowed in a different scope", sameName.id !== global.id);
  await rejects("Scope changes recheck duplicate names", () => updateServiceItem(owner, sameName.id, { clinicId: null }), ConflictError);
  await rejects("Rename rechecks duplicate names", () => updateServiceItem(owner, local.id, { name: "Shared service" }), ConflictError);
  const raced = await Promise.allSettled([createServiceItem(owner, input("Concurrent name")), createServiceItem(owner, input("Concurrent name"))]);
  check("Concurrent tenant-wide duplicate creates commit once", raced.filter((result) => result.status === "fulfilled").length === 1 && raced.some((result) => result.status === "rejected" && result.reason instanceof ConflictError));
  const retired = await updateServiceItem(manager, local.id, { isActive: false });
  check("Retire preserves price, tax and clinic", !retired.isActive && retired.price === "123.45" && retired.taxRatePercent === "5.00" && retired.clinicId === a.id);
  await rejects("Retired names stay reserved", () => createServiceItem(owner, input("Clinic service", a.id)), ConflictError);
  check("Default list omits retired items", !(await listServiceItemsForActor(reception)).some((row) => row.id === local.id));
  check("Retired filter includes retained row", (await listServiceItemsForActor(reception, { includeInactive: true })).some((row) => row.id === local.id));
  check("Billable helper omits retired items", !(await listBillableServicesForClinic(a.id)).some((row) => row.id === local.id));
  check("Restore retains existing ID", (await updateServiceItem(manager, local.id, { isActive: true })).id === local.id);
  const visible = await listServiceItemsForActor(reception);
  check("Receptionist reads clinic and tenant-wide services", visible.some((row) => row.id === global.id) && visible.some((row) => row.id === local.id));
  check("List excludes foreign tenant and other clinic", !visible.some((row) => row.id === foreignService.id || row.id === other.id));
  await rejects("Clinic list filter cannot widen scope", () => listServiceItemsForActor(staff, { clinicId: b.id }), ScopeError);
  await rejects("Foreign clinic filter is not found", () => listServiceItemsForActor(owner, { clinicId: f.id }), ScopeError);
  await rejects("No permission cannot list services", () => listServiceItemsForActor(nobody), PermissionError);
  const billable = await listBillableServicesForClinic(b.id);
  check("Billable helper derives correct tenant and clinic", billable.some((row) => row.id === global.id) && billable.some((row) => row.id === other.id) && !billable.some((row) => row.id === local.id || row.id === foreignService.id));
  const feature = await prisma.feature.findUniqueOrThrow({ where: { key: "billing" } });
  await prisma.roleFeatureAccess.create({ data: { roleId: managerRow.roleId, featureId: feature.id, enabled: false } });
  await rejects("Role feature denial blocks reads", () => getBillingSettingsForClinic(manager, a.id), FeatureError);
  await rejects("Role feature denial blocks writes", () => updateServiceItem(manager, local.id, { price: "9" }), FeatureError);
  await prisma.tenantFeatureOverride.create({ data: { tenantId: own.id, featureId: feature.id, enabled: false, reason: "Synthetic PB-2 test" } });
  await rejects("Tenant entitlement denial blocks owner reads", () => listServiceItemsForActor(owner), FeatureError);
  await rejects("Tenant entitlement denial blocks owner writes", () => saveBillingSettings(owner, a.id, {}), FeatureError);
  await prisma.tenantFeatureOverride.deleteMany({ where: { tenantId: own.id } });
  try {
    await prisma.feature.update({ where: { id: feature.id }, data: { globalEnabled: false } });
    await rejects("Global switch blocks writes", () => createServiceItem(owner, input("Denied")), FeatureError);
    await prisma.feature.update({ where: { id: feature.id }, data: { key: `pb2-missing-${stamp}` } });
    await rejects("Missing billing configuration fails closed", () => listServiceItemsForActor(owner), FeatureError);
  } finally {
    await prisma.feature.update({ where: { id: feature.id }, data: { key: "billing", globalEnabled: feature.globalEnabled } });
  }
  const audit = await prisma.auditLog.findMany({ where: { actorTenantId: own.id, action: { in: ["SERVICE_ITEM_CREATED", "SERVICE_ITEM_UPDATED", "BILLING_SETTINGS_UPDATED"] } } });
  check("All three PB-2 audit actions recorded", new Set(audit.map((row) => row.action)).size === 3);
  check("Settings narrative excluded from audit metadata", !JSON.stringify(audit).includes("Synthetic footer") && !JSON.stringify(audit).includes("Synthetic legal name"));
  check("Rejected writes leave service unchanged", (await prisma.serviceItem.findUniqueOrThrow({ where: { id: local.id } })).price.toFixed(2) === "123.45");
  checks += await testBillingInvoices({ owner, otherOwner, staff, reception, clinicA: a.id, clinicB: b.id, foreignClinic: f.id });
}
function settingsInput(value: Awaited<ReturnType<typeof getBillingSettingsForClinic>>) {
  const { clinicId: _clinicId, ...input } = value;
  return input;
}

try { await main(); }
finally {
  try {
    // ON DELETE RESTRICT: children MUST be removed before fixture tenants.
    await prisma.serviceItem.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.clinicBillingSettings.deleteMany({ where: { tenantId: { in: tenantIds } } });
    // Synthetic audit fixtures only, under the same localhost database guard.
    await prisma.auditLog.deleteMany({ where: { actorTenantId: { in: tenantIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    check("Finally cleanup removed fixture tenants", await prisma.tenant.count({ where: { id: { in: tenantIds } } }) === 0);
  } finally { await prisma.$disconnect(); }
}
console.log(`${checks} billing checks passed (including cleanup).`);
