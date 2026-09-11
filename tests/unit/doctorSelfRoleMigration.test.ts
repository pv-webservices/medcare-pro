import { describe, expect, it } from "vitest";
import {
  KNOWN_PRE_DOCTOR_SELF_DOCTOR_PERMISSION_SETS,
  planDoctorSelfRoleMigration,
} from "@/lib/doctorSelfRoleMigration";
import {
  DEFAULT_ROLES,
  PRE_DOCTOR_SELF_ROLE_PERMISSIONS,
  ROLE_KEYS,
} from "@/lib/defaultRoles";

const rolePermissions = (key: string): readonly string[] =>
  DEFAULT_ROLES.find((role) => role.key === key)?.permissions ?? [];

const planDoctor = (
  permissions: readonly string[],
  isSystem = true,
) =>
  planDoctorSelfRoleMigration({
    key: ROLE_KEYS.DOCTOR,
    isSystem,
    permissions,
  });

describe("historical Doctor self-read role migration", () => {
  it("classifies a current Doctor role as already current", () => {
    const plan = planDoctor(["appointment:self:read"]);
    expect(plan.action).toBe("ALREADY_CURRENT");
    expect(plan.nextPermissions).toEqual(["appointment:self:read"]);
  });

  it("migrates the immediate pre-doctor-self snapshot", () => {
    const before = PRE_DOCTOR_SELF_ROLE_PERMISSIONS[ROLE_KEYS.DOCTOR]!;
    const plan = planDoctor(before);
    expect(plan.action).toBe("MIGRATE");
    expect(plan.classification).toBe("KNOWN_PRE_DOCTOR_SELF");
    expect(plan.nextPermissions).toContain("appointment:self:read");
    expect(plan.nextPermissions).not.toContain("appointment:read");
  });

  it("migrates an older post-appointments seeded snapshot", () => {
    const snapshot = KNOWN_PRE_DOCTOR_SELF_DOCTOR_PERMISSION_SETS.find(
      (entry) => entry.classification === "KNOWN_POST_APPOINTMENTS",
    )!;
    const plan = planDoctor(snapshot.permissions);
    expect(plan.action).toBe("MIGRATE");
    expect(plan.classification).toBe("KNOWN_POST_APPOINTMENTS");
    expect(plan.nextPermissions).toEqual(
      snapshot.permissions.map((permission) =>
        permission === "appointment:read"
          ? "appointment:self:read"
          : permission,
      ),
    );
  });

  it("migrates the known post-tasks seeded snapshot", () => {
    const snapshot = KNOWN_PRE_DOCTOR_SELF_DOCTOR_PERMISSION_SETS.find(
      (entry) => entry.classification === "KNOWN_POST_TASKS",
    )!;
    const plan = planDoctor(snapshot.permissions);
    expect(plan.action).toBe("MIGRATE");
    expect(plan.classification).toBe("KNOWN_POST_TASKS");
    expect(
      plan.nextPermissions.filter(
        (permission) => !permission.startsWith("appointment:"),
      ),
    ).toEqual(
      snapshot.permissions.filter(
        (permission) => !permission.startsWith("appointment:"),
      ),
    );
  });

  it("migrates the proven 11-permission partial dashboard rollout", () => {
    const snapshot = KNOWN_PRE_DOCTOR_SELF_DOCTOR_PERMISSION_SETS.find(
      (entry) =>
        entry.classification === "KNOWN_PARTIAL_DASHBOARD_ROLLOUT",
    )!;
    expect(new Set(snapshot.permissions).size).toBe(11);
    const plan = planDoctor(snapshot.permissions);
    expect(plan.action).toBe("MIGRATE");
    expect(plan.classification).toBe("KNOWN_PARTIAL_DASHBOARD_ROLLOUT");
    expect(plan.nextPermissions).not.toContain("appointment:read");
    expect(plan.nextPermissions).toContain("appointment:self:read");
  });

  it("recognizes every proven broad-read snapshot as migratable", () => {
    for (const snapshot of KNOWN_PRE_DOCTOR_SELF_DOCTOR_PERMISSION_SETS) {
      const plan = planDoctor(snapshot.permissions);
      expect(plan.classification).toBe(snapshot.classification);
      expect(plan.action).toBe(
        snapshot.safeToAutoMigrate ? "MIGRATE" : "SKIP",
      );
    }
  });

  it("does not grant appointment access to the known pre-appointments state", () => {
    const snapshot = KNOWN_PRE_DOCTOR_SELF_DOCTOR_PERMISSION_SETS.find(
      (entry) => entry.classification === "KNOWN_PRE_APPOINTMENTS",
    )!;
    const plan = planDoctor(snapshot.permissions);
    expect(plan.action).toBe("SKIP");
    expect(plan.nextPermissions).toEqual(snapshot.permissions);
  });

  it("skips a known snapshot with a custom permission added", () => {
    const before = PRE_DOCTOR_SELF_ROLE_PERMISSIONS[ROLE_KEYS.DOCTOR]!;
    const permissions = [...before, "custom:permission"];
    const plan = planDoctor(permissions);
    expect(plan.action).toBe("SKIP");
    expect(plan.classification).toBe("CUSTOMIZED");
    expect(plan.nextPermissions).toEqual(permissions);
  });

  it("skips a known snapshot with a historical permission removed", () => {
    const before = PRE_DOCTOR_SELF_ROLE_PERMISSIONS[ROLE_KEYS.DOCTOR]!;
    const permissions = before.filter(
      (permission) => permission !== "patient:read",
    );
    const plan = planDoctor(permissions);
    expect(plan.action).toBe("SKIP");
    expect(plan.classification).toBe("CUSTOMIZED");
    expect(plan.nextPermissions).toEqual(permissions);
  });

  it("skips a non-system Doctor role", () => {
    const before = PRE_DOCTOR_SELF_ROLE_PERMISSIONS[ROLE_KEYS.DOCTOR]!;
    const plan = planDoctor(before, false);
    expect(plan.action).toBe("SKIP");
    expect(plan.classification).toBe("NON_SYSTEM_ROLE");
    expect(plan.nextPermissions).toEqual(before);
  });

  it("adds self read to an untouched Admin without removing broad read", () => {
    const before = PRE_DOCTOR_SELF_ROLE_PERMISSIONS[ROLE_KEYS.CLINIC_ADMIN]!;
    const plan = planDoctorSelfRoleMigration({
      key: ROLE_KEYS.CLINIC_ADMIN,
      isSystem: true,
      permissions: before,
    });
    expect(plan.action).toBe("MIGRATE");
    expect(plan.nextPermissions).toContain("appointment:read");
    expect(plan.nextPermissions).toContain("appointment:self:read");
  });

  it("does not target Receptionist or Owner", () => {
    for (const key of [ROLE_KEYS.RECEPTIONIST, ROLE_KEYS.OWNER]) {
      const permissions = rolePermissions(key);
      const plan = planDoctorSelfRoleMigration({
        key,
        isSystem: true,
        permissions,
      });
      expect(plan.action).toBe("SKIP");
      expect(plan.classification).toBe("NOT_TARGETED");
      expect(plan.nextPermissions).toEqual(permissions);
    }
  });

  it("is idempotent after a migration", () => {
    const before = PRE_DOCTOR_SELF_ROLE_PERMISSIONS[ROLE_KEYS.DOCTOR]!;
    const first = planDoctor(before);
    const second = planDoctor(first.nextPermissions);
    expect(first.action).toBe("MIGRATE");
    expect(second.action).toBe("ALREADY_CURRENT");
    expect(second.nextPermissions).toEqual(first.nextPermissions);
  });

  it("requires review when broad and self read coexist outside a known state", () => {
    const permissions = [
      ...PRE_DOCTOR_SELF_ROLE_PERMISSIONS[ROLE_KEYS.DOCTOR]!,
      "appointment:self:read",
    ];
    const plan = planDoctor(permissions);
    expect(plan.action).toBe("SKIP");
    expect(plan.classification).toBe("CUSTOMIZED");
    expect(plan.nextPermissions).toEqual(permissions);
  });
});
