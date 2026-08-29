import { describe, expect, it } from "vitest";
import { mayManageRoleDashboardDefault } from "@/lib/dashboardLayoutAuthority";

describe("role dashboard default authority", () => {
  it("lets an owner configure a lower role but never the protected owner role", () => {
    expect(mayManageRoleDashboardDefault({ actorPermissions: new Set(["*"]), targetPermissions: ["dashboard:view"] })).toBe(true);
    expect(mayManageRoleDashboardDefault({ actorPermissions: new Set(["*"]), targetPermissions: ["*"] })).toBe(false);
  });

  it("lets an authorized admin configure only a strict permission subset", () => {
    const admin = new Set(["dashboard:layout:manage", "dashboard:customize", "dashboard:view", "dashboard:patients:view"]);
    expect(mayManageRoleDashboardDefault({ actorPermissions: admin, targetPermissions: ["dashboard:customize", "dashboard:view"] })).toBe(true);
    expect(mayManageRoleDashboardDefault({ actorPermissions: admin, targetPermissions: [...admin] })).toBe(false);
  });

  it("rejects higher or incomparable target authority", () => {
    expect(mayManageRoleDashboardDefault({ actorPermissions: new Set(["dashboard:layout:manage", "dashboard:view"]), targetPermissions: ["dashboard:view", "dashboard:revenue:view"] })).toBe(false);
    expect(mayManageRoleDashboardDefault({ actorPermissions: new Set(["dashboard:customize", "dashboard:view"]), targetPermissions: ["dashboard:layout:manage", "dashboard:view"] })).toBe(false);
  });
});
