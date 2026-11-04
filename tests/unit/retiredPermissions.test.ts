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
} from "@/lib/permissions";
import { DEFAULT_ROLES } from "@/lib/defaultRoles";
import { CATALOGUE_FEATURE_KEYS, MODULE_FEATURES } from "@/lib/moduleFeatures";
import { roleMutationSchema } from "@/lib/roles";

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
    // Worst case: a role stored before RM-1 and RM-2 holds both retired sets.
    const result = roleMutationSchema.safeParse({
      action: "updateRole",
      roleId: "role-1",
      permissions: [...ALL_PERMISSIONS, ...retired, ...RETIRED_PERMISSIONS],
    });
    expect(result.success).toBe(true);
    // RM-1 keys are kept on the role (option A); RM-2 keys are dropped.
    const saved = result.success && result.data.action === "updateRole" ? result.data.permissions ?? [] : [];
    for (const key of retired) expect(saved).toContain(key);
    for (const key of RETIRED_PERMISSIONS) expect(saved).not.toContain(key);
  });

  it("does not make unrelated strings known", () => {
    expect(isKnownPermission("clinical-ai:anything-else")).toBe(false);
  });

  it("removes the clinical_ai feature from the catalogue and module map", () => {
    expect(CATALOGUE_FEATURE_KEYS).not.toContain("clinical_ai");
    expect(Object.values(MODULE_FEATURES)).not.toContain("clinical_ai");
  });
});
