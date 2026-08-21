import type { FeatureTier } from "@prisma/client";
import type { PrismaClientOrTransaction } from "@/lib/defaultRoles";

/**
 * The starter Feature catalogue and the default Plan — Stage 1.
 *
 * Mirrors `lib/defaultRoles.ts`: seed data plus an idempotent, create-only
 * seeding function that both prisma/seed.ts and the Stage 1 backfill share.
 *
 * FEATURES ARE NOT PERMISSIONS. A permission (lib/permissions.ts) says what an
 * action is — "edit a registration". A feature says whether the organisation has
 * the module that action lives in. They are resolved separately and ANDed
 * together in lib/featureResolution.ts, so cancelling a plan never silently
 * rewrites anybody's role.
 *
 * NOT WIRED UP IN STAGE 1: nothing reads these rows yet. Stage 8 adds the
 * loaders and the enforcement.
 */

export interface DefaultFeatureDefinition {
  key: string;
  name: string;
  description: string;
  tier: FeatureTier;
  /** Layer 1 — the Owner's platform-wide switch. */
  globalEnabled: boolean;
  /** Whether the default plan includes it. */
  inDefaultPlan: boolean;
}

/**
 * One entry per module that exists today, plus the one the permission catalogue
 * names but which has no code behind it.
 *
 * Keys are stable machine identifiers and match the module vocabulary the PRD
 * and the navigation already use, so a feature key reads the same as the tab it
 * governs.
 */
export const DEFAULT_FEATURES: readonly DefaultFeatureDefinition[] = [
  {
    key: "registrations",
    name: "Patient registrations",
    description: "Register patients, record visits, and keep the edit audit trail.",
    tier: "CORE",
    globalEnabled: true,
    inDefaultPlan: true,
  },
  {
    key: "doctors",
    name: "Doctors",
    description: "Doctor profiles, availability calendars and leave.",
    tier: "CORE",
    globalEnabled: true,
    inDefaultPlan: true,
  },
  {
    key: "clinics",
    name: "Clinics",
    description: "Multiple operational sites under one organisation, with branding.",
    tier: "CORE",
    globalEnabled: true,
    inDefaultPlan: true,
  },
  {
    key: "reports",
    name: "Revenue reports",
    description: "Revenue totals, KPIs, growth graph and CSV export.",
    tier: "CORE",
    globalEnabled: true,
    inDefaultPlan: true,
  },
  {
    key: "notifications",
    name: "Notifications",
    description: "In-app activity feed for record changes.",
    tier: "CORE",
    globalEnabled: true,
    inDefaultPlan: true,
  },
  {
    key: "whatsapp",
    name: "WhatsApp messaging",
    description: "Send approved template messages to patients.",
    tier: "CORE",
    globalEnabled: true,
    inDefaultPlan: true,
  },
  {
    key: "team",
    name: "Team management",
    description: "Invite team members, approve them, and assign roles.",
    tier: "CORE",
    globalEnabled: true,
    inDefaultPlan: true,
  },
  {
    key: "settings",
    name: "Organisation settings",
    description: "Roles, permissions, branding and operational settings.",
    tier: "CORE",
    globalEnabled: true,
    inDefaultPlan: true,
  },
  {
    key: "marketing",
    name: "Marketing campaigns",
    description: "Campaign tools. Not built yet.",
    tier: "BETA",
    // Off at layer 1, so no plan or override can reach it. This is what a
    // feature that does not exist yet should look like, and it gives the
    // resolver a real disabled case to be tested against.
    globalEnabled: false,
    inDefaultPlan: false,
  },
];

/**
 * Key of the plan every existing tenant is put on by the Stage 1 backfill.
 *
 * This is a MIGRATION-SAFETY DEFAULT, not a product decision. Stage 8 resolves
 * entitlement from the plan, so a tenant with no plan would be entitled to
 * nothing and every existing organisation would lose access the day enforcement
 * lands. Rename it, price it, or replace it with a real plan matrix whenever the
 * commercial side is decided — nothing depends on the name.
 */
export const DEFAULT_PLAN_KEY = "standard";

export const DEFAULT_PLAN = {
  key: DEFAULT_PLAN_KEY,
  name: "Standard",
  description:
    "Everything in MEDCARE PRO today. The baseline every existing organisation was migrated onto.",
  sortOrder: 0,
} as const;

/**
 * Create-only and idempotent.
 *
 * Existing rows are left ALONE — in particular `globalEnabled` is never
 * rewritten, because an Owner may have deliberately switched a feature off and a
 * re-run of the seed must not quietly switch it back on.
 */
export async function seedFeatureCatalogue(
  client: PrismaClientOrTransaction,
): Promise<{ createdFeatures: string[]; createdPlan: boolean; linkedFeatures: string[] }> {
  const existing = await client.feature.findMany({ select: { key: true } });
  const known = new Set(existing.map((feature) => feature.key));

  const createdFeatures: string[] = [];
  for (const feature of DEFAULT_FEATURES) {
    if (known.has(feature.key)) {
      continue;
    }
    await client.feature.create({
      data: {
        key: feature.key,
        name: feature.name,
        description: feature.description,
        tier: feature.tier,
        globalEnabled: feature.globalEnabled,
      },
    });
    createdFeatures.push(feature.key);
  }

  const existingPlan = await client.plan.findUnique({
    where: { key: DEFAULT_PLAN_KEY },
    select: { id: true },
  });

  const plan =
    existingPlan ??
    (await client.plan.create({
      data: {
        key: DEFAULT_PLAN.key,
        name: DEFAULT_PLAN.name,
        description: DEFAULT_PLAN.description,
        sortOrder: DEFAULT_PLAN.sortOrder,
      },
      select: { id: true },
    }));

  // Link the plan to the features it should include, again create-only: an
  // Owner who removed a feature from the plan must not have it reinstated.
  const linked = await client.planFeature.findMany({
    where: { planId: plan.id },
    select: { feature: { select: { key: true } } },
  });
  const alreadyLinked = new Set(linked.map((row) => row.feature.key));

  const linkedFeatures: string[] = [];
  for (const feature of DEFAULT_FEATURES) {
    if (!feature.inDefaultPlan || alreadyLinked.has(feature.key)) {
      continue;
    }
    const row = await client.feature.findUnique({
      where: { key: feature.key },
      select: { id: true },
    });
    if (!row) {
      continue;
    }
    await client.planFeature.create({
      data: { planId: plan.id, featureId: row.id, enabled: true },
    });
    linkedFeatures.push(feature.key);
  }

  return {
    createdFeatures,
    createdPlan: existingPlan === null,
    linkedFeatures,
  };
}
