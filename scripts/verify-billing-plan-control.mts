/**
 * Billing under the platform owner's plan controls, on a disposable local database.
 *
 *     npm run verify:billing:plans
 *
 * Confirms that "Patient billing" is listed in /owner/features and /owner/plans
 * (the loaders behind them), that the Standard plan — the only plan the code
 * creates, via the create-only catalogue seed — includes it by default, and that
 * the owner's per-plan and global switches really open and close the module.
 *
 * NEVER touches the Standard plan's links: per-plan toggles are aimed at a
 * throwaway plan created and deleted here. Billing's global switch is flipped
 * and restored exactly (in `finally`), which is why this is guarded to the
 * disposable medcare_pb2 database like test:billing.
 */
import "./require-node-24.mjs";
import "dotenv/config";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { DEFAULT_FEATURES, DEFAULT_PLAN_KEY, seedFeatureCatalogue } from "@/lib/defaultFeatures";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { FeatureError } from "@/lib/featureResolution";
import type { ActorContext } from "@/lib/rbac";
import type { PlatformActorContext } from "@/lib/platform/context";
import { getPlanAdmin, getPlatformFeatureAdmin, setFeatureGlobalEnabled, setPlanFeature } from "@/lib/platform/entitlements";

const url = new URL(process.env.DATABASE_URL ?? "mysql://invalid");
if (!["127.0.0.1", "localhost"].includes(url.hostname) || !/^\/medcare_pb2(?:_[a-z0-9]+)?$/.test(url.pathname)) {
  throw new Error("Billing plan checks require a disposable localhost medcare_pb2 database.");
}
const stamp = crypto.randomUUID().slice(0, 8);
const PLAN_KEY = `billing-plan-check-${stamp}`;
const REASON = "Synthetic billing plan-control check";
let checks = 0;
function check(label: string, value: unknown) { assert.ok(value, label); checks++; console.log(`PASS ${label}`); }
async function opens(actor: ActorContext) {
  try { await requireModule(actor, MODULE_FEATURES.billing); return true; }
  catch (error) { if (error instanceof FeatureError) return false; throw error; }
}

await seedFeatureCatalogue(prisma);
const billing = await prisma.feature.findUniqueOrThrow({ where: { key: "billing" },
  select: { id: true, globalEnabled: true, globalChangedById: true, globalChangedAt: true, globalChangeReason: true } });
let tenantId: string | null = null;
let ownerUserId: string | null = null;
let planId: string | null = null;
try {
  const plan = await prisma.plan.create({ data: { key: PLAN_KEY, name: "Billing plan check", sortOrder: 950 } });
  planId = plan.id;
  const tenant = await prisma.tenant.create({ data: { businessName: "Billing plan check", email: `billing-plan-${stamp}@example.test`,
    slug: `billing-plan-${stamp}`, status: "ACTIVE", emailVerifiedAt: new Date(), planId: plan.id } });
  tenantId = tenant.id;
  const role = await prisma.role.create({ data: { tenantId: tenant.id, name: "Synthetic owner", permissions: ["*"] } });
  const user = await prisma.user.create({ data: { tenantId: tenant.id, name: "Synthetic plan owner", email: `billing-plan-owner-${stamp}@example.test`,
    passwordHash: "synthetic-no-login", accountStatus: "ACTIVE", membershipStatus: "ACTIVE", platformRole: "SUPER_ADMIN",
    userRoles: { create: { roleId: role.id, clinicId: null } } } });
  ownerUserId = user.id;
  const owner: PlatformActorContext = { userId: user.id, platformRole: "SUPER_ADMIN", sessionId: "verify-billing-plans" };
  const actor: ActorContext = { tenantId: tenant.id, userId: user.id };

  // Visibility in the owner area.
  const featureRow = (await getPlatformFeatureAdmin(owner)).features.find((row) => row.key === "billing");
  check("/owner/features lists Patient billing", featureRow?.name === "Patient billing");
  const planRows = await getPlanAdmin(owner);
  const planFeature = (key: string) => planRows.find((row) => row.key === key)?.features.find((row) => row.key === "billing");
  check("/owner/plans lists Patient billing for every plan", planRows.every((row) => row.features.some((feature) => feature.key === "billing" && feature.name === "Patient billing")));
  check("Catalogue marks billing for the default plan", DEFAULT_FEATURES.find((feature) => feature.key === "billing")?.inDefaultPlan === true);
  check("The Standard plan includes billing by default", planFeature(DEFAULT_PLAN_KEY)?.included === true);
  check("A plan without the link does not include billing", planFeature(PLAN_KEY)?.included === false);
  check("Billing is closed to an organisation whose plan excludes it", !(await opens(actor)));

  // Per-plan toggle.
  await setPlanFeature(owner, { planKey: PLAN_KEY, featureKey: "billing", included: true, reason: REASON });
  check("Including billing in the plan shows as included", (await getPlanAdmin(owner)).find((row) => row.key === PLAN_KEY)?.features.find((row) => row.key === "billing")?.included === true);
  check("Including billing in the plan opens the module", await opens(actor));
  await setPlanFeature(owner, { planKey: PLAN_KEY, featureKey: "billing", included: false, reason: REASON });
  check("Removing billing from the plan closes the module", !(await opens(actor)));
  await setPlanFeature(owner, { planKey: PLAN_KEY, featureKey: "billing", included: true, reason: REASON });

  // Global switch.
  await setFeatureGlobalEnabled(owner, { featureKey: "billing", enabled: false, reason: REASON, confirmation: "billing" });
  check("/owner/features shows billing switched off globally", (await getPlatformFeatureAdmin(owner)).features.find((row) => row.key === "billing")?.globalEnabled === false);
  check("The global switch closes billing even where the plan includes it", !(await opens(actor)));
  await setFeatureGlobalEnabled(owner, { featureKey: "billing", enabled: true, reason: REASON });
  check("Switching billing back on globally reopens it", await opens(actor));
} finally {
  try {
    // Billing's global row goes back exactly as it was, before its changer can be deleted.
    await prisma.feature.update({ where: { id: billing.id }, data: { globalEnabled: billing.globalEnabled,
      globalChangedById: billing.globalChangedById, globalChangedAt: billing.globalChangedAt, globalChangeReason: billing.globalChangeReason } });
    if (ownerUserId) await prisma.auditLog.deleteMany({ where: { actorUserId: ownerUserId } });
    if (tenantId) {
      await prisma.auditLog.deleteMany({ where: { actorTenantId: tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } });
    }
    if (planId) {
      await prisma.planFeature.deleteMany({ where: { planId } });
      await prisma.plan.delete({ where: { id: planId } });
    }
    const restored = await prisma.feature.findUniqueOrThrow({ where: { id: billing.id }, select: { globalEnabled: true } });
    check("Cleanup restored billing's global switch and removed the throwaway plan", restored.globalEnabled === billing.globalEnabled
      && await prisma.plan.count({ where: { key: PLAN_KEY } }) === 0);
  } finally { await prisma.$disconnect(); }
}
console.log(`${checks} billing plan-control checks passed (including cleanup).`);
