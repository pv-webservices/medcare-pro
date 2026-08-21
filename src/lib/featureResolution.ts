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
 * Pure: no Prisma, no session, no imports. The caller loads the four rows and
 * passes their resolved values in, so this file is trivially unit-testable and
 * has exactly one copy of the precedence rule.
 *
 * NOT WIRED UP IN STAGE 1. Nothing calls this yet; Stage 8 adds the loaders and
 * the call sites in APIs and server actions — never in the UI alone.
 */

export interface FeatureResolutionInput {
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
   * ABSENCE INHERITS THE TENANT ENTITLEMENT. It means "the Tenant Admin has
   * expressed no opinion", not "denied". Deny-by-default would require a row for
   * every (role x feature) pair and would silently lock every role out of any
   * feature added afterwards — a trap that only shows up in production.
   */
  roleAccess: boolean | null;
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

export function resolveFeatureAccess(
  input: FeatureResolutionInput,
): FeatureResolution {
  if (!input.globalEnabled) {
    return { allowed: false, reason: "global" };
  }

  if (!isTenantEntitled(input)) {
    return { allowed: false, reason: "entitlement" };
  }

  // Absence inherits; only an explicit `false` denies.
  if (input.roleAccess === false) {
    return { allowed: false, reason: "role" };
  }

  if (!input.hasActionPermission) {
    return { allowed: false, reason: "permission" };
  }

  return { allowed: true, reason: null };
}

export function canAccessFeature(input: FeatureResolutionInput): boolean {
  return resolveFeatureAccess(input).allowed;
}
