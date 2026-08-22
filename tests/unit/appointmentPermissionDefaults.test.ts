import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSIONS,
  HISTORICAL_ALL_PERMISSIONS,
  PERMISSION_GROUPS,
  PRE_APPOINTMENTS_PERMISSIONS,
  PRE_STAGE_11_PERMISSIONS,
  STAGE_1_PERMISSIONS,
  STAGE_11_PERMISSIONS,
  STAGE_AP1_PERMISSIONS,
  WILDCARD,
  findPermission,
  isKnownPermission,
  isUntouchedPreAppointmentsAdminSet,
  isUntouchedPreStage11AdminSet,
} from "@/lib/permissions";
import {
  APPOINTMENT_ROLE_TOP_UPS,
  DEFAULT_ROLES,
  PRE_APPOINTMENTS_ROLE_PERMISSIONS,
  ROLE_KEYS,
  isUntouchedPreAppointmentsRole,
  type RoleKey,
} from "@/lib/defaultRoles";

/**
 * The appointment keys a call site actually checks today.
 *
 *   appointment:read         — AP-2's getAppointmentSlots, and AP-3's
 *                              listAppointments and listAppointmentTypes.
 *   appointment:create       — AP-3's createAppointment.
 *   appointment:type:manage  — AP-3's create/updateAppointmentType.
 *
 * AP-4 adds update/reschedule/cancel/checkin and AP-5 adds convert; each stage
 * appends its key here as it builds the gate.
 */
const ENFORCED_APPOINTMENT_PERMISSIONS: readonly string[] = [
  "appointment:read",
  "appointment:create",
  "appointment:type:manage",
];

const permissionsFor = (key: RoleKey): readonly string[] => {
  const role = DEFAULT_ROLES.find((entry) => entry.key === key);
  if (!role) throw new Error(`No seeded role keyed ${key}`);
  return role.permissions;
};

describe("the AP-1 permission keys", () => {
  it("is exactly the eight appointment keys", () => {
    expect([...STAGE_AP1_PERMISSIONS]).toEqual([
      "appointment:read",
      "appointment:create",
      "appointment:update",
      "appointment:reschedule",
      "appointment:cancel",
      "appointment:checkin",
      "appointment:convert",
      "appointment:type:manage",
    ]);
  });

  it("lists every key the Appointments group defines, and only those", () => {
    // Hand-listed, so this is what stops it drifting from the catalogue.
    const group = PERMISSION_GROUPS.find((g) => g.module === "Appointments");
    expect(group).toBeDefined();
    expect(group?.permissions.map((p) => p.key).sort()).toEqual(
      [...STAGE_AP1_PERMISSIONS].sort(),
    );
  });

  it("is in the live catalogue", () => {
    for (const permission of STAGE_AP1_PERMISSIONS) {
      expect(isKnownPermission(permission)).toBe(true);
    }
  });

  it("follows the colon naming convention", () => {
    // `appointment:checkin`, never `appointment:check-in` — the roles editor
    // and lib/rbac.ts both match these strings exactly.
    for (const permission of STAGE_AP1_PERMISSIONS) {
      expect(permission).toMatch(/^[a-z]+(?::[a-z]+)+$/);
    }
  });

  it("marks a key pending until the stage that enforces it has landed", () => {
    // This file's own rule, in both directions: a string nothing checks grants
    // nothing, and saying otherwise on the roles screen is a false promise of
    // protection — but a key that HAS gained a call site must lose the mark, or
    // the same screen starts understating what a role can do.
    //
    // The list below is therefore the record of which appointment keys are
    // actually enforced, and it grows as AP-4 and AP-5 build their gates.
    for (const permission of STAGE_AP1_PERMISSIONS) {
      const definition = findPermission(permission);

      if (ENFORCED_APPOINTMENT_PERMISSIONS.includes(permission)) {
        continue;
      }

      expect(definition?.pending).toBe("stage");
      expect(definition?.pendingNote).toBeTruthy();
    }
  });

  it("has dropped the mark from every key that is now enforced", () => {
    for (const permission of ENFORCED_APPOINTMENT_PERMISSIONS) {
      expect(STAGE_AP1_PERMISSIONS).toContain(permission);
      const definition = findPermission(permission);
      expect(definition?.pending).toBeUndefined();
      expect(definition?.pendingNote).toBeUndefined();
    }
  });

  it("still has AP-4 and AP-5 waiting", () => {
    // Stated as behaviour rather than left implicit, so that enforcing one of
    // these without clearing its mark — or clearing a mark without building the
    // gate — fails here.
    expect(
      STAGE_AP1_PERMISSIONS.filter(
        (permission) => !ENFORCED_APPOINTMENT_PERMISSIONS.includes(permission),
      ),
    ).toEqual([
      "appointment:update",
      "appointment:reschedule",
      "appointment:cancel",
      "appointment:checkin",
      "appointment:convert",
    ]);
  });
});

