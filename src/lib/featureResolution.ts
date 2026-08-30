import type { FeatureTier } from "@prisma/client";

/**
 * Feature entitlement resolution — the pure core of Stage 8.
 *
 * Four layers, evaluated strictly in order. Every one is an AND; none is a
 * fallback for another:
 *
 *   1. GLOBAL      Feature.globalEnabled       Owner kill switch, platform-wide
 *   2. ENTITLEMENT PlanFeature, overridden by  Owner, per organisation
 *                  TenantFeatureOverride
 *   3. ROLE        RoleFeatureAccess           Tenant Admin, per role
 *   4. PERMISSION  Role.permissions            src/lib/rbac.ts, unchanged
 *
 * Layers 1 and 2 belong to the Platform Owner; layer 3 belongs to the Tenant
 * Admin. Because every layer is an AND, a Tenant Admin can only ever NARROW
 * access: they cannot reach past a global kill switch, and they cannot grant a
 * feature the organisation is not entitled to.
 *
 * Feature entitlements and role ACTION permissions are separate systems on
 * purpose. A permission says what an action is ("edit a registration"); an
 * entitlement says whether the organisation has the module that action lives in.
 * Conflating them would mean cancelling a plan silently rewrote everyone's role.
 *
 * Pure: no Prisma, no session, no runtime imports. The caller loads the four
 * rows and passes their resolved values in, so this file is trivially
 * unit-testable and has exactly one copy of the precedence rule.
 *
 * WIRED UP IN STAGE 8. The loaders and the fold across a user's several roles
 * live in src/lib/features.ts; the call sites are in the API routes and the
 * page loads, never in the UI alone.
 */

/** Layers 1-3: does this ORGANISATION and ROLE have the module at all? */
export interface ModuleAccessInput {
  /** Layer 1 — Feature.globalEnabled. */
  globalEnabled: boolean;
  /**
   * Layer 2a — the tenant's plan. `null` means the feature is not listed in the
   * plan at all, which is NOT the same as being listed and disabled, though both
   * deny: an override can still grant it.
   */
  planEnabled: boolean | null;
  /**
   * Layer 2b — TenantFeatureOverride. `null` means no override row exists.
   *
   * When present it WINS over the plan in both directions: it can grant a
   * feature the plan omits and revoke one the plan includes. That is the point
   * of an override, and it is why the model requires a reason.
   */
  tenantOverride: boolean | null;
  /**
   * Layer 3 — RoleFeatureAccess. `null` means no row exists for this role and
   * feature.
   *
   * WHAT ABSENCE MEANS DEPENDS ON THE TIER, and that rule was decided during
   * Stage 1 local validation (prisma/migrations/STAGE1_NOTES.md) as binding on
   * this stage. See `tier` below.
   */
  roleAccess: boolean | null;
  /**
   * The feature's tier, which decides what an ABSENT layer-3 row means:
   *
   *   CORE                      — absence ALLOWS. Every role keeps working
   *                               exactly as it did before entitlements were
   *                               enforced, with no backfill and no
   *                               (role x feature) row explosion.
   *   PREMIUM, BETA, INTERNAL   — absence DENIES. A tenant who buys a premium
   *                               feature must not have it appear for every
   *                               role at once; the Tenant Admin decides who
   *                               gets it, by writing a row.
   *
   * Absence still means "the Tenant Admin has expressed no opinion" in both
   * cases. What differs is the safe reading of silence: for a module the
   * organisation has always had, silence means carry on; for one it just
   * acquired, silence means nobody asked for it yet.
   */
  tier: FeatureTier;
  /**
   * Whether the role being resolved holds the `*` wildcard.
   *
   * LAYER 3 CANNOT TOUCH AN OWNER. A tenant-side switch that could take the
   * Features screen away from the account's own root would be a lockout with no
   * in-app remedy, the same hazard lib/roles.ts guards when it refuses any edit
   * leaving nobody holding `*` account-wide.
   *
   * This is immunity from layer 3 ONLY. Layers 1 and 2 belong to the Platform
   * Owner, and an account owner is as subject to a kill switch or a cancelled
   * plan as anybody else.
   */
  roleHoldsWildcard: boolean;
}

/** Every layer, including the action permission the call site checked. */
export interface FeatureResolutionInput extends ModuleAccessInput {
  /** Layer 4 — the outcome of the existing lib/rbac.ts permission check. */
  hasActionPermission: boolean;
}

