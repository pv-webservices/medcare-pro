import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROLES,
  PRE_TASK_ROLE_PERMISSIONS,
  ROLE_KEYS,
  TASK_ROLE_TOP_UPS,
  isUntouchedPreTaskRole,
} from "@/lib/defaultRoles";
import { DASHBOARD_DATA_PERMISSIONS, TASK_PERMISSIONS } from "@/lib/permissions";
import { NAV_LINKS, visibleNavLinks } from "@/lib/navigation";
import { MODULE_FEATURES } from "@/lib/moduleFeatures";

function permissions(key: (typeof ROLE_KEYS)[keyof typeof ROLE_KEYS]) {
  return DEFAULT_ROLES.find((role) => role.key === key)!.permissions;
}

describe("task permission catalogue and defaults", () => {
  it("lists every task action and its separate dashboard summary right", () => {
    expect(TASK_PERMISSIONS).toEqual([
      "task:view", "task:create", "task:assign", "task:update", "task:complete", "task:delete", "task:manage",
    ]);
    expect(DASHBOARD_DATA_PERMISSIONS).toContain("dashboard:tasks:view");
  });

  it("gives admin full task management and safe lower-role defaults", () => {
    expect(permissions(ROLE_KEYS.CLINIC_ADMIN)).toEqual(expect.arrayContaining([...TASK_PERMISSIONS, "dashboard:tasks:view"]));
    expect(permissions(ROLE_KEYS.DOCTOR)).toEqual(expect.arrayContaining(["task:view", "task:create", "task:complete"]));
    expect(permissions(ROLE_KEYS.RECEPTIONIST)).toEqual(expect.arrayContaining(["task:view", "task:create", "task:complete"]));
    expect(permissions(ROLE_KEYS.STAFF)).toEqual(expect.arrayContaining(["task:view", "task:complete"]));
    expect(permissions(ROLE_KEYS.DOCTOR)).not.toContain("task:assign");
    expect(permissions(ROLE_KEYS.RECEPTIONIST)).not.toContain("task:assign");
    expect(permissions(ROLE_KEYS.STAFF)).not.toContain("task:assign");
  });

  it("tops up only the task stage and recognises untouched snapshots", () => {
    for (const role of DEFAULT_ROLES) {
      expect(isUntouchedPreTaskRole(role.key, PRE_TASK_ROLE_PERMISSIONS[role.key])).toBe(true);
    }
    for (const additions of Object.values(TASK_ROLE_TOP_UPS)) {
      for (const permission of additions ?? []) {
        expect([...TASK_PERMISSIONS, "dashboard:tasks:view"]).toContain(permission);
      }
    }
  });
});

describe("task navigation and entitlement", () => {
  it("gates the Tasks tab by permission and the tasks feature", () => {
    const taskLink = NAV_LINKS.find((link) => link.href === "/tasks");
    expect(taskLink?.feature).toBe(MODULE_FEATURES.tasks);
    expect(visibleNavLinks(() => false, () => true).some((link) => link.href === "/tasks")).toBe(false);
    expect(visibleNavLinks((permission) => permission === "task:view", () => true).some((link) => link.href === "/tasks")).toBe(true);
    expect(visibleNavLinks((permission) => permission === "task:manage", () => false).some((link) => link.href === "/tasks")).toBe(false);
  });
});

