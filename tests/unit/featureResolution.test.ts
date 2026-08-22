import { describe, expect, it } from "vitest";
import {
  canAccessFeature,
  isTenantEntitled,
  resolveFeatureAccess,
  resolveModuleAccess,
  type FeatureResolutionInput,
} from "@/lib/featureResolution";

/** Every layer open. Individual tests close exactly one. */
const OPEN: FeatureResolutionInput = {
  globalEnabled: true,
  planEnabled: true,
  tenantOverride: null,
  roleAccess: null,
  tier: "CORE",
  roleHoldsWildcard: false,
  hasActionPermission: true,
};

describe("resolveFeatureAccess", () => {
  it("allows when every layer is satisfied", () => {
    expect(resolveFeatureAccess(OPEN)).toEqual({ allowed: true, reason: null });
  });

  it("refuses at the global kill switch before anything else", () => {
    expect(
      resolveFeatureAccess({ ...OPEN, globalEnabled: false, tenantOverride: true }),
    ).toEqual({ allowed: false, reason: "global" });
  });

  it("refuses when the plan does not include the feature", () => {
    expect(resolveFeatureAccess({ ...OPEN, planEnabled: false })).toEqual({
      allowed: false,
      reason: "entitlement",
    });
    expect(resolveFeatureAccess({ ...OPEN, planEnabled: null })).toEqual({
      allowed: false,
      reason: "entitlement",
    });
  });

  it("refuses when the Tenant Admin has switched the feature off for the role", () => {
    expect(resolveFeatureAccess({ ...OPEN, roleAccess: false })).toEqual({
      allowed: false,
      reason: "role",
    });
  });

  it("refuses last on the action permission", () => {
    expect(
      resolveFeatureAccess({ ...OPEN, hasActionPermission: false }),
    ).toEqual({ allowed: false, reason: "permission" });
  });

  it("reports the outermost failing layer when several fail at once", () => {
    expect(
      resolveFeatureAccess({
        ...OPEN,
        globalEnabled: false,
        planEnabled: false,
        tenantOverride: false,
        roleAccess: false,
        hasActionPermission: false,
      }).reason,
    ).toBe("global");

    expect(
      resolveFeatureAccess({
        ...OPEN,
        globalEnabled: true,
        planEnabled: false,
        tenantOverride: null,
        roleAccess: false,
        hasActionPermission: false,
      }).reason,
    ).toBe("entitlement");
  });
});

describe("the tenant override beats the plan in both directions", () => {
  it("grants a feature the plan omits", () => {
    expect(
      resolveFeatureAccess({ ...OPEN, planEnabled: null, tenantOverride: true })
        .allowed,
    ).toBe(true);
  });

  it("revokes a feature the plan includes", () => {
    expect(
      resolveFeatureAccess({ ...OPEN, planEnabled: true, tenantOverride: false }),
    ).toEqual({ allowed: false, reason: "entitlement" });
  });

  it("defers to the plan when no override exists", () => {
    expect(isTenantEntitled({ planEnabled: true, tenantOverride: null })).toBe(true);
    expect(isTenantEntitled({ planEnabled: false, tenantOverride: null })).toBe(false);
  });
});

describe("the Tenant Admin can only ever narrow access", () => {
  // The security property the whole model exists for.
  it("cannot reach past a global kill switch", () => {
    expect(
      canAccessFeature({ ...OPEN, globalEnabled: false, roleAccess: true }),
    ).toBe(false);
  });

  it("cannot grant a feature the organisation is not entitled to", () => {
    expect(
      canAccessFeature({
        ...OPEN,
        planEnabled: false,
        tenantOverride: null,
        roleAccess: true,
      }),
    ).toBe(false);
  });

  it("cannot substitute for the action permission", () => {
    expect(
      canAccessFeature({ ...OPEN, roleAccess: true, hasActionPermission: false }),
    ).toBe(false);
  });
});

describe("an absent RoleFeatureAccess row inherits the tenant entitlement", () => {
  // Deny-by-default would need a row for every (role x feature) pair and would
  // silently lock every role out of any feature added later.
  it("allows when the row is absent and the tenant is entitled", () => {
    expect(canAccessFeature({ ...OPEN, roleAccess: null })).toBe(true);
  });

  it("still refuses when the row is absent and the tenant is not entitled", () => {
    expect(
      canAccessFeature({ ...OPEN, roleAccess: null, planEnabled: false }),
    ).toBe(false);
  });

  it("distinguishes absent (null) from explicitly denied (false)", () => {
    expect(canAccessFeature({ ...OPEN, roleAccess: null })).toBe(true);
    expect(canAccessFeature({ ...OPEN, roleAccess: false })).toBe(false);
  });
});

