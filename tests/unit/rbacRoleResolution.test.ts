import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActorContext } from "@/lib/rbac";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    userRole: {
      findMany: mocks.findMany,
    },
  },
}));

import { resolveRoleNameAtTime } from "@/lib/rbac";

const ACTOR: ActorContext = {
  userId: "user-test",
  tenantId: "tenant-test",
};

describe("resolveRoleNameAtTime", () => {
  beforeEach(() => {
    mocks.findMany.mockReset();
  });

  it("returns 'unknown' when the user has no role assignments in the tenant", async () => {
    mocks.findMany.mockResolvedValue([]);

    const result = await resolveRoleNameAtTime(ACTOR);
    expect(result).toBe("unknown");
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: {
        userId: "user-test",
        role: { tenantId: "tenant-test" },
      },
      select: {
        clinicId: true,
        role: { select: { name: true, key: true } },
      },
    });
  });

  it("resolves the exact role for a clinic when clinicId is provided", async () => {
    mocks.findMany.mockResolvedValue([
      {
        clinicId: "clinic-sharma",
        role: { name: "Doctor", key: "DOCTOR" },
      },
      {
        clinicId: "clinic-skin",
        role: { name: "Receptionist", key: "RECEPTIONIST" },
      },
    ]);

    const result = await resolveRoleNameAtTime(ACTOR, "clinic-sharma");
    expect(result).toBe("Doctor");
  });

  it("resolves a clinic-scoped role even when clinicId is omitted (e.g. All clinics view)", async () => {
    mocks.findMany.mockResolvedValue([
      {
        clinicId: "clinic-sharma",
        role: { name: "Doctor", key: "DOCTOR" },
      },
    ]);

    const result = await resolveRoleNameAtTime(ACTOR);
    expect(result).toBe("Doctor");
  });

  it("resolves a tenant-wide Owner role whether clinicId is provided or omitted", async () => {
    mocks.findMany.mockResolvedValue([
      {
        clinicId: null,
        role: { name: "Owner", key: "OWNER" },
      },
    ]);

    const resultWithoutClinic = await resolveRoleNameAtTime(ACTOR);
    expect(resultWithoutClinic).toBe("Owner");

    const resultWithClinic = await resolveRoleNameAtTime(
      ACTOR,
      "clinic-sharma",
    );
    expect(resultWithClinic).toBe("Owner");
  });

  it("prefers the clinic-scoped assignment over a tenant-wide assignment if both exist for that clinic", async () => {
    mocks.findMany.mockResolvedValue([
      {
        clinicId: null,
        role: { name: "Owner", key: "OWNER" },
      },
      {
        clinicId: "clinic-sharma",
        role: { name: "Doctor", key: "DOCTOR" },
      },
    ]);

    const resultForClinic = await resolveRoleNameAtTime(
      ACTOR,
      "clinic-sharma",
    );
    expect(resultForClinic).toBe("Doctor");

    const resultGeneral = await resolveRoleNameAtTime(ACTOR);
    expect(resultGeneral).toBe("Owner");
  });

  it("prioritizes higher authority roles when clinicId is omitted and multiple roles exist", async () => {
    mocks.findMany.mockResolvedValue([
      {
        clinicId: "clinic-b",
        role: { name: "Receptionist", key: "RECEPTIONIST" },
      },
      {
        clinicId: "clinic-a",
        role: { name: "Admin", key: "CLINIC_ADMIN" },
      },
    ]);

    const result = await resolveRoleNameAtTime(ACTOR);
    expect(result).toBe("Admin");
  });
});
