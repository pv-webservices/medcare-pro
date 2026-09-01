import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActorContext } from "@/lib/rbac";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  accessibleScope: vi.fn(),
  findFirst: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rbac")>();
  return { ...actual, accessibleClinicScope: mocks.accessibleScope };
});
vi.mock("@/lib/prisma", () => ({
  prisma: { clinic: { findFirst: mocks.findFirst } },
}));

import { resolveSelectedClinicId } from "@/lib/selectedClinic";

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
