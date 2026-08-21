import { describe, expect, it } from "vitest";
import {
  canAccessFeature,
  isTenantEntitled,
  resolveFeatureAccess,
  type FeatureResolutionInput,
} from "@/lib/featureResolution";

/** Every layer open. Individual tests close exactly one. */
const OPEN: FeatureResolutionInput = {
  globalEnabled: true,
  planEnabled: true,
  tenantOverride: null,
  roleAccess: null,
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
        globalEnabled: false,
        planEnabled: false,
        tenantOverride: false,
        roleAccess: false,
        hasActionPermission: false,
      }).reason,
    ).toBe("global");

    expect(
      resolveFeatureAccess({
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
