import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
const db = vi.hoisted(() => ({ read: vi.fn(), lock: vi.fn(), invoice: vi.fn(), update: vi.fn(), patient: vi.fn(), log: vi.fn(), notify: vi.fn(), entitlement: vi.fn(), permission: vi.fn(), role: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireActor: vi.fn().mockResolvedValue({ tenantId: "tenant", userId: "user" }), UnauthenticatedError: class extends Error {} }));
vi.mock("@/lib/features", () => ({ MODULE_FEATURES: { registrations: "registrations" }, requireModule: vi.fn(), requireTenantFeatureEntitlement: db.entitlement }));
vi.mock("@/lib/rbac", async (original) => ({ ...await original<typeof import("@/lib/rbac")>(), can: vi.fn().mockResolvedValue(true), requirePermission: db.permission, resolveRoleNameAtTime: db.role }));
vi.mock("@/lib/notifications", () => ({ notifyRegistrationCreated: vi.fn(), notifyRegistrationUpdated: db.notify }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  registration: { findFirst: db.read },
  $transaction: async (work: (tx: unknown) => Promise<unknown>) => work({ $queryRaw: db.lock, invoice: { findFirst: db.invoice }, registration: { update: db.update }, patient: { update: db.patient }, registrationEditLog: { create: db.log } }),
} }));
import { PATCH } from "@/app/api/registrations/[id]/route";
import { FeatureError } from "@/lib/featureResolution";
function patch(input: unknown) {
  return PATCH(new Request("http://localhost/api/registrations/visit", { method: "PATCH", body: JSON.stringify(input) }), { params: Promise.resolve({ id: "visit" }) });
}
beforeEach(() => {
  vi.clearAllMocks();
  db.entitlement.mockResolvedValue(undefined);
  db.role.mockResolvedValue("Owner");
  db.lock.mockResolvedValue([{ amount: new Prisma.Decimal("200.00") }]);
  db.invoice.mockResolvedValue({ id: "issued-invoice" });
  db.read.mockResolvedValue({ id: "visit", clinicId: "clinic", patientId: "patient", doctorId: null, department: "General", amount: new Prisma.Decimal("200.00"),
    visitDate: new Date("2026-09-28T10:00:00Z"), visitType: "NEW", createdAt: new Date(), updatedAt: new Date(),
    clinic: { name: "Clinic" }, doctor: null, patient: { patientCode: "PT-2026-0001", name: "Synthetic", age: null, gender: null, mobileNumber: "9000000000", address: null, city: null }, creator: { name: "Owner", email: "owner@example.test" } });
});
describe("registration billed amount server guard", () => {
  it("returns 200 for an equal amount on a billed visit without writes, amount log or notification", async () => {
    expect((await patch({ amount: 200 })).status).toBe(200);
    expect(db.lock).toHaveBeenCalledOnce();
    expect(db.update).not.toHaveBeenCalled();
    expect(db.log).not.toHaveBeenCalled();
    expect(db.notify).not.toHaveBeenCalled();
  });
  it("allows other edits with an equal explicit amount, omitting amount from both write and audit", async () => {
    expect((await patch({ amount: 200, department: "Changed" })).status).toBe(200);
    expect(db.update.mock.calls[0][0].data).not.toHaveProperty("amount");
    expect(db.log.mock.calls[0][0].data.changedFields).toEqual({ department: { from: "General", to: "Changed" } });
    expect(db.permission.mock.calls.at(-1)?.[3]).toHaveProperty("$queryRaw", db.lock);
    expect(db.role.mock.calls.at(-1)?.[2]).toHaveProperty("$queryRaw", db.lock);
  });
  it("compares with the locked amount even when the pre-read differs", async () => {
    db.lock.mockResolvedValue([{ amount: new Prisma.Decimal("250.00") }]);
    expect((await patch({ amount: 250 })).status).toBe(200);
    expect(db.update).not.toHaveBeenCalled();
    expect(db.log).not.toHaveBeenCalled();
  });
  it("rejects a different amount on an issued invoice without a log", async () => {
    const response = await patch({ amount: 250 });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("This visit has been billed — change the bill instead.");
    expect(db.update).not.toHaveBeenCalled();
    expect(db.log).not.toHaveBeenCalled();
  });
  it("rejects a stale different amount when no issued invoice exists", async () => {
    db.invoice.mockResolvedValue(null);
    db.lock.mockResolvedValue([{ amount: new Prisma.Decimal("225.00") }]);
    const response = await patch({ amount: 250 });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("This visit was changed by someone else — reload and try again.");
    expect(db.log).not.toHaveBeenCalled();
  });
  it("allows explicit amount edits without an issued invoice and logs the locked amount", async () => {
    db.invoice.mockResolvedValue(null);
    expect((await patch({ amount: 250 })).status).toBe(200);
    expect(db.update.mock.calls[0][0].data.amount).toBe("250.00");
    expect(db.log.mock.calls[0][0].data.changedFields.amount).toEqual({ from: "200.00", to: "250.00" });
  });
  it("retains billing-disabled behavior without locks or new conflicts", async () => {
    db.entitlement.mockRejectedValue(new FeatureError("billing", "entitlement"));
    expect((await patch({ amount: 250 })).status).toBe(200);
    expect(db.lock).not.toHaveBeenCalled();
    expect(db.invoice).not.toHaveBeenCalled();
    expect(db.update.mock.calls[0][0].data.amount).toBe("250.00");
    expect((await patch({ amount: 200 })).status).toBe(400);
  });
  it("never rewrites omitted amount fields", async () => {
    expect((await patch({ department: "Changed" })).status).toBe(200);
    expect(db.lock).not.toHaveBeenCalled();
    expect(db.update.mock.calls[0][0].data).not.toHaveProperty("amount");
  });
});
