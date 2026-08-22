import { describe, expect, it } from "vitest";
import {
  MAX_APPOINTMENT_AMOUNT,
  MAX_DURATION_MINUTES,
  MIN_DURATION_MINUTES,
} from "@/lib/appointmentRules";
import {
  appointmentTypeFilterSchema,
  createAppointmentTypeSchema,
  displayAppointmentTypeName,
  normaliseAppointmentTypeName,
  updateAppointmentTypeSchema,
} from "@/lib/appointmentInput";
import { DEFAULT_ROLES, ROLE_KEYS, type RoleKey } from "@/lib/defaultRoles";

/**
 * AP-3 — the appointment type rules, with no database in sight.
 *
 * The duplicate CHECK itself needs rows and therefore lives in
 * scripts/verify-ap3-appointment-booking.mts. What is pure — and what actually
 * decides whether two names collide — is the normalisation below, so that is
 * what is pinned here.
 */

const permissionsFor = (key: RoleKey): readonly string[] => {
  const role = DEFAULT_ROLES.find((entry) => entry.key === key);
  if (!role) throw new Error(`No seeded role keyed ${key}`);
  return role.permissions;
};

const validType = {
  name: "Consultation",
  durationMinutes: 30,
  defaultAmount: 500,
};

describe("normaliseAppointmentTypeName", () => {
  it("folds case, so a lowercase twin cannot slip past the check", () => {
    // The database index is a byte comparison and would happily store both.
    expect(normaliseAppointmentTypeName("Consultation")).toBe(
      normaliseAppointmentTypeName("consultation"),
    );
    expect(normaliseAppointmentTypeName("CONSULTATION")).toBe("consultation");
  });

  it("trims, so a trailing space cannot either", () => {
    expect(normaliseAppointmentTypeName("  Consultation  ")).toBe("consultation");
  });

  it("collapses interior whitespace", () => {
    // "Follow  up" and "Follow up" are indistinguishable in a dropdown, so
    // they must be indistinguishable to the duplicate check too.
    expect(normaliseAppointmentTypeName("Follow  up")).toBe("follow up");
    expect(normaliseAppointmentTypeName("Follow\tup")).toBe("follow up");
    expect(normaliseAppointmentTypeName("Follow\nup")).toBe("follow up");
  });

  it("is locale-independent", () => {
    // toLocaleLowerCase("tr") maps "I" to the dotless "ı", so the same two
    // names would collide on one server and not on another. The fold must not
    // depend on where the process happens to be running.
    expect(normaliseAppointmentTypeName("IMAGING")).toBe("imaging");
    expect(normaliseAppointmentTypeName("Imaging")).toBe(
      normaliseAppointmentTypeName("IMAGING"),
    );
  });

  it("leaves genuinely different names apart", () => {
    expect(normaliseAppointmentTypeName("Consultation")).not.toBe(
      normaliseAppointmentTypeName("Consultation Extended"),
    );
  });

  it("is idempotent", () => {
    const once = normaliseAppointmentTypeName("  Follow  Up  ");
    expect(normaliseAppointmentTypeName(once)).toBe(once);
  });
});

describe("displayAppointmentTypeName", () => {
  it("preserves the casing the admin typed", () => {
    // Only the COMPARISON is case-folded. Storing the folded form would rename
    // every service to lowercase on the screen.
    expect(displayAppointmentTypeName("Consultation")).toBe("Consultation");
    expect(displayAppointmentTypeName("ECG Review")).toBe("ECG Review");
  });

  it("still trims and collapses", () => {
    expect(displayAppointmentTypeName("  Follow  Up  ")).toBe("Follow Up");
  });

  it("agrees with the normaliser about what is one name", () => {
    const stored = displayAppointmentTypeName("  Follow  Up  ");
    expect(normaliseAppointmentTypeName(stored)).toBe(
      normaliseAppointmentTypeName("follow up"),
    );
  });
});

