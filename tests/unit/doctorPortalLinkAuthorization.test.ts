import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertClinicInTenant: vi.fn(),
  requirePermission: vi.fn(),
  can: vi.fn(),
  accessibleClinicScopes: vi.fn(),
  clinicFindMany: vi.fn(),
  userFindFirst: vi.fn(),
  userFindMany: vi.fn(),
  doctorFindFirst: vi.fn(),
  doctorFindFirstOrThrow: vi.fn(),
  doctorCreate: vi.fn(),
  doctorUpdate: vi.fn(),
  notifyCreated: vi.fn(),
  notifyUpdated: vi.fn(),
}));

vi.mock("@/lib/apiHandler", () => ({
  BadRequestError: class BadRequestError extends Error {},
  ConflictError: class ConflictError extends Error {},
}));
vi.mock("@/lib/clinicScope", () => ({ clinicWhereForActor: vi.fn() }));
vi.mock("@/lib/notifications", () => ({
  notifyDoctorCreated: mocks.notifyCreated,
  notifyDoctorUpdated: mocks.notifyUpdated,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    clinic: { findMany: mocks.clinicFindMany },
    user: {
      findFirst: mocks.userFindFirst,
      findMany: mocks.userFindMany,
    },
    doctor: {
      findFirst: mocks.doctorFindFirst,
      findFirstOrThrow: mocks.doctorFindFirstOrThrow,
      create: mocks.doctorCreate,
      update: mocks.doctorUpdate,
    },
  },
}));
vi.mock("@/lib/rbac", () => ({
  assertClinicInTenant: mocks.assertClinicInTenant,
  accessibleClinicScopes: mocks.accessibleClinicScopes,
  can: mocks.can,
  requirePermission: mocks.requirePermission,
  ScopeError: class ScopeError extends Error {},
}));

import {
  createDoctor,
  listDoctorPortalUsersForActor,
  updateDoctor,
} from "@/lib/doctors";

const actor = { userId: "actor", tenantId: "tenant-a" };
const baseInput = {
  clinicId: "clinic-a",
  name: "Dr. A",
  department: "General Medicine",
};

function createdDoctor(clinicId: string, userId: string | null) {
  return {
    id: `doctor-${clinicId}`,
    clinicId,
    userId,
    name: "Dr. A",
    department: "General Medicine",
    gender: null,
    age: null,
    phone: null,
    user: userId ? { name: "Portal Doctor", email: "doctor@example.com" } : null,
    clinic: { name: clinicId === "clinic-a" ? "Clinic A" : "Clinic B" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertClinicInTenant.mockResolvedValue(undefined);
  mocks.requirePermission.mockResolvedValue(undefined);
  mocks.can.mockResolvedValue(true);
  mocks.userFindFirst.mockResolvedValue({ id: "portal-user" });
  mocks.doctorFindFirst.mockResolvedValue(null);
  mocks.doctorCreate.mockImplementation(({ data }: { data: { clinicId: string; userId: string | null } }) =>
    Promise.resolve(createdDoctor(data.clinicId, data.userId)),
  );
  mocks.doctorUpdate.mockResolvedValue({});
  mocks.notifyCreated.mockResolvedValue(undefined);
  mocks.notifyUpdated.mockResolvedValue(undefined);
  mocks.clinicFindMany.mockResolvedValue([{ id: "clinic-a" }, { id: "clinic-b" }]);
  mocks.accessibleClinicScopes.mockResolvedValue(
    new Map([["doctor:edit", { scope: "all" }]]),
  );
  mocks.userFindMany.mockResolvedValue([
    {
      id: "portal-user",
      name: "Portal Doctor",
      email: "doctor@example.com",
      doctorProfiles: [],
    },
  ]);
});

describe("Doctor portal-link authorization on create", () => {
  it("rejects a forged link from a create-only actor before any user lookup or write", async () => {
    mocks.requirePermission.mockImplementation(
      (_actor: unknown, permission: string) =>
        permission === "doctor:edit"
          ? Promise.reject(new Error("Missing permission: doctor:edit"))
          : Promise.resolve(),
    );

    await expect(
      createDoctor(actor, { ...baseInput, userId: "portal-user" }),
    ).rejects.toThrow("Missing permission: doctor:edit");

    expect(mocks.requirePermission).toHaveBeenNthCalledWith(
      1,
      actor,
      "doctor:create",
      "clinic-a",
    );
    expect(mocks.requirePermission).toHaveBeenNthCalledWith(
      2,
      actor,
      "doctor:edit",
      "clinic-a",
    );
    expect(mocks.userFindFirst).not.toHaveBeenCalled();
    expect(mocks.doctorCreate).not.toHaveBeenCalled();
  });

  it("allows a create-only actor to create an explicitly unlinked profile", async () => {
    mocks.can.mockResolvedValue(false);

    const result = await createDoctor(actor, { ...baseInput, userId: null });

    expect(mocks.requirePermission).toHaveBeenCalledTimes(1);
    expect(mocks.requirePermission).toHaveBeenCalledWith(
      actor,
      "doctor:create",
      "clinic-a",
    );
    expect(mocks.userFindFirst).not.toHaveBeenCalled();
    expect(mocks.doctorCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: null }),
      }),
    );
    expect(result.userId).toBeNull();
    expect(result.canManagePortalLink).toBe(false);
  });

  it("allows an editor to create and explicitly link a tenant user", async () => {
    const result = await createDoctor(actor, {
      ...baseInput,
      userId: "portal-user",
    });

    expect(mocks.requirePermission).toHaveBeenCalledWith(
      actor,
      "doctor:edit",
      "clinic-a",
    );
    expect(mocks.userFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "portal-user",
          tenantId: "tenant-a",
        }),
      }),
    );
    expect(result.userId).toBe("portal-user");
  });

  it("rejects a portal user that is not active in the actor's tenant", async () => {
    mocks.userFindFirst.mockResolvedValue(null);

    await expect(
      createDoctor(actor, { ...baseInput, userId: "other-tenant-user" }),
    ).rejects.toThrow("Choose an active portal user from this organisation.");
    expect(mocks.doctorCreate).not.toHaveBeenCalled();
  });

  it("rejects a duplicate portal link inside the same clinic", async () => {
    mocks.doctorFindFirst.mockResolvedValue({ id: "existing-doctor" });

    await expect(
      createDoctor(actor, { ...baseInput, userId: "portal-user" }),
    ).rejects.toThrow("already linked to a doctor in this clinic");
    expect(mocks.doctorCreate).not.toHaveBeenCalled();
  });

  it("permits the same portal user once in each of two clinics", async () => {
    await createDoctor(actor, { ...baseInput, userId: "portal-user" });
    await createDoctor(actor, {
      ...baseInput,
      clinicId: "clinic-b",
      userId: "portal-user",
    });

    expect(mocks.doctorCreate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({ clinicId: "clinic-a", userId: "portal-user" }),
      }),
    );
    expect(mocks.doctorCreate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({ clinicId: "clinic-b", userId: "portal-user" }),
      }),
    );
    expect(mocks.doctorFindFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: expect.objectContaining({ clinicId: "clinic-a" }) }),
    );
    expect(mocks.doctorFindFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: expect.objectContaining({ clinicId: "clinic-b" }) }),
    );
  });
});