describe("what an absent layer-3 row means depends on the tier", () => {
  // The rule STAGE1_NOTES.md recorded as binding on Stage 8, implemented here.
  // Getting it backwards in either direction is a real incident: allow-by-
  // default hands a newly sold premium feature to every role at once, and
  // deny-by-default locks every existing role out of the modules they use daily.
  it("lets silence allow a CORE module, so nothing existing breaks", () => {
    expect(
      canAccessFeature({ ...OPEN, tier: "CORE", roleAccess: null }),
    ).toBe(true);
  });

  it("lets silence deny every other tier, so a new module stays invisible", () => {
    for (const tier of ["PREMIUM", "BETA", "INTERNAL"] as const) {
      expect(resolveFeatureAccess({ ...OPEN, tier, roleAccess: null })).toEqual({
        allowed: false,
        reason: "role",
      });
    }
  });

  it("still lets an explicit grant open a non-CORE module", () => {
    // Which is the point: the Tenant Admin decides who gets it, one role at a
    // time, rather than nobody ever getting it.
    expect(
      canAccessFeature({ ...OPEN, tier: "PREMIUM", roleAccess: true }),
    ).toBe(true);
  });

  it("still lets an explicit denial close a CORE module", () => {
    expect(
      canAccessFeature({ ...OPEN, tier: "CORE", roleAccess: false }),
    ).toBe(false);
  });

  it("does not let the tier reach past the organisation's entitlement", () => {
    // An explicit grant on a premium feature the tenant never bought is still a
    // denial, and still reported as the entitlement layer, not the role layer.
    expect(
      resolveFeatureAccess({
        ...OPEN,
        tier: "PREMIUM",
        roleAccess: true,
        planEnabled: false,
      }),
    ).toEqual({ allowed: false, reason: "entitlement" });
  });
});

describe("a wildcard role is immune to layer 3", () => {
  // Lockout guard: a tenant-side switch must never be able to take the settings
  // screen away from the account's own root, because nothing in the app could
  // then give it back.
  it("ignores an explicit denial written against the owner's role", () => {
    expect(
      canAccessFeature({ ...OPEN, roleAccess: false, roleHoldsWildcard: true }),
    ).toBe(true);
  });

  it("ignores the non-CORE deny-by-default too", () => {
    expect(
      canAccessFeature({
        ...OPEN,
        tier: "PREMIUM",
        roleAccess: null,
        roleHoldsWildcard: true,
      }),
    ).toBe(true);
  });

  it("is immunity from the tenant's own layer, not from the platform's", () => {
    // The whole point of the ordering: an account owner is as subject to a kill
    // switch and a cancelled plan as anybody else in their organisation.
    expect(
      resolveFeatureAccess({
        ...OPEN,
        roleHoldsWildcard: true,
        globalEnabled: false,
      }),
    ).toEqual({ allowed: false, reason: "global" });

    expect(
      resolveFeatureAccess({
        ...OPEN,
        roleHoldsWildcard: true,
        planEnabled: false,
      }),
    ).toEqual({ allowed: false, reason: "entitlement" });
  });

  it("does not substitute for the action permission either", () => {
    // Immunity is layer 3 only. The wildcard already satisfies layer 4 through
    // lib/rbac.ts; nothing here should short-circuit that check.
    expect(
      canAccessFeature({
        ...OPEN,
        roleHoldsWildcard: true,
        hasActionPermission: false,
      }),
    ).toBe(false);
  });
});

describe("resolveModuleAccess", () => {
  it("answers layers 1-3 and stops, ignoring the action permission", () => {
    // The module gate and the permission check are asked separately, by
    // different call sites, and must not collapse into one another.
    const withoutPermission: FeatureResolutionInput = {
      ...OPEN,
      hasActionPermission: false,
    };
    expect(resolveModuleAccess(withoutPermission)).toEqual({
      allowed: true,
      reason: null,
    });
  });

  it("agrees with the four-layer resolver whenever the permission is held", () => {
    const cases: Partial<FeatureResolutionInput>[] = [
      {},
      { globalEnabled: false },
      { planEnabled: false },
      { tenantOverride: false },
      { tenantOverride: true, planEnabled: null },
      { roleAccess: false },
      { tier: "PREMIUM" },
      { tier: "PREMIUM", roleAccess: true },
      { roleHoldsWildcard: true, roleAccess: false },
    ];

    for (const override of cases) {
      const input = { ...OPEN, ...override };
      expect(resolveModuleAccess(input)).toEqual(resolveFeatureAccess(input));
    }
  });
});