describe("duplicate detection is scoped, not global", () => {
  /**
   * The predicate the service applies, restated so the SCOPE half of the rule
   * is pinned somewhere pure. Two rows collide only when the same tenant, the
   * same clinic scope (NULL counting as its own scope) and the same normalised
   * name all coincide.
   */
  const collides = (
    a: { tenantId: string; clinicId: string | null; name: string },
    b: { tenantId: string; clinicId: string | null; name: string },
  ): boolean =>
    a.tenantId === b.tenantId &&
    a.clinicId === b.clinicId &&
    normaliseAppointmentTypeName(a.name) === normaliseAppointmentTypeName(b.name);

  const tenantWide = { tenantId: "t1", clinicId: null, name: "Consultation" };

  it("catches two tenant-wide types sharing a name", () => {
    // MySQL does NOT catch this: it treats NULLs as distinct in a unique index,
    // so (t1, NULL, "Consultation") twice is two index entries. This is the
    // whole reason the check exists in application code.
    expect(
      collides(tenantWide, { tenantId: "t1", clinicId: null, name: "consultation" }),
    ).toBe(true);
  });

  it("catches two types sharing a name at the same clinic", () => {
    expect(
      collides(
        { tenantId: "t1", clinicId: "c1", name: "Consultation" },
        { tenantId: "t1", clinicId: "c1", name: "  CONSULTATION " },
      ),
    ).toBe(true);
  });

  it("allows the same service at two different clinics", () => {
    // Two sites both offering a consultation is the ordinary case, not a clash.
    expect(
      collides(
        { tenantId: "t1", clinicId: "c1", name: "Consultation" },
        { tenantId: "t1", clinicId: "c2", name: "Consultation" },
      ),
    ).toBe(false);
  });

  it("does not treat a clinic type as colliding with a tenant-wide one", () => {
    // Different scopes. A site may offer its own longer consultation beside the
    // organisation-wide one.
    expect(
      collides(tenantWide, { tenantId: "t1", clinicId: "c1", name: "Consultation" }),
    ).toBe(false);
  });

  it("never collides across organisations", () => {
    expect(
      collides(tenantWide, { tenantId: "t2", clinicId: null, name: "Consultation" }),
    ).toBe(false);
  });
});

describe("createAppointmentTypeSchema", () => {
  it("accepts a well-formed tenant-wide type", () => {
    const parsed = createAppointmentTypeSchema.parse(validType);
    expect(parsed.name).toBe("Consultation");
    expect(parsed.durationMinutes).toBe(30);
    expect(parsed.defaultAmount).toBe(500);
  });

  it("accepts a clinic-specific type", () => {
    const parsed = createAppointmentTypeSchema.parse({
      ...validType,
      clinicId: "clinic-1",
    });
    expect(parsed.clinicId).toBe("clinic-1");
  });

  it("treats a null clinic as tenant-wide rather than an error", () => {
    expect(
      createAppointmentTypeSchema.parse({ ...validType, clinicId: null }).clinicId,
    ).toBeNull();
  });

  it("requires a name", () => {
    expect(() =>
      createAppointmentTypeSchema.parse({ ...validType, name: "   " }),
    ).toThrow();
  });

  it("trims the name it accepts", () => {
    expect(
      createAppointmentTypeSchema.parse({ ...validType, name: "  Scan  " }).name,
    ).toBe("Scan");
  });

  it("refuses a name longer than the column", () => {
    expect(() =>
      createAppointmentTypeSchema.parse({ ...validType, name: "x".repeat(256) }),
    ).toThrow();
  });

  it("refuses a duration outside the appointmentRules bounds", () => {
    for (const durationMinutes of [
      0,
      -30,
      MIN_DURATION_MINUTES - 1,
      MAX_DURATION_MINUTES + 1,
    ]) {
      expect(() =>
        createAppointmentTypeSchema.parse({ ...validType, durationMinutes }),
      ).toThrow();
    }
  });

  it("refuses a fractional duration", () => {
    // A 12.5-minute grid would generate slot boundaries no clock renders.
    expect(() =>
      createAppointmentTypeSchema.parse({ ...validType, durationMinutes: 12.5 }),
    ).toThrow();
  });

  it("accepts the exact duration bounds", () => {
    for (const durationMinutes of [MIN_DURATION_MINUTES, MAX_DURATION_MINUTES]) {
      expect(
        createAppointmentTypeSchema.parse({ ...validType, durationMinutes })
          .durationMinutes,
      ).toBe(durationMinutes);
    }
  });

  it("allows a free service", () => {
    // Zero is a real thing a clinic books: a courtesy follow-up.
    expect(
      createAppointmentTypeSchema.parse({ ...validType, defaultAmount: 0 })
        .defaultAmount,
    ).toBe(0);
  });

  it("refuses a negative amount", () => {
    expect(() =>
      createAppointmentTypeSchema.parse({ ...validType, defaultAmount: -1 }),
    ).toThrow();
  });

  it("refuses an amount the Decimal(10,2) column cannot hold", () => {
    expect(() =>
      createAppointmentTypeSchema.parse({
        ...validType,
        defaultAmount: MAX_APPOINTMENT_AMOUNT + 1,
      }),
    ).toThrow();
  });

  it("refuses a third decimal place", () => {
    // The column would silently round 10.005 to 10.01, and the patient would be
    // quoted one number and charged another.
    expect(() =>
      createAppointmentTypeSchema.parse({ ...validType, defaultAmount: 10.005 }),
    ).toThrow();
  });

  it("accepts two decimal places", () => {
    expect(
      createAppointmentTypeSchema.parse({ ...validType, defaultAmount: 499.99 })
        .defaultAmount,
    ).toBe(499.99);
  });

  it("gives the client no way to choose an organisation", () => {
    const parsed = createAppointmentTypeSchema.parse({
      ...validType,
      tenantId: "someone-elses-tenant",
    }) as Record<string, unknown>;

    expect(parsed.tenantId).toBeUndefined();
  });

  it("gives the client no way to create something already retired", () => {
    const parsed = createAppointmentTypeSchema.parse({
      ...validType,
      isActive: false,
    }) as Record<string, unknown>;

    expect(parsed.isActive).toBeUndefined();
  });
});

