import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { platformPlivoNumber: { findUnique: mocks.findUnique } },
}));
vi.mock("@/lib/telephony/access", () => ({
  assertActorCanManageTelephony: mocks.assertAccess,
}));

import { getAssignedIvrNumberForActor } from "@/lib/telephony/assignedIvrNumber";

const actor = { userId: "user-a", tenantId: "tenant-a" };

describe("tenant read-only IVR number visibility", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads only the selected clinic assignment and hides provider internals", async () => {
    mocks.findUnique.mockResolvedValue({
      phoneNumber: "+918031725772",
      assignedTenantId: "tenant-a",
      assignmentStatus: "ASSIGNED",
      providerPresent: true,
      healthStatus: "HEALTHY",
      assignedClinic: {
        tenantId: "tenant-a",
        telephonyConfig: { plivoNumber: "+918031725772" },
      },
    });
    await expect(getAssignedIvrNumberForActor(actor, "clinic-a")).resolves.toEqual({
      phoneNumber: "+918031725772",
      displayNumber: "+91 80 3172 5772",
      status: "assigned",
    });
    expect(mocks.assertAccess).toHaveBeenCalledWith(actor, "clinic-a");
    expect(mocks.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { assignedClinicId: "clinic-a" },
    }));
  });

  it("fails closed for a mismatched tenant relationship", async () => {
    mocks.findUnique.mockResolvedValue({
      phoneNumber: "+918031725772",
      assignedTenantId: "tenant-b",
      assignmentStatus: "ASSIGNED",
      providerPresent: true,
      healthStatus: "HEALTHY",
      assignedClinic: null,
    });
    await expect(getAssignedIvrNumberForActor(actor, "clinic-a")).resolves.toMatchObject({ status: "not-assigned", phoneNumber: null });
  });

  it("renders the assignment as information without tenant mutation controls", () => {
    const page = readFileSync(resolve("src/app/(dashboard)/ivr/page.tsx"), "utf8");
    expect(page).toContain("Assigned IVR number");
    expect(page).toContain("Managed by MEDCARE PRO");
    expect(page).not.toContain("Assign number");
    expect(page).not.toContain("Unassign");
  });
});