/** Which layer refused. For logging and Owner/Admin diagnostics, never for the client. */
export type FeatureDenialReason =
  | "global"
  | "entitlement"
  | "role"
  | "permission"
  | null;

export interface FeatureResolution {
  allowed: boolean;
  reason: FeatureDenialReason;
}

/**
 * Layer 2 on its own: is the ORGANISATION entitled to this feature?
 *
 * Split out because the Tenant Admin's feature screen needs exactly this answer
 * to decide which features it may offer to roles at all — it must never present
 * one the tenant does not hold.
 */
export function isTenantEntitled(
  input: Pick<FeatureResolutionInput, "planEnabled" | "tenantOverride">,
): boolean {
  if (input.tenantOverride !== null) {
    return input.tenantOverride;
  }
  return input.planEnabled === true;
}

/** Layers 1-2 for a trusted non-human system channel. */
export function resolveTenantFeatureAccess(
  input: Pick<
    FeatureResolutionInput,
    "globalEnabled" | "planEnabled" | "tenantOverride"
  >,
): FeatureResolution {
  if (!input.globalEnabled) {
    return { allowed: false, reason: "global" };
  }

  return isTenantEntitled(input)
    ? { allowed: true, reason: null }
    : { allowed: false, reason: "entitlement" };
}

/**
 * Layers 1-3 — has this organisation got the module, and is this role allowed
 * to use it?
 *
 * This is the gate the API routes and page loads call, because "may you open
 * the reports module" and "may you read a report" are different questions with
 * different answers and different people to ask about them.
 */
export function resolveModuleAccess(input: ModuleAccessInput): FeatureResolution {
  if (!input.globalEnabled) {
    return { allowed: false, reason: "global" };
  }

  if (!isTenantEntitled(input)) {
    return { allowed: false, reason: "entitlement" };
  }

  // Checked after the platform's own two layers, never before: immunity from a
  // tenant-side switch is not immunity from a kill switch or a cancelled plan.
  if (input.roleHoldsWildcard) {
    return { allowed: true, reason: null };
  }

  if (input.roleAccess === false) {
    return { allowed: false, reason: "role" };
  }

  // Silence reads as consent only for the modules the organisation has always
  // had. See the note on `tier`.
  if (input.roleAccess === null && input.tier !== "CORE") {
    return { allowed: false, reason: "role" };
  }

  return { allowed: true, reason: null };
}

export function resolveFeatureAccess(
  input: FeatureResolutionInput,
): FeatureResolution {
  const moduleVerdict = resolveModuleAccess(input);
  if (!moduleVerdict.allowed) {
    return moduleVerdict;
  }

  if (!input.hasActionPermission) {
    return { allowed: false, reason: "permission" };
  }

  return { allowed: true, reason: null };
}

export function canAccessFeature(input: FeatureResolutionInput): boolean {
  return resolveFeatureAccess(input).allowed;
}

export type ModuleDenialReason = Exclude<FeatureDenialReason, null | "permission">;

/**
 * Thrown when a module is not available to this organisation or this role.
 *
 * Distinct from PermissionError on purpose: a 403 saying "you do not have
 * permission" sends someone to their admin to have a role changed, which will
 * not help if the organisation's plan is the problem. The message names the
 * layer at exactly the granularity that tells them who to ask.
 */
export class FeatureError extends Error {
  readonly featureKey: string;
  readonly reason: ModuleDenialReason;

  constructor(featureKey: string, reason: ModuleDenialReason) {
    super(describeFeatureDenial(reason));
    this.name = "FeatureError";
    this.featureKey = featureKey;
    this.reason = reason;
  }
}

export const FEATURE_DENIAL_MESSAGES: Readonly<Record<ModuleDenialReason, string>> = {
  // Layer 1. Says nothing about which tenants are affected or why the switch is
  // down; "nothing you can change" is the part that stops a support call.
  global: "This feature is temporarily unavailable across MEDCARE PRO. Nothing on your side needs changing.",
  // Layer 2. The organisation's problem, not the person's.
  entitlement: "Your plan does not include this feature. Contact MEDCARE PRO to add it.",
  // Layer 3. Fixable in-app, by someone they can walk over to.
  role: "This feature is switched off for your role. Ask an admin in your organisation to turn it on under Settings → Features.",
};

export function describeFeatureDenial(reason: ModuleDenialReason): string {
  return FEATURE_DENIAL_MESSAGES[reason];
}