describe("Doctor portal-link candidate reads", () => {
  it("returns no candidates or user rows to a create-only actor", async () => {
    mocks.accessibleClinicScopes.mockResolvedValue(
      new Map([["doctor:edit", { scope: "none" }]]),
    );

    await expect(listDoctorPortalUsersForActor(actor)).resolves.toEqual([]);
    expect(mocks.accessibleClinicScopes).toHaveBeenCalledWith(actor, ["doctor:edit"]);
    expect(mocks.userFindMany).not.toHaveBeenCalled();
  });

  it("queries candidates only for clinics inside doctor:edit scope", async () => {
    mocks.accessibleClinicScopes.mockResolvedValue(
      new Map([["doctor:edit", { scope: "clinics", clinicIds: ["clinic-a"] }]]),
    );

    await listDoctorPortalUsersForActor(actor, {
      clinicIds: ["clinic-a", "clinic-b"],
    });

    expect(mocks.userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          doctorProfiles: expect.objectContaining({
            where: { clinicId: { in: ["clinic-a"] } },
          }),
        }),
      }),
    );
  });
});

describe("Doctor portal-link authorization on update", () => {
  it.each([
    ["link", "portal-user"],
    ["change link", "replacement-user"],
    ["unlink", null],
  ])("requires exact-clinic edit access to %s", async (_label, userId) => {
    mocks.doctorFindFirst
      .mockResolvedValueOnce({ clinicId: "clinic-a" })
      .mockResolvedValueOnce(userId ? null : { clinicId: "clinic-a" })
      .mockResolvedValueOnce({ clinicId: "clinic-a" });
    mocks.doctorFindFirstOrThrow.mockResolvedValue({
      ...createdDoctor("clinic-a", userId),
      availability: [],
      leave: [],
    });

    await updateDoctor(actor, "doctor-a", { userId });

    expect(mocks.requirePermission).toHaveBeenCalledWith(
      actor,
      "doctor:edit",
      "clinic-a",
    );
    expect(mocks.doctorUpdate).toHaveBeenCalledWith({
      where: { id: "doctor-a" },
      data: { userId },
    });
  });
});