describe("the stage sets stay disjoint", () => {
  it("shares no key with the pre-Stage-1 twenty", () => {
    for (const permission of STAGE_AP1_PERMISSIONS) {
      expect(HISTORICAL_ALL_PERMISSIONS).not.toContain(permission);
    }
  });

  it("shares no key with Stage 11", () => {
    for (const permission of STAGE_AP1_PERMISSIONS) {
      expect(STAGE_11_PERMISSIONS).not.toContain(permission);
    }
  });

  it("is subtracted from STAGE_1_PERMISSIONS", () => {
    // Otherwise scripts/backfill-stage1.mts would start handing out appointment
    // permissions under Stage 1's name.
    for (const permission of STAGE_AP1_PERMISSIONS) {
      expect(STAGE_1_PERMISSIONS).not.toContain(permission);
    }
  });

  it("leaves STAGE_1_PERMISSIONS at exactly the twelve keys it always had", () => {
    // The twelve are named exactly once, in permissions.test.ts. Restating the
    // literal here would just be a second copy to keep in step; what AP-1 needs
    // to prove is that its own subtraction changed neither the count nor the
    // contents of a list a live backfill script still appends.
    expect(STAGE_1_PERMISSIONS.length).toBe(12);
    expect(
      STAGE_1_PERMISSIONS.every((permission) =>
        permission.startsWith("appointment:") ? false : true,
      ),
    ).toBe(true);
  });

  it("is subtracted from PRE_STAGE_11_PERMISSIONS", () => {
    // The subtlest of the three. isUntouchedPreStage11AdminSet compares by
    // EXACT SET EQUALITY, and a pre-Stage-11 Admin holds no appointment keys
    // either. Leave them in and that comparison never matches again, so the
    // Stage 11 backfill silently stops handing out audit:read to the
    // organisations still owed it. Nothing fails; it just does nothing.
    for (const permission of STAGE_AP1_PERMISSIONS) {
      expect(PRE_STAGE_11_PERMISSIONS).not.toContain(permission);
    }
  });

  it("still recognises a genuine pre-Stage-11 Admin", () => {
    // The regression the test above guards against, stated as behaviour.
    const preStage11Admin = ALL_PERMISSIONS.filter(
      (permission) =>
        !STAGE_11_PERMISSIONS.includes(permission) &&
        !STAGE_AP1_PERMISSIONS.includes(permission),
    );
    expect(isUntouchedPreStage11AdminSet(preStage11Admin)).toBe(true);
  });
});

describe("PRE_APPOINTMENTS_PERMISSIONS", () => {
  it("is the whole catalogue minus what AP-1 added", () => {
    expect(PRE_APPOINTMENTS_PERMISSIONS.length).toBe(
      ALL_PERMISSIONS.length - STAGE_AP1_PERMISSIONS.length,
    );
    for (const permission of STAGE_AP1_PERMISSIONS) {
      expect(PRE_APPOINTMENTS_PERMISSIONS).not.toContain(permission);
    }
  });

  it("still contains audit:read, which Stage 11 had already added", () => {
    // AP-1 comes after Stage 11, so the pre-AP-1 Admin holds it.
    expect(PRE_APPOINTMENTS_PERMISSIONS).toContain("audit:read");
  });
});

