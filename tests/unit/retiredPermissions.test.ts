import { describe, expect, it, vi } from "vitest";

// roles.ts maps errors through apiHandler, which loads next/server; the
// schemas under test need none of it.
vi.mock("@/lib/apiHandler", () => ({
  BadRequestError: class extends Error {},
  ConflictError: class extends Error {},
}));
import {
  ALL_PERMISSIONS,
  RETIRED_PERMISSIONS,
  isKnownPermission,
  withoutRetiredPermissions,
} from "@/lib/permissions";
import { createRoleSchema, updateRoleSchema } from "@/lib/roles";

describe("retired permissions (RM-2)", () => {
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

  it("leave room for a full stored Admin list that still holds them", () => {
    const storedAdmin = [...ALL_PERMISSIONS, ...RETIRED_PERMISSIONS];
    expect(createRoleSchema.parse({ name: "Admin copy", permissions: storedAdmin }).permissions).toEqual([...ALL_PERMISSIONS]);
  });
});
