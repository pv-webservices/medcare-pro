import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));

import { createDoctorSchema, updateDoctorSchema } from "@/lib/doctors";

const base = {
  clinicId: "clinic-a",
  name: "Dr. Sharma",
  department: "General Medicine",
  gender: "Female",
  age: 42,
  phone: "9876543210",
};

describe("explicit Doctor portal-user linking input", () => {
  it("accepts an explicit user id or an unlinked null on create", () => {
    expect(createDoctorSchema.parse({ ...base, userId: "user-a" }).userId).toBe("user-a");
    expect(createDoctorSchema.parse({ ...base, userId: null }).userId).toBeNull();
  });

  it("allows linking or unlinking through the existing update workflow", () => {
    expect(updateDoctorSchema.parse({ userId: "user-a" })).toEqual({ userId: "user-a" });
    expect(updateDoctorSchema.parse({ userId: null })).toEqual({ userId: null });
  });

  it("ignores identity hints rather than using them for automatic matching", () => {
    expect(
      createDoctorSchema.safeParse({
        ...base,
        linkedEmail: "doctor@example.com",
      }).success,
    ).toBe(true);
    // Zod strips unknown hints; neither write function receives them as an
    // identity source. Only the explicit userId field participates.
    const parsed = createDoctorSchema.parse({
      ...base,
      linkedEmail: "doctor@example.com",
    });
    expect(parsed).not.toHaveProperty("linkedEmail");
    expect(parsed.userId).toBeUndefined();
  });
});
