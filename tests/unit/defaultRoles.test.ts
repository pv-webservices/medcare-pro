import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROLES,
  OWNER_ROLE_NAME,
  resolveRoleKeys,
  ROLE_KEYS,
} from "@/lib/defaultRoles";
import { ALL_PERMISSIONS, WILDCARD } from "@/lib/permissions";

describe("DEFAULT_ROLES", () => {
  it("keeps the three pre-Stage-1 roles, unrenamed and in place", () => {
    // Renaming any of these would orphan every existing tenant's rows: signup
    // resolves the Owner role by name, and the upsert key is (tenantId, name).
    expect(DEFAULT_ROLES.map((role) => role.name).slice(0, 3)).toEqual([
      "Owner",
      "Admin",
      "Staff",
    ]);
  });

  it("preserves Staff rights and adds only safe personal task access", () => {
    const staff = DEFAULT_ROLES.find((role) => role.name === "Staff");
    expect([...(staff?.permissions ?? [])]).toEqual([
      "clinic:read",
      "doctor:read",
      "patient:read",
      "patient:create",
      "patient:edit",
      "registration:read",
      "registration:create",
      "registration:edit",
      "dashboard:view",
      "dashboard:patients:view",
      "dashboard:tasks:view",
      "task:view",
      "task:complete",
    ]);
  });

  it("gives Owner the wildcard and nothing else", () => {
    const owner = DEFAULT_ROLES.find((role) => role.name === OWNER_ROLE_NAME);
    expect([...(owner?.permissions ?? [])]).toEqual([WILDCARD]);
    expect(owner?.key).toBe(ROLE_KEYS.OWNER);
  });

  it("gives Admin the whole catalogue, spelled out", () => {
    const admin = DEFAULT_ROLES.find((role) => role.name === "Admin");
    expect([...(admin?.permissions ?? [])]).toEqual([...ALL_PERMISSIONS]);
    expect(admin?.key).toBe(ROLE_KEYS.CLINIC_ADMIN);
  });

  it("uses a unique name and key per role", () => {
    const names = DEFAULT_ROLES.map((role) => role.name);
    const keys = DEFAULT_ROLES.map((role) => role.key);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("grants no seeded role a permission outside the catalogue", () => {
    for (const role of DEFAULT_ROLES) {
      for (const permission of role.permissions) {
        if (permission === WILDCARD) continue;
        expect(ALL_PERMISSIONS).toContain(permission);
      }
    }
  });

  it("keeps Doctor read-only and away from revenue", () => {
    const doctor = DEFAULT_ROLES.find((role) => role.name === "Doctor");
    expect(doctor?.permissions).not.toContain("report:read");
    expect(doctor?.permissions).not.toContain("registration:create");
    expect(doctor?.permissions).not.toContain("registration:edit");
    expect(doctor?.permissions).toContain("registration:read");
    expect(doctor?.permissions).toContain("dashboard:appointments:view");
    expect(doctor?.permissions).toContain("dashboard:patients:view");
    expect(doctor?.permissions).toContain("dashboard:schedule:view");
    expect(doctor?.permissions).toContain("dashboard:messages:view");
    expect(doctor?.permissions).not.toContain("dashboard:revenue:view");
    expect(doctor?.permissions).not.toContain("dashboard:team:view");
  });

  it("gives Receptionist the front desk's duties", () => {
    const receptionist = DEFAULT_ROLES.find((role) => role.name === "Receptionist");
    expect(receptionist?.permissions).toContain("registration:create");
    expect(receptionist?.permissions).toContain("message:send");
    expect(receptionist?.permissions).not.toContain("role:manage");
    expect(receptionist?.permissions).toContain("dashboard:appointments:view");
    expect(receptionist?.permissions).toContain("dashboard:patients:view");
    expect(receptionist?.permissions).toContain("dashboard:schedule:view");
    expect(receptionist?.permissions).toContain("dashboard:messages:view");
    expect(receptionist?.permissions).not.toContain("dashboard:revenue:view");
    expect(receptionist?.permissions).not.toContain("dashboard:team:view");
  });
});

describe("resolveRoleKeys", () => {
  const role = (id: string, name: string, permissions: string[]) => ({
    id,
    name,
    permissions,
  });

  it("keys the seeded set by name", () => {
    const keys = resolveRoleKeys([
      role("r1", "Owner", [WILDCARD]),
      role("r2", "Admin", [...ALL_PERMISSIONS]),
      role("r3", "Staff", ["clinic:read"]),
    ]);
    expect(keys.get("r1")).toBe(ROLE_KEYS.OWNER);
    expect(keys.get("r2")).toBe(ROLE_KEYS.CLINIC_ADMIN);
    expect(keys.get("r3")).toBe(ROLE_KEYS.STAFF);
  });

  it("anchors OWNER on the wildcard, not the name", () => {
    // A tenant can rename the Owner role through the editor while it goes on
    // holding "*". The wildcard is what lib/roles.ts already treats as the root.
    const keys = resolveRoleKeys([
      role("r1", "Practice Principal", [WILDCARD]),
      role("r2", "Admin", [...ALL_PERMISSIONS]),
    ]);
    expect(keys.get("r1")).toBe(ROLE_KEYS.OWNER);
  });

  it("prefers the role still called Owner when several hold the wildcard", () => {
    const keys = resolveRoleKeys([
      role("r9", "Superuser", [WILDCARD]),
      role("r1", "Owner", [WILDCARD]),
    ]);
    expect(keys.get("r1")).toBe(ROLE_KEYS.OWNER);
    expect(keys.get("r9")).toBeNull();
  });

  it("breaks a wildcard tie deterministically by id, so a re-run agrees", () => {
    const input = [
      role("rb", "Superuser", [WILDCARD]),
      role("ra", "Root", [WILDCARD]),
    ];
    expect(resolveRoleKeys(input).get("ra")).toBe(ROLE_KEYS.OWNER);
    expect(resolveRoleKeys([...input].reverse()).get("ra")).toBe(ROLE_KEYS.OWNER);
  });

  it("leaves custom roles unkeyed", () => {
    const keys = resolveRoleKeys([
      role("r1", "Owner", [WILDCARD]),
      role("r2", "Billing Clerk", ["registration:read"]),
    ]);
    expect(keys.get("r2")).toBeNull();
  });

  it("never assigns the same key twice, which would break the unique index", () => {
    // A tenant whose Owner role is renamed AND who has a second role called
    // "Owner" must not produce two OWNER keys.
    const keys = resolveRoleKeys([
      role("r1", "Owner", [WILDCARD]),
      role("r2", "Owner Deputy", [WILDCARD]),
    ]);
    const assigned = [...keys.values()].filter((key) => key !== null);
    expect(new Set(assigned).size).toBe(assigned.length);
  });

  it("returns an entry for every role it was given", () => {
    const keys = resolveRoleKeys([role("r1", "Anything", [])]);
    expect(keys.size).toBe(1);
    expect(keys.has("r1")).toBe(true);
  });

  it("handles a tenant with no wildcard holder at all", () => {
    const keys = resolveRoleKeys([role("r1", "Staff", ["clinic:read"])]);
    expect(keys.get("r1")).toBe(ROLE_KEYS.STAFF);
    expect([...keys.values()]).not.toContain(ROLE_KEYS.OWNER);
  });
});
