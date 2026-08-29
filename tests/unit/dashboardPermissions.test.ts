import { describe, expect, it } from "vitest";
import { resolveAdminDashboardClinicAccess } from "@/lib/adminDashboardScope";
import { DEFAULT_ROLES, ROLE_KEYS } from "@/lib/defaultRoles";
import {
  ACTION_PERMISSION_GROUPS,
  DASHBOARD_DATA_PERMISSIONS,
  DASHBOARD_PERMISSION_GROUP,
} from "@/lib/permissions";
import type { ClinicScope } from "@/lib/rbac";

const clinics = [
  { id: "clinic-a", name: "Clinic A" },
  { id: "clinic-b", name: "Clinic B" },
];

function scopes(values: Record<string, ClinicScope>): Map<string, ClinicScope> {
  return new Map(Object.entries(values));
}

function rolePermissions(key: (typeof ROLE_KEYS)[keyof typeof ROLE_KEYS]) {
  return DEFAULT_ROLES.find((role) => role.key === key)?.permissions ?? [];
}

describe("dashboard permission catalogue", () => {
  it("keeps Dashboard Data separate from Assigned Rights", () => {
    expect(DASHBOARD_PERMISSION_GROUP.permissions.map((item) => item.key)).toEqual(
      DASHBOARD_DATA_PERMISSIONS,
    );
    for (const group of ACTION_PERMISSION_GROUPS) {
      for (const permission of group.permissions) {
        expect(permission.key.startsWith("dashboard:")).toBe(false);
      }
    }
  });

  it("gives the seeded roles the intended dashboard defaults", () => {
    expect(rolePermissions(ROLE_KEYS.OWNER)).toEqual(["*"]);
    expect(rolePermissions(ROLE_KEYS.CLINIC_ADMIN)).toEqual(
      expect.arrayContaining([...DASHBOARD_DATA_PERMISSIONS]),
    );
    expect(rolePermissions(ROLE_KEYS.RECEPTIONIST)).toEqual(
      expect.arrayContaining([
        "dashboard:view",
        "dashboard:appointments:view",
        "dashboard:registrations:view",
        "dashboard:notifications:view",
      ]),
    );
    expect(rolePermissions(ROLE_KEYS.DOCTOR)).not.toContain("dashboard:revenue:view");
    expect(rolePermissions(ROLE_KEYS.STAFF)).toEqual(
      expect.arrayContaining(["dashboard:view", "dashboard:registrations:view"]),
    );
  });
});

describe("dashboard and action scope separation", () => {
  it("lets an owner wildcard resolve every requested right across all clinics", () => {
    const all = Object.fromEntries(
      [
        ...DASHBOARD_DATA_PERMISSIONS,
        "appointment:create",
        "registration:create",
        "doctor:create",
        "team:manage",
        "role:manage",
      ].map((permission) => [permission, { scope: "all" } as const]),
    );
    const access = resolveAdminDashboardClinicAccess(scopes(all), clinics, null);

    expect(access.dashboard["dashboard:revenue:view"]).toEqual([
      "clinic-a",
      "clinic-b",
    ]);
    expect(access.actions["appointment:create"]).toEqual([
      "clinic-a",
      "clinic-b",
    ]);
  });

  it("keeps create authority when appointment dashboard data is absent", () => {
    const access = resolveAdminDashboardClinicAccess(
      scopes({
        "dashboard:view": { scope: "clinics", clinicIds: ["clinic-a"] },
        "appointment:create": { scope: "clinics", clinicIds: ["clinic-a"] },
      }),
      clinics,
      null,
    );

    expect(access.actions["appointment:create"]).toEqual(["clinic-a"]);
    expect(access.dashboard["dashboard:appointments:view"]).toEqual([]);
  });

  it("shows appointment analytics without granting the create action", () => {
    const access = resolveAdminDashboardClinicAccess(
      scopes({
        "dashboard:view": { scope: "clinics", clinicIds: ["clinic-a"] },
        "dashboard:appointments:view": {
          scope: "clinics",
          clinicIds: ["clinic-a"],
        },
      }),
      clinics,
      null,
    );

    expect(access.dashboard["dashboard:appointments:view"]).toEqual(["clinic-a"]);
    expect(access.actions["appointment:create"]).toEqual([]);
  });

  it("requires the dashboard master right in the same clinic", () => {
    const access = resolveAdminDashboardClinicAccess(
      scopes({
        "dashboard:view": { scope: "clinics", clinicIds: ["clinic-a"] },
        "dashboard:appointments:view": {
          scope: "clinics",
          clinicIds: ["clinic-b"],
        },
      }),
      clinics,
      null,
    );

    expect(access.dashboard["dashboard:appointments:view"]).toEqual([]);
  });

  it("returns no dashboard or action data for a selected clinic outside scope", () => {
    const access = resolveAdminDashboardClinicAccess(
      scopes({
        "dashboard:view": { scope: "clinics", clinicIds: ["clinic-a"] },
        "dashboard:appointments:view": {
          scope: "clinics",
          clinicIds: ["clinic-a"],
        },
        "appointment:create": { scope: "clinics", clinicIds: ["clinic-a"] },
      }),
      clinics,
      "clinic-b",
    );

    expect(access.dashboard["dashboard:appointments:view"]).toEqual([]);
    expect(access.actions["appointment:create"]).toEqual([]);
  });
});
