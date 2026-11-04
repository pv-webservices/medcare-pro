import { describe, expect, it, vi } from "vitest";

// lib/roles reaches next-auth through the session module; only its schema is
// exercised here.
vi.mock("@/lib/session", () => ({
  requireActor: vi.fn(),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));
import {
  ALL_PERMISSIONS,
  PERMISSION_GROUPS,
  RETIRED_PERMISSION_KEYS,
  RETIRED_PERMISSIONS,
  isKnownPermission,
  withoutRetiredPermissions,
} from "@/lib/permissions";
import { DEFAULT_ROLES } from "@/lib/defaultRoles";
import { CATALOGUE_FEATURE_KEYS, MODULE_FEATURES } from "@/lib/moduleFeatures";
import { createRoleSchema, roleMutationSchema, updateRoleSchema } from "@/lib/roles";

// RM-1 removed Clinical AI. Roles saved before that still store its keys, and
// the roles editor submits a role's stored set back on save, so those keys must
// stay acceptable without being offered, granted or seeded.
describe("retired Clinical AI permission keys (RM-1)", () => {
  const retired = [...RETIRED_PERMISSION_KEYS];

  it("covers exactly the six removed clinical-ai keys", () => {
    expect(retired.sort()).toEqual([
      "clinical-ai:facts-extract",
      "clinical-ai:facts-review",
      "clinical-ai:recording",
      "clinical-ai:transcript-read",
      "clinical-ai:transcription",
      "clinical-ai:writing",
    ]);
  });

  it("are still accepted when an existing role is saved", () => {
    for (const key of retired) expect(isKnownPermission(key)).toBe(true);
  });

  it("are not offered, grantable or seeded", () => {
    const offered = PERMISSION_GROUPS.flatMap((group) =>
      group.permissions.map((permission) => permission.key),
    );
    for (const key of retired) {
      expect(offered).not.toContain(key);
      expect(ALL_PERMISSIONS).not.toContain(key);
      for (const role of DEFAULT_ROLES) expect(role.permissions).not.toContain(key);
    }
    expect(PERMISSION_GROUPS.map((group) => group.module)).not.toContain("Clinical AI");
  });

  it("fit in a role save that still carries them on a full-catalogue role", () => {
    const result = roleMutationSchema.safeParse({
      action: "updateRole",
      roleId: "role-1",
      permissions: [...ALL_PERMISSIONS, ...retired],
    });
    expect(result.success).toBe(true);
  });

  it("does not make unrelated strings known", () => {
    expect(isKnownPermission("clinical-ai:anything-else")).toBe(false);
  });

  it("removes the clinical_ai feature from the catalogue and module map", () => {
    expect(CATALOGUE_FEATURE_KEYS).not.toContain("clinical_ai");
    expect(Object.values(MODULE_FEATURES)).not.toContain("clinical_ai");
  });
});

// RM-2 retired the adjustable dashboard. Its keys are dropped (not kept) when a
// stored role is saved back.
describe("retired dashboard-layout permission keys (RM-2)", () => {
  it("are no longer in the catalogue", () => {
    for (const permission of RETIRED_PERMISSIONS) {
      expect(ALL_PERMISSIONS).not.toContain(permission);
      expect(isKnownPermission(permission)).toBe(false);
    }
  });

  it("are dropped, not rejected, when a stored role list is saved back", () => {
    const stored = ["patient:read", "dashboard:customize", "dashboard:layout:manage", "patient:read"];
    expect(withoutRetiredPermissions(stored)).toEqual(["patient:read", "patient:read"]);
    expect(createRoleSchema.parse({ name: "Front desk", permissions: stored }).permissions).toEqual(["patient:read"]);
    expect(updateRoleSchema.parse({ roleId: "role-1", permissions: stored }).permissions).toEqual(["patient:read"]);
  });
});

describe("a role saved before both RM-1 and RM-2", () => {
  it("still fits the save cap with every retired key it may hold", () => {
    const storedAdmin = [...ALL_PERMISSIONS, ...RETIRED_PERMISSION_KEYS, ...RETIRED_PERMISSIONS];
    const result = roleMutationSchema.safeParse({ action: "updateRole", roleId: "role-1", permissions: storedAdmin });
    expect(result.success).toBe(true);
    // RM-1 keys stay on the role; RM-2 keys are dropped.
    const saved = result.success && "permissions" in result.data ? result.data.permissions ?? [] : [];
    expect(saved).toEqual([...ALL_PERMISSIONS, ...RETIRED_PERMISSION_KEYS]);
  });
});
