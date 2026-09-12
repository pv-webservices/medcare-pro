import { describe, expect, it } from "vitest";
import snapshots from "@/lib/prePrescriptionRoles.json";
import {
  planPrescriptionRoleMigration,
  PRE_PRESCRIPTION_ROLE_PERMISSIONS,
} from "@/lib/prescriptionRoleMigration";
import {
  PRE_DASHBOARD_ROLE_PERMISSIONS,
  PRE_TASK_ROLE_PERMISSIONS,
  PRE_DOCTOR_SELF_ROLE_PERMISSIONS,
  DEFAULT_ROLES,
} from "@/lib/defaultRoles";
import {
  STAGE_1_PERMISSIONS,
  PRE_STAGE_11_PERMISSIONS,
  PRE_APPOINTMENTS_PERMISSIONS,
  PRESCRIPTION_PERMISSIONS,
  PERMISSION_GROUPS,
} from "@/lib/permissions";
import { DEFAULT_FEATURES } from "@/lib/defaultFeatures";
import { MODULE_FEATURES } from "@/lib/moduleFeatures";
describe("EP safe role upgrade", () => {
  it.each(["DOCTOR", "CLINIC_ADMIN"])(
    "upgrades only exact current untouched %s snapshots",
    (key) => {
      const before = PRE_PRESCRIPTION_ROLE_PERMISSIONS[key];
      expect(
        planPrescriptionRoleMigration({
          key,
          isSystem: true,
          permissions: [...before].reverse(),
        }).status,
      ).toBe("ELIGIBLE");
      expect(
        planPrescriptionRoleMigration({
          key,
          isSystem: false,
          permissions: before,
        }).status,
      ).toBe("CUSTOMIZED_OR_OLDER");
      expect(
        planPrescriptionRoleMigration({
          key,
          isSystem: true,
          permissions: before.slice(1),
        }).status,
      ).toBe("CUSTOMIZED_OR_OLDER");
      expect(
        planPrescriptionRoleMigration({
          key,
          isSystem: true,
          permissions: [...before, "custom:right"],
        }).status,
      ).toBe("CUSTOMIZED_OR_OLDER");
    },
  );
  it("is idempotent", () =>
    expect(
      planPrescriptionRoleMigration({
        key: "DOCTOR",
        isSystem: true,
        permissions: DEFAULT_ROLES.find((r) => r.key === "DOCTOR")!.permissions,
      }).status,
    ).toBe("ALREADY_CURRENT"));
  it("does not target front desk or keyless custom roles", () => {
    for (const key of [null, "STAFF", "RECEPTIONIST", "OWNER"])
      expect(
        planPrescriptionRoleMigration({ key, isSystem: true, permissions: [] })
          .additions,
      ).toEqual([]);
  });
  it("never upgrades malformed permission JSON", () => {
    expect(
      planPrescriptionRoleMigration({
        key: "DOCTOR",
        isSystem: true,
        permissions: [...PRE_PRESCRIPTION_ROLE_PERMISSIONS.DOCTOR, 42],
      }).status,
    ).toBe("CUSTOMIZED_OR_OLDER");
    expect(
      planPrescriptionRoleMigration({
        key: "DOCTOR",
        isSystem: true,
        permissions: { grants: PRE_PRESCRIPTION_ROLE_PERMISSIONS.DOCTOR },
      }).status,
    ).toBe("CUSTOMIZED_OR_OLDER");
  });
  it("keeps every previous historical snapshot byte-equivalent as data", () => {
    expect(PRE_DASHBOARD_ROLE_PERMISSIONS).toEqual(
      snapshots.PRE_DASHBOARD_ROLE_PERMISSIONS,
    );
    expect(PRE_TASK_ROLE_PERMISSIONS).toEqual(
      snapshots.PRE_TASK_ROLE_PERMISSIONS,
    );
    expect(PRE_DOCTOR_SELF_ROLE_PERMISSIONS).toEqual(
      snapshots.PRE_DOCTOR_SELF_ROLE_PERMISSIONS,
    );
    expect(STAGE_1_PERMISSIONS).toEqual(snapshots.STAGE_1_PERMISSIONS);
    expect(PRE_STAGE_11_PERMISSIONS).toEqual(
      snapshots.PRE_STAGE_11_PERMISSIONS,
    );
    expect(PRE_APPOINTMENTS_PERMISSIONS).toEqual(
      snapshots.PRE_APPOINTMENTS_PERMISSIONS,
    );
  });
  it("catalogues real permissions and standard CORE entitlement", () => {
    expect(
      PERMISSION_GROUPS.find(
        (group) => group.module === "Prescriptions",
      )!.permissions.map((p) => p.key),
    ).toEqual(PRESCRIPTION_PERMISSIONS);
    expect(
      DEFAULT_FEATURES.find((f) => f.key === MODULE_FEATURES.prescriptions),
    ).toMatchObject({ tier: "CORE", inDefaultPlan: true });
  });
  it("does not seed receptionist issuance or Doctor cancellation", () => {
    expect(
      DEFAULT_ROLES.find((r) => r.key === "RECEPTIONIST")!.permissions,
    ).not.toContain("prescription:issue");
    expect(
      DEFAULT_ROLES.find((r) => r.key === "DOCTOR")!.permissions,
    ).not.toContain("prescription:cancel");
  });
});
