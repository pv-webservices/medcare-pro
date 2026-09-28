import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
const globalQuery = vi.hoisted(() => vi.fn(() => { throw new Error("Global Prisma query escaped the transaction"); }));
vi.mock("@/lib/prisma", () => ({ prisma: { clinic: { findUnique: globalQuery }, serviceItem: { findMany: globalQuery } } }));
import { listBillableServicesForClinic } from "@/lib/billing/serviceItems";

describe("billable service transaction propagation", () => {
  it("uses the caller's transaction for both scope and catalogue queries", async () => {
    const tx = { clinic: { findUnique: vi.fn().mockResolvedValue({ id: "clinic", tenantId: "tenant" }) },
      serviceItem: { findMany: vi.fn().mockResolvedValue([{ id: "service", clinicId: null, name: "Service", category: "OTHER", price: new Prisma.Decimal("10.00"), taxRatePercent: new Prisma.Decimal("0.00"), sacCode: null, isActive: true }]) } };
    expect(await listBillableServicesForClinic("clinic", tx as unknown as Prisma.TransactionClient)).toMatchObject([{ id: "service", price: "10.00" }]);
    expect(globalQuery).not.toHaveBeenCalled();
    expect(tx.serviceItem.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: "tenant", isActive: true, OR: [{ clinicId: null }, { clinicId: "clinic" }] } }));
  });
});