describe("updateAppointmentTypeSchema", () => {
  it("accepts a single field", () => {
    expect(updateAppointmentTypeSchema.parse({ name: "Renamed" }).name).toBe(
      "Renamed",
    );
  });

  it("accepts deactivation", () => {
    expect(updateAppointmentTypeSchema.parse({ isActive: false }).isActive).toBe(
      false,
    );
  });

  it("accepts reactivation", () => {
    expect(updateAppointmentTypeSchema.parse({ isActive: true }).isActive).toBe(
      true,
    );
  });

  it("refuses an empty change", () => {
    expect(() => updateAppointmentTypeSchema.parse({})).toThrow();
  });

  it("applies the same duration and amount rules as create", () => {
    expect(() =>
      updateAppointmentTypeSchema.parse({ durationMinutes: 3 }),
    ).toThrow();
    expect(() =>
      updateAppointmentTypeSchema.parse({ defaultAmount: -5 }),
    ).toThrow();
    expect(() =>
      updateAppointmentTypeSchema.parse({ defaultAmount: 1.005 }),
    ).toThrow();
  });

  it("has no way to say tenantId or id", () => {
    // A type cannot be moved to another organisation, and the guarantee is that
    // the schema has no vocabulary for it rather than a check that could be
    // forgotten.
    const parsed = updateAppointmentTypeSchema.parse({
      name: "Renamed",
      tenantId: "other-tenant",
      id: "other-id",
    }) as Record<string, unknown>;

    expect(parsed.tenantId).toBeUndefined();
    expect(parsed.id).toBeUndefined();
  });

  it("allows moving a type between clinic scopes", () => {
    expect(updateAppointmentTypeSchema.parse({ clinicId: "c2" }).clinicId).toBe(
      "c2",
    );
    expect(updateAppointmentTypeSchema.parse({ clinicId: null }).clinicId).toBeNull();
  });
});

describe("appointmentTypeFilterSchema", () => {
  it("reads includeInactive from a query string", () => {
    expect(
      appointmentTypeFilterSchema.parse({ includeInactive: "true" })
        .includeInactive,
    ).toBe(true);
  });

  it("does not turn the string \"false\" into true", () => {
    // z.coerce.boolean() would: Boolean("false") is true, so ?includeInactive=false
    // would switch retired types ON.
    expect(
      appointmentTypeFilterSchema.parse({ includeInactive: "false" })
        .includeInactive,
    ).toBe(false);
  });

  it("defaults to leaving retired types out", () => {
    expect(appointmentTypeFilterSchema.parse({}).includeInactive).toBeUndefined();
  });
});

describe("who may manage the price list", () => {
  it("lets Admin manage types", () => {
    expect(permissionsFor(ROLE_KEYS.CLINIC_ADMIN)).toContain(
      "appointment:type:manage",
    );
  });

  it("lets Owner manage types through the wildcard", () => {
    expect(permissionsFor(ROLE_KEYS.OWNER)).toContain("*");
  });

  it("does not let Receptionist manage types", () => {
    // The front desk books appointments; it does not decide what they cost.
    const held = permissionsFor(ROLE_KEYS.RECEPTIONIST);
    expect(held).not.toContain("appointment:type:manage");
    expect(held).toContain("appointment:create");
  });

  it("does not let Doctor manage types", () => {
    const held = permissionsFor(ROLE_KEYS.DOCTOR);
    expect(held).not.toContain("appointment:type:manage");
    expect(held).not.toContain("appointment:create");
    expect(held).toContain("appointment:read");
  });

  it("does not let Staff near appointments at all", () => {
    const held = permissionsFor(ROLE_KEYS.STAFF);
    expect(held).not.toContain("appointment:type:manage");
    expect(held).not.toContain("appointment:create");
    expect(held).not.toContain("appointment:read");
  });
});
