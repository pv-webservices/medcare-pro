import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  tenantFindUnique: vi.fn(),
  featureFindUnique: vi.fn(),
  planFeatureFindUnique: vi.fn(),
  overrideFindUnique: vi.fn(),
  roleFeatureFindUnique: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: { findUnique: db.tenantFindUnique },
    feature: { findUnique: db.featureFindUnique },
    planFeature: { findUnique: db.planFeatureFindUnique },
    tenantFeatureOverride: { findUnique: db.overrideFindUnique },
    roleFeatureAccess: { findUnique: db.roleFeatureFindUnique },
  },
}));

import { FeatureError, resolveTenantFeatureAccess } from "@/lib/featureResolution";
import { requireTenantFeatureEntitlement } from "@/lib/features";

describe("non-human tenant feature resolution", () => {
  it("evaluates only global, plan, and tenant override layers", () => {
    expect(
      resolveTenantFeatureAccess({
        globalEnabled: true,
        planEnabled: true,
        tenantOverride: null,
      }),
    ).toEqual({ allowed: true, reason: null });
    expect(
      resolveTenantFeatureAccess({
        globalEnabled: false,
        planEnabled: true,
        tenantOverride: true,
      }),
    ).toEqual({ allowed: false, reason: "global" });
    expect(
      resolveTenantFeatureAccess({
        globalEnabled: true,
        planEnabled: false,
        tenantOverride: null,
      }),
    ).toEqual({ allowed: false, reason: "entitlement" });
    expect(
      resolveTenantFeatureAccess({
        globalEnabled: true,
        planEnabled: true,
        tenantOverride: false,
      }),
    ).toEqual({ allowed: false, reason: "entitlement" });
    expect(
      resolveTenantFeatureAccess({
        globalEnabled: true,
        planEnabled: null,
        tenantOverride: true,
      }),
    ).toEqual({ allowed: true, reason: null });
  });
});

describe("requireTenantFeatureEntitlement", () => {
  beforeEach(() => {
    Object.values(db).forEach((mock) => mock.mockReset());
    db.tenantFindUnique.mockResolvedValue({ planId: "plan-a" });
    db.featureFindUnique.mockResolvedValue({
      id: "feature-appointments",
      globalEnabled: true,
    });
    db.planFeatureFindUnique.mockResolvedValue({ enabled: true });
    db.overrideFindUnique.mockResolvedValue(null);
  });

  it("allows a globally enabled feature included by the tenant plan", async () => {
    await expect(
      requireTenantFeatureEntitlement("tenant-a", "appointments"),
    ).resolves.toBeUndefined();

    expect(db.planFeatureFindUnique).toHaveBeenCalledWith({
      where: {
        planId_featureId: {
          planId: "plan-a",
          featureId: "feature-appointments",
        },
      },
      select: { enabled: true },
    });
  });

  it("denies when the global switch is off", async () => {
    db.featureFindUnique.mockResolvedValueOnce({
      id: "feature-appointments",
      globalEnabled: false,
    });

    await expect(
      requireTenantFeatureEntitlement("tenant-a", "appointments"),
    ).rejects.toMatchObject({ reason: "global" } satisfies Partial<FeatureError>);
  });

  it("denies when the plan omits appointments", async () => {
    db.planFeatureFindUnique.mockResolvedValueOnce(null);

    await expect(
      requireTenantFeatureEntitlement("tenant-a", "appointments"),
    ).rejects.toMatchObject(
      { reason: "entitlement" } satisfies Partial<FeatureError>,
    );
  });

  it("lets a tenant override revoke an included feature", async () => {
    db.overrideFindUnique.mockResolvedValueOnce({ enabled: false });

    await expect(
      requireTenantFeatureEntitlement("tenant-a", "appointments"),
    ).rejects.toMatchObject(
      { reason: "entitlement" } satisfies Partial<FeatureError>,
    );
  });

  it("lets a tenant override grant a feature omitted by the plan", async () => {
    db.planFeatureFindUnique.mockResolvedValueOnce(null);
    db.overrideFindUnique.mockResolvedValueOnce({ enabled: true });

    await expect(
      requireTenantFeatureEntitlement("tenant-a", "appointments"),
    ).resolves.toBeUndefined();
  });

  it("never reads human RoleFeatureAccess", async () => {
    db.roleFeatureFindUnique.mockResolvedValue({ enabled: false });

    await expect(
      requireTenantFeatureEntitlement("tenant-a", "appointments"),
    ).resolves.toBeUndefined();
    expect(db.roleFeatureFindUnique).not.toHaveBeenCalled();
  });
});
