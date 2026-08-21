import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSIONS,
  findPermission,
  HISTORICAL_ALL_PERMISSIONS,
  isKnownPermission,
  isUntouchedHistoricalAdminSet,
  PERMISSION_GROUPS,
  STAGE_1_PERMISSIONS,
  WILDCARD,
} from "@/lib/permissions";

describe("the catalogue", () => {
  it("has no duplicate keys", () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
  });

  it("uses the resource:action naming convention throughout", () => {
    for (const key of ALL_PERMISSIONS) {
      expect(key).toMatch(/^[a-z]+(?::[a-z]+)+$/);
    }
  });

  it("does not contain the wildcard", () => {
    // The wildcard is granted by seeding the Owner role, never by ticking a box:
    // a mintable "*" would turn "create a custom role" into "become the owner".
    expect(ALL_PERMISSIONS).not.toContain(WILDCARD);
    expect(isKnownPermission(WILDCARD)).toBe(false);
  });

  it("gives every permission a label and a description", () => {
    for (const group of PERMISSION_GROUPS) {
      for (const permission of group.permissions) {
        expect(permission.label.length).toBeGreaterThan(0);
        expect(permission.description.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("HISTORICAL_ALL_PERMISSIONS", () => {
  it("is the frozen 20-key pre-Stage-1 catalogue", () => {
    expect(HISTORICAL_ALL_PERMISSIONS).toHaveLength(20);
  });

  it("is a strict subset of the live catalogue", () => {
    // If a key were ever removed from the catalogue while staying here, the
    // untouched-Admin test would stop matching and the backfill would silently
    // skip every tenant.
    for (const key of HISTORICAL_ALL_PERMISSIONS) {
      expect(ALL_PERMISSIONS).toContain(key);
    }
    expect(ALL_PERMISSIONS.length).toBeGreaterThan(HISTORICAL_ALL_PERMISSIONS.length);
  });

  it("has no duplicates", () => {
    expect(new Set(HISTORICAL_ALL_PERMISSIONS).size).toBe(
      HISTORICAL_ALL_PERMISSIONS.length,
    );
  });
});

describe("STAGE_1_PERMISSIONS", () => {
  it("is exactly the twelve keys added by Stage 1", () => {
    expect([...STAGE_1_PERMISSIONS].sort()).toEqual([
      "feature:manage",
      "feature:view",
      "marketing:manage",
      "marketing:view",
      "reports:export",
      "reports:view",
      "settings:manage",
      "settings:view",
      "team:approve",
      "team:invite",
      "team:manage",
      "team:view",
    ]);
  });

  it("marks every new key as pending, since nothing enforces them yet", () => {
    // A catalogue string no call site checks grants nothing. Saying so on screen
    // is the difference between a roadmap and a false promise of protection.
    for (const key of STAGE_1_PERMISSIONS) {
      expect(findPermission(key)?.pending).toBeDefined();
    }
  });

  it("does not overlap the historical set", () => {
    for (const key of STAGE_1_PERMISSIONS) {
      expect(HISTORICAL_ALL_PERMISSIONS).not.toContain(key);
    }
  });
});

describe("isUntouchedHistoricalAdminSet", () => {
  it("matches a seeded Admin role nobody has edited", () => {
    expect(isUntouchedHistoricalAdminSet([...HISTORICAL_ALL_PERMISSIONS])).toBe(true);
  });

  it("ignores ordering, because the roles editor does not preserve it", () => {
    expect(
      isUntouchedHistoricalAdminSet([...HISTORICAL_ALL_PERMISSIONS].reverse()),
    ).toBe(true);
  });

  it("does not match a role with a permission removed", () => {
    expect(
      isUntouchedHistoricalAdminSet(HISTORICAL_ALL_PERMISSIONS.slice(1)),
    ).toBe(false);
  });

  it("does not match a role with a permission added", () => {
    expect(
      isUntouchedHistoricalAdminSet([...HISTORICAL_ALL_PERMISSIONS, "team:view"]),
    ).toBe(false);
  });

  it("does not match a role that already carries the Stage 1 keys", () => {
    // Idempotence: a second backfill run must not append the new keys twice.
    expect(isUntouchedHistoricalAdminSet([...ALL_PERMISSIONS])).toBe(false);
  });

  it("does not match the Owner role", () => {
    expect(isUntouchedHistoricalAdminSet([WILDCARD])).toBe(false);
  });

  it("does not match an empty or unrelated set", () => {
    expect(isUntouchedHistoricalAdminSet([])).toBe(false);
    expect(isUntouchedHistoricalAdminSet(["clinic:read"])).toBe(false);
  });
});
