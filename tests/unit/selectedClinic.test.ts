import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActorContext } from "@/lib/rbac";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  accessibleScope: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rbac")>();
  return { ...actual, accessibleClinicScope: mocks.accessibleScope };
});
vi.mock("@/lib/prisma", () => ({
  prisma: {
    clinic: {
      findFirst: mocks.findFirst,
      findMany: mocks.findMany,
    },
  },
}));

import {
  resolveDashboardOperationalClinicId,
  resolveSelectedClinicId,
} from "@/lib/selectedClinic";

const ACTOR: ActorContext = { userId: "user-a", tenantId: "tenant-a" };

function selectedCookie(value?: string) {
  mocks.cookies.mockResolvedValue({
    get: vi.fn().mockReturnValue(value === undefined ? undefined : { value }),
  });
}

describe("selected dashboard clinic resolution", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    selectedCookie();
  });

  it("uses null for All clinics without querying authorization", async () => {
    await expect(resolveSelectedClinicId(ACTOR)).resolves.toBeNull();
    expect(mocks.accessibleScope).not.toHaveBeenCalled();
  });

  it("accepts only a clinic in the actor's scoped clinic list", async () => {
    selectedCookie("clinic-a");
    mocks.accessibleScope.mockResolvedValue({
      scope: "clinics",
      clinicIds: ["clinic-a"],
    });
    await expect(resolveSelectedClinicId(ACTOR)).resolves.toBe("clinic-a");
  });

  it("turns a stale or forged scoped selection into All clinics", async () => {
    selectedCookie("clinic-forged");
    mocks.accessibleScope.mockResolvedValue({
      scope: "clinics",
      clinicIds: ["clinic-a"],
    });
    await expect(resolveSelectedClinicId(ACTOR)).resolves.toBeNull();
  });

  it("rechecks tenant ownership even for tenant-wide access", async () => {
    selectedCookie("clinic-other-tenant");
    mocks.accessibleScope.mockResolvedValue({ scope: "all" });
    mocks.findFirst.mockResolvedValue(null);

    await expect(resolveSelectedClinicId(ACTOR)).resolves.toBeNull();
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { id: "clinic-other-tenant", tenantId: "tenant-a" },
      select: { id: true },
    });
  });
});

describe("dashboard operational clinic resolution", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
  });

  it("returns the explicitly selected clinic directly", async () => {
    await expect(
      resolveDashboardOperationalClinicId(ACTOR, "clinic-selected"),
    ).resolves.toBe("clinic-selected");
    expect(mocks.accessibleScope).not.toHaveBeenCalled();
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("resolves the sole accessible clinic when selectedClinicId is null (single clinic account)", async () => {
    mocks.accessibleScope.mockResolvedValue({ scope: "all" });
    mocks.findMany.mockResolvedValue([{ id: "clinic-sharma" }]);

    await expect(
      resolveDashboardOperationalClinicId(ACTOR, null),
    ).resolves.toBe("clinic-sharma");

    expect(mocks.accessibleScope).toHaveBeenCalledWith(ACTOR, "clinic:read");
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { tenantId: "tenant-a" },
      select: { id: true },
      take: 2,
    });
  });

  it("resolves the sole accessible clinic for clinic-scoped users", async () => {
    mocks.accessibleScope.mockResolvedValue({
      scope: "clinics",
      clinicIds: ["clinic-sharma"],
    });
    mocks.findMany.mockResolvedValue([{ id: "clinic-sharma" }]);

    await expect(
      resolveDashboardOperationalClinicId(ACTOR, null),
    ).resolves.toBe("clinic-sharma");

    expect(mocks.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: "tenant-a",
        id: { in: ["clinic-sharma"] },
      },
      select: { id: true },
      take: 2,
    });
  });

  it("returns null for multi-clinic accounts when no clinic is selected", async () => {
    mocks.accessibleScope.mockResolvedValue({ scope: "all" });
    mocks.findMany.mockResolvedValue([
      { id: "clinic-1" },
      { id: "clinic-2" },
    ]);

    await expect(
      resolveDashboardOperationalClinicId(ACTOR, null),
    ).resolves.toBeNull();
  });

  it("returns null when actor has no accessible clinics", async () => {
    mocks.accessibleScope.mockResolvedValue({ scope: "none" });

    await expect(
      resolveDashboardOperationalClinicId(ACTOR, null),
    ).resolves.toBeNull();
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("returns null when no clinics match in tenant", async () => {
    mocks.accessibleScope.mockResolvedValue({ scope: "all" });
    mocks.findMany.mockResolvedValue([]);

    await expect(
      resolveDashboardOperationalClinicId(ACTOR, null),
    ).resolves.toBeNull();
  });
});