describe("isUntouchedPreAppointmentsAdminSet", () => {
  it("matches the pre-AP-1 catalogue exactly", () => {
    expect(isUntouchedPreAppointmentsAdminSet(PRE_APPOINTMENTS_PERMISSIONS)).toBe(
      true,
    );
  });

  it("is order-insensitive and duplicate-tolerant", () => {
    // The roles editor dedupes and does not preserve catalogue order, so a
    // byte comparison would report false negatives on untouched roles.
    const shuffled = [...PRE_APPOINTMENTS_PERMISSIONS].reverse();
    expect(isUntouchedPreAppointmentsAdminSet(shuffled)).toBe(true);
    expect(
      isUntouchedPreAppointmentsAdminSet([
        ...PRE_APPOINTMENTS_PERMISSIONS,
        "audit:read",
      ]),
    ).toBe(true);
  });

  it("refuses a role with one key added", () => {
    expect(
      isUntouchedPreAppointmentsAdminSet([
        ...PRE_APPOINTMENTS_PERMISSIONS,
        "appointment:read",
      ]),
    ).toBe(false);
  });

  it("refuses a role with one key removed", () => {
    expect(
      isUntouchedPreAppointmentsAdminSet(
        PRE_APPOINTMENTS_PERMISSIONS.slice(1),
      ),
    ).toBe(false);
  });

  it("refuses an Admin still stuck at an earlier rung", () => {
    // Topping these up would leave them in a state no seed ever produced.
    // Run the backfills in order: stage1, stage11, then AP-1.
    expect(isUntouchedPreAppointmentsAdminSet(HISTORICAL_ALL_PERMISSIONS)).toBe(
      false,
    );
    expect(isUntouchedPreAppointmentsAdminSet(PRE_STAGE_11_PERMISSIONS)).toBe(
      false,
    );
  });
});

describe("what each seeded role holds after AP-1", () => {
  it("gives Owner everything through the wildcard, and nothing spelled out", () => {
    expect(permissionsFor(ROLE_KEYS.OWNER)).toEqual([WILDCARD]);
  });

  it("gives Admin all eight, because it holds the whole catalogue", () => {
    for (const permission of STAGE_AP1_PERMISSIONS) {
      expect(permissionsFor(ROLE_KEYS.CLINIC_ADMIN)).toContain(permission);
    }
  });

  it("gives Receptionist the whole booking desk", () => {
    const held = permissionsFor(ROLE_KEYS.RECEPTIONIST);
    for (const permission of [
      "appointment:read",
      "appointment:create",
      "appointment:update",
      "appointment:reschedule",
      "appointment:cancel",
      "appointment:checkin",
      "appointment:convert",
    ]) {
      expect(held).toContain(permission);
    }
  });

  it("does not let Receptionist set the price list", () => {
    // Taking bookings is not the same as deciding what a consultation costs.
    expect(permissionsFor(ROLE_KEYS.RECEPTIONIST)).not.toContain(
      "appointment:type:manage",
    );
  });

  it("gives Doctor read access and nothing more", () => {
    const held = permissionsFor(ROLE_KEYS.DOCTOR);
    expect(held).toContain("appointment:read");
    for (const permission of STAGE_AP1_PERMISSIONS) {
      if (permission === "appointment:read") continue;
      expect(held).not.toContain(permission);
    }
  });

  it("leaves Staff with no appointment permissions at all", () => {
    const held = permissionsFor(ROLE_KEYS.STAFF);
    for (const permission of STAGE_AP1_PERMISSIONS) {
      expect(held).not.toContain(permission);
    }
  });

  it("leaves Staff byte-for-byte as it was before AP-1", () => {
    expect([...permissionsFor(ROLE_KEYS.STAFF)]).toEqual([
      ...PRE_APPOINTMENTS_ROLE_PERMISSIONS[ROLE_KEYS.STAFF],
    ]);
  });
});

