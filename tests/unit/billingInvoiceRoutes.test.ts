import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError } from "@/lib/domainErrors";
import { ScopeError } from "@/lib/rbac";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), read: vi.fn(), write: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireActor: mocks.actor, UnauthenticatedError: class extends Error {} }));
vi.mock("@/lib/billing/invoices", () => ({
  getLiveInvoiceForRegistration: mocks.read, getInvoiceForActor: mocks.read, listInvoicesForActor: mocks.list,
  createDraftInvoice: mocks.write, saveDraftInvoice: mocks.write, issueInvoice: mocks.write, discardDraftInvoice: mocks.write,
}));
import { GET as live, POST as create } from "@/app/api/registrations/[id]/invoice/route";
import { GET as detail, PUT as save } from "@/app/api/invoices/[id]/route";
import { GET as list } from "@/app/api/invoices/route";
import { POST as issue } from "@/app/api/invoices/[id]/issue/route";
import { POST as discard } from "@/app/api/invoices/[id]/discard/route";
const context = { params: Promise.resolve({ id: "synthetic-invoice" }) };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.actor.mockResolvedValue({ tenantId: "session-tenant", userId: "session-user" });
  mocks.read.mockResolvedValue({ id: "synthetic-invoice" });
  mocks.write.mockResolvedValue({ id: "synthetic-invoice" });
  mocks.list.mockResolvedValue({ items: [], total: 0 });
});
describe("billing invoice API privacy", () => {
  const handlers = [[live, "GET"], [detail, "GET"], [list, "GET"], [create, "POST"], [save, "PUT"], [issue, "POST"], [discard, "POST"]] as const;
  it.each(handlers)("protects success responses for %s %s", async (handler, method) => {
    const response = await handler(new Request("http://localhost/api/invoices/synthetic-invoice", { method, ...(method === "GET" ? {} : { body: "{}" }) }), context);
    expect(response.status).toBe(handler === create ? 201 : 200);
    expect(response.headers.get("Cache-Control")).toContain("private, no-store");
    expect(mocks.actor).toHaveBeenCalledOnce();
  });
  it.each([new ScopeError(), new ConflictError("Stale revision")])("keeps failure responses private: %s", async (failure) => {
    mocks.write.mockRejectedValue(failure);
    const response = await issue(new Request("http://localhost/api/invoices/id/issue", { method: "POST", body: '{"revision":0}' }), context);
    expect(response.status).toBe(failure instanceof ScopeError ? 404 : 409);
    expect(response.headers.get("Cache-Control")).toContain("private, no-store");
  });
  it("rejects ownership fields on draft creation before calling the service", async () => {
    const response = await create(new Request("http://localhost/api/registrations/id/invoice", { method: "POST", body: '{"clinicId":"foreign"}' }), context);
    expect([400, 422]).toContain(response.status);
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("rejects malformed save JSON with a private 400", async () => {
    const response = await save(new Request("http://localhost/api/invoices/id", { method: "PUT", body: "{" }), context);
    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toContain("private, no-store");
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
