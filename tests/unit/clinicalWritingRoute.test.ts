import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ actor: vi.fn(), service: vi.fn() }));
vi.mock("@/lib/session", () => ({
  requireActor: m.actor,
  UnauthenticatedError: class extends Error {},
}));
vi.mock("@/lib/clinical-ai/writingAssistant", () => ({
  requestWritingAssistance: m.service,
}));
import { POST } from "@/app/api/clinical-ai/writing-assist/route";
import { UnauthenticatedError } from "@/lib/session";
import { PermissionError, ScopeError } from "@/lib/rbac";
import { AiError } from "@/lib/ai/errors";
beforeEach(() => {
  vi.resetAllMocks();
  m.actor.mockResolvedValue({ userId: "doctor", tenantId: "tenant" });
  m.service.mockResolvedValue({
    changed: false,
    suggestedText: "",
    suggestions: [],
  });
});
describe("Writing endpoint public responses", () => {
  it("returns private no-store success", async () => {
    const r = await POST(
      new Request("http://local", { method: "POST", body: "{}" }),
    );
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toContain("no-store");
  });
  it.each([
    [new UnauthenticatedError(), 401],
    [new PermissionError("PHI SECRET"), 403],
    [new ScopeError(), 404],
    [new AiError("TIMEOUT"), 503],
    [new AiError("RATE_LIMIT"), 429],
    [new Error("PHI SECRET"), 503],
  ])("sanitizes errors", async (error, status) => {
    m.service.mockRejectedValue(error);
    const r = await POST(
      new Request("http://local", { method: "POST", body: "{}" }),
    );
    expect(r.status).toBe(status);
    expect(await r.text()).not.toContain("SECRET");
    expect(r.headers.get("cache-control")).toContain("no-store");
  });
  it("rejects malformed JSON", async () =>
    expect(
      (await POST(new Request("http://local", { method: "POST", body: "bad" })))
        .status,
    ).toBe(400));
  it("bounds body before service", async () => {
    expect(
      (
        await POST(
          new Request("http://local", {
            method: "POST",
            body: "x".repeat(40001),
          }),
        )
      ).status,
    ).toBe(413);
    expect(m.service).not.toHaveBeenCalled();
  });
});