describe("the frozen pre-AP-1 role snapshots", () => {
  it("covers every seeded role", () => {
    for (const role of DEFAULT_ROLES) {
      expect(PRE_APPOINTMENTS_ROLE_PERMISSIONS[role.key]).toBeDefined();
    }
  });

  it("names only permissions that existed before AP-1", () => {
    for (const key of Object.values(ROLE_KEYS)) {
      for (const permission of PRE_APPOINTMENTS_ROLE_PERMISSIONS[key]) {
        if (permission === WILDCARD) continue;
        expect(PRE_APPOINTMENTS_PERMISSIONS).toContain(permission);
      }
    }
  });

  it("is a subset of what the role holds today", () => {
    // AP-1 only ever APPENDS. A snapshot naming something the live role has
    // dropped would mean a role was re-scoped, which existing tenants grant.
    for (const role of DEFAULT_ROLES) {
      const held = new Set(role.permissions);
      for (const permission of PRE_APPOINTMENTS_ROLE_PERMISSIONS[role.key]) {
        expect(held.has(permission)).toBe(true);
      }
    }
  });

  it("recognises an untouched seeded role", () => {
    for (const key of Object.values(ROLE_KEYS)) {
      expect(
        isUntouchedPreAppointmentsRole(
          key,
          PRE_APPOINTMENTS_ROLE_PERMISSIONS[key],
        ),
      ).toBe(true);
    }
  });

  it("refuses a role with one key added or removed", () => {
    const before = PRE_APPOINTMENTS_ROLE_PERMISSIONS[ROLE_KEYS.RECEPTIONIST];
    expect(
      isUntouchedPreAppointmentsRole(ROLE_KEYS.RECEPTIONIST, [
        ...before,
        "report:read",
      ]),
    ).toBe(false);
    expect(
      isUntouchedPreAppointmentsRole(ROLE_KEYS.RECEPTIONIST, before.slice(1)),
    ).toBe(false);
  });

  it("is order-insensitive", () => {
    const before = PRE_APPOINTMENTS_ROLE_PERMISSIONS[ROLE_KEYS.DOCTOR];
    expect(
      isUntouchedPreAppointmentsRole(ROLE_KEYS.DOCTOR, [...before].reverse()),
    ).toBe(true);
  });

  it("does not mistake one seeded role for another", () => {
    // Receptionist's pre-AP-1 set is a superset of Doctor's; the key must
    // actually be checked, not just the contents.
    expect(
      isUntouchedPreAppointmentsRole(
        ROLE_KEYS.DOCTOR,
        PRE_APPOINTMENTS_ROLE_PERMISSIONS[ROLE_KEYS.RECEPTIONIST],
      ),
    ).toBe(false);
  });
});

describe("what the backfill would append", () => {
  it("appends nothing to Staff or Owner", () => {
    expect(APPOINTMENT_ROLE_TOP_UPS[ROLE_KEYS.STAFF]).toBeUndefined();
    expect(APPOINTMENT_ROLE_TOP_UPS[ROLE_KEYS.OWNER]).toBeUndefined();
  });

  it("appends all eight to Admin", () => {
    expect([...(APPOINTMENT_ROLE_TOP_UPS[ROLE_KEYS.CLINIC_ADMIN] ?? [])].sort()).toEqual(
      [...STAGE_AP1_PERMISSIONS].sort(),
    );
  });

  it("appends the seven booking keys to Receptionist", () => {
    expect(
      [...(APPOINTMENT_ROLE_TOP_UPS[ROLE_KEYS.RECEPTIONIST] ?? [])].sort(),
    ).toEqual(
      STAGE_AP1_PERMISSIONS.filter(
        (permission) => permission !== "appointment:type:manage",
      ).sort(),
    );
  });

  it("appends only appointment:read to Doctor", () => {
    expect([...(APPOINTMENT_ROLE_TOP_UPS[ROLE_KEYS.DOCTOR] ?? [])]).toEqual([
      "appointment:read",
    ]);
  });

  it("appends only AP-1 keys, never anything else", () => {
    // A top-up naming a pre-existing permission would mean a role was
    // re-scoped under cover of the appointments backfill.
    for (const additions of Object.values(APPOINTMENT_ROLE_TOP_UPS)) {
      for (const permission of additions ?? []) {
        expect(STAGE_AP1_PERMISSIONS).toContain(permission);
      }
    }
  });

  it("lands a topped-up role exactly on what a new tenant is seeded with", () => {
    // The guarantee that matters: an existing untouched tenant and a brand-new
    // one end up holding the same thing, so there is only one state to reason
    // about afterwards.
    for (const role of DEFAULT_ROLES) {
      if (role.key === ROLE_KEYS.OWNER || role.key === ROLE_KEYS.STAFF) continue;
      const after = new Set([
        ...PRE_APPOINTMENTS_ROLE_PERMISSIONS[role.key],
        ...(APPOINTMENT_ROLE_TOP_UPS[role.key] ?? []),
      ]);
      expect([...after].sort()).toEqual([...new Set(role.permissions)].sort());
    }
  });
});
