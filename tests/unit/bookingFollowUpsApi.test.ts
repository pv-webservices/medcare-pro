import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScopeError, type ActorContext } from "@/lib/rbac";

const mocks = vi.hoisted(() => ({
  requireActor: vi.fn(),
  resolve: vi.fn(),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));

vi.mock("@/lib/session", () => ({
  requireActor: mocks.requireActor,
  UnauthenticatedError: mocks.UnauthenticatedError,
}));
vi.mock("@/lib/telephony/bookingFollowUps", () => ({
  resolveTelephonyBookingFollowUpForActor: mocks.resolve,
}));

import { POST } from "@/app/api/clinics/[id]/telephony/booking-follow-ups/[requestId]/resolve/route";

const ACTOR: ActorContext = { userId: "user-a", tenantId: "tenant-a" };
const context = (clinicId = "clinic-a", requestId = "request-a") => ({
  params: Promise.resolve({ id: clinicId, requestId }),
});

describe("POST booking follow-up resolve", () => {
  beforeEach(() => {
    mocks.requireActor.mockReset().mockResolvedValue(ACTOR);
    mocks.resolve.mockReset().mockResolvedValue({
      id: "request-a",
      status: "RESOLVED",
    });
  });

  it("derives the actor from session and scope only from URL segments", async () => {
    const response = await POST(
      new Request(
        "https://app.example/api/test?tenantId=tenant-b&clinicId=clinic-b",
        { method: "POST" },
      ),
      context(),
    );
    expect(response.status).toBe(200);
    expect(mocks.resolve).toHaveBeenCalledWith(
      ACTOR,
      "clinic-a",
      "request-a",
    );
  });

  it("returns non-enumerable not-found for a cross-scope request", async () => {
    mocks.resolve.mockRejectedValueOnce(new ScopeError());
    const response = await POST(
      new Request("https://app.example/api/test", { method: "POST" }),
      context("clinic-b", "request-b"),
    );
    expect(response.status).toBe(404);
  });
});
