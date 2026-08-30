import { beforeEach, describe, expect, it, vi } from "vitest";

const gates = vi.hoisted(() => ({
  requireModule: vi.fn(),
  requirePermission: vi.fn(),
  clinicWhereForActor: vi.fn(),
  getScopedSlots: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));

vi.mock("@/lib/features", () => ({
  MODULE_FEATURES: { appointments: "appointments" },
  requireModule: gates.requireModule,
}));

vi.mock("@/lib/rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rbac")>();
  return { ...actual, requirePermission: gates.requirePermission };
});

vi.mock("@/lib/clinicScope", () => ({
  clinicWhereForActor: gates.clinicWhereForActor,
}));

vi.mock("@/lib/appointmentAvailability", () => ({
  getAppointmentSlotsForScope: gates.getScopedSlots,
}));

import { getAppointmentSlots } from "@/lib/appointments";
import { FeatureError } from "@/lib/featureResolution";
import { PermissionError, ScopeError } from "@/lib/rbac";

const ACTOR = Object.freeze({ userId: "user-a", tenantId: "tenant-a" });
const QUERY = Object.freeze({
  clinicId: "clinic-a",
  doctorId: "doctor-a",
  appointmentTypeId: "type-a",
  date: "2026-09-01",
});
const RESULT = Object.freeze({
  ...QUERY,
  doctorName: "Doctor A",
  appointmentTypeName: "Consultation",
  durationMinutes: 30,
  outcome: "ok" as const,
  slots: [],
});

describe("authenticated appointment availability regression", () => {
  beforeEach(() => {
    Object.values(gates).forEach((mock) => mock.mockReset());
    gates.requireModule.mockResolvedValue(undefined);
    gates.requirePermission.mockResolvedValue(undefined);
    gates.clinicWhereForActor.mockResolvedValue({ id: "clinic-a" });
    gates.getScopedSlots.mockResolvedValue(RESULT);
  });

  it("keeps the Appointments module gate before every later read", async () => {
    gates.requireModule.mockRejectedValueOnce(
      new FeatureError("appointments", "entitlement"),
    );

    await expect(getAppointmentSlots(ACTOR, QUERY)).rejects.toBeInstanceOf(
      FeatureError,
    );
    expect(gates.requirePermission).not.toHaveBeenCalled();
    expect(gates.getScopedSlots).not.toHaveBeenCalled();
  });

  it("keeps appointment:read scoped to the requested clinic", async () => {
    gates.requirePermission.mockRejectedValueOnce(
      new PermissionError("appointment:read"),
    );

    await expect(getAppointmentSlots(ACTOR, QUERY)).rejects.toBeInstanceOf(
      PermissionError,
    );
    expect(gates.requirePermission).toHaveBeenCalledWith(
      ACTOR,
      "appointment:read",
      "clinic-a",
    );
    expect(gates.clinicWhereForActor).not.toHaveBeenCalled();
    expect(gates.getScopedSlots).not.toHaveBeenCalled();
  });

  it("keeps clinicWhereForActor as a second scope proof", async () => {
    gates.clinicWhereForActor.mockResolvedValueOnce(null);

    await expect(getAppointmentSlots(ACTOR, QUERY)).rejects.toBeInstanceOf(
      ScopeError,
    );
    expect(gates.clinicWhereForActor).toHaveBeenCalledWith(
      ACTOR,
      "appointment:read",
      "clinic-a",
    );
    expect(gates.getScopedSlots).not.toHaveBeenCalled();
  });

  it("passes only actor-derived tenant and proven clinic scope to the shared core", async () => {
    await expect(getAppointmentSlots(ACTOR, QUERY)).resolves.toBe(RESULT);

    expect(gates.requireModule).toHaveBeenCalledWith(ACTOR, "appointments");
    expect(gates.getScopedSlots).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      ...QUERY,
    });
  });
});
