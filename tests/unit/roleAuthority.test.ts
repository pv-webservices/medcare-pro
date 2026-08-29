import { describe, expect, it } from "vitest";
import { evaluateRoleGrantAuthority } from "@/lib/roleAuthority";

describe("role assignment authority", () => {
  it("reserves tenant-wide assignment for the account owner", () => {
    expect(
      evaluateRoleGrantAuthority({
        actorPermissions: new Set(["role:manage", "appointment:create"]),
        targetPermissions: ["appointment:create"],
        isAccountOwner: false,
        tenantWide: true,
      }),
    ).toBe("tenant-wide-owner-only");
  });

  it("reserves wildcard roles for the account owner", () => {
    expect(
      evaluateRoleGrantAuthority({
        actorPermissions: new Set(["role:manage"]),
        targetPermissions: ["*"],
        isAccountOwner: false,
        tenantWide: false,
      }),
    ).toBe("owner-role-owner-only");
  });

  it("allows a clinic admin to assign a strict permission subset", () => {
    expect(
      evaluateRoleGrantAuthority({
        actorPermissions: new Set([
          "role:manage",
          "appointment:create",
          "dashboard:appointments:view",
        ]),
        targetPermissions: [
          "appointment:create",
          "dashboard:appointments:view",
        ],
        isAccountOwner: false,
        tenantWide: false,
      }),
    ).toBeNull();
  });

  it("rejects a role with a permission the actor does not hold", () => {
    expect(
      evaluateRoleGrantAuthority({
        actorPermissions: new Set(["role:manage", "appointment:create"]),
        targetPermissions: ["dashboard:revenue:view"],
        isAccountOwner: false,
        tenantWide: false,
      }),
    ).toBe("beyond-actor-permissions");
  });

  it("rejects an equal-authority role for a non-owner", () => {
    expect(
      evaluateRoleGrantAuthority({
        actorPermissions: new Set(["role:manage", "appointment:create"]),
        targetPermissions: ["role:manage", "appointment:create"],
        isAccountOwner: false,
        tenantWide: false,
      }),
    ).toBe("not-below-actor-authority");
  });

  it("lets the account owner assign owner and tenant-wide roles", () => {
    expect(
      evaluateRoleGrantAuthority({
        actorPermissions: new Set(["*"]),
        targetPermissions: ["*"],
        isAccountOwner: true,
        tenantWide: true,
      }),
    ).toBeNull();
  });
});
