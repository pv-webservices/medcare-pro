import { describe, expect, expectTypeOf, it } from "vitest";
import {
  OWNER_PLATFORM_ROLE,
  PlatformAuthorizationError,
  evaluatePlatformAccess,
  type PlatformActorContext,
  type PlatformEvaluationInput,
} from "@/lib/platform/context";
import type { ActorContext } from "@/lib/rbac";

const OWNER: PlatformEvaluationInput = {
  sessionValid: true,
  platformRole: "SUPER_ADMIN",
  accountStatus: "ACTIVE",
  required: "SUPER_ADMIN",
};

describe("evaluatePlatformAccess", () => {
  it("admits an active SUPER_ADMIN with a live session", () => {
    expect(evaluatePlatformAccess(OWNER)).toEqual({ allowed: true, reason: null });
  });

  it("refuses when the session is not live, whatever the role says", () => {
    expect(evaluatePlatformAccess({ ...OWNER, sessionValid: false }).reason).toBe("no-session");
  });

  it("refuses an ordinary clinic user", () => {
    // platformRole is null for almost everyone, which is the whole point.
    expect(evaluatePlatformAccess({ ...OWNER, platformRole: null }).reason).toBe(
      "not-platform-user",
    );
  });

  it("refuses a SUPPORT_ADMIN on an Owner route", () => {
    // No hierarchy: SUPPORT_ADMIN is a different role, not a lesser Owner.
    expect(evaluatePlatformAccess({ ...OWNER, platformRole: "SUPPORT_ADMIN" }).reason).toBe(
      "insufficient-platform-role",
    );
  });

  it("refuses a SUPER_ADMIN whose account is not active", () => {
    for (const accountStatus of ["PENDING", "SUSPENDED", "ARCHIVED"] as const) {
      expect(evaluatePlatformAccess({ ...OWNER, accountStatus }).reason).toBe("account-inactive");
    }
  });

  it("checks the session before the role, so a signed-out probe learns nothing", () => {
    const signedOutOwner = { ...OWNER, sessionValid: false, platformRole: null };
    expect(evaluatePlatformAccess(signedOutOwner).reason).toBe("no-session");
  });

  it("demands the required role exactly, when a route asks for SUPPORT_ADMIN", () => {
    const support = { ...OWNER, platformRole: "SUPPORT_ADMIN", required: "SUPPORT_ADMIN" } as const;
    expect(evaluatePlatformAccess(support).allowed).toBe(true);
    expect(evaluatePlatformAccess({ ...support, platformRole: "SUPER_ADMIN" }).allowed).toBe(false);
  });

  it("targets SUPER_ADMIN for the /owner surface", () => {
    expect(OWNER_PLATFORM_ROLE).toBe("SUPER_ADMIN");
  });
});

describe("the Owner is not governed by tenant-level approval", () => {
  it("does not accept a membershipStatus at all", () => {
    // Structural proof of the Stage 1 rule: a Tenant Admin who could reach the
    // membership column of the reserved platform tenant must not thereby be
    // able to lock the Owner out. The decision cannot consult a field its input
    // type does not have.
    expectTypeOf<PlatformEvaluationInput>().not.toHaveProperty("membershipStatus");
    expectTypeOf<PlatformEvaluationInput>().not.toHaveProperty("tenantStatus");
    expectTypeOf<PlatformEvaluationInput>().not.toHaveProperty("tenantId");
  });

  it("admits an Owner regardless of any tenant-side state, since none is an input", () => {
    expect(evaluatePlatformAccess({ ...OWNER })).toEqual({ allowed: true, reason: null });
  });
});

describe("the platform context cannot reach tenant-scoped code", () => {
  it("carries no tenantId", () => {
    expectTypeOf<PlatformActorContext>().not.toHaveProperty("tenantId");
  });

  it("is not assignable to ActorContext", () => {
    const owner: PlatformActorContext = {
      userId: "u1",
      platformRole: "SUPER_ADMIN",
      sessionId: "s1",
    };

    // @ts-expect-error - a PlatformActorContext has no tenantId, so it can
    // never be passed to lib/rbac.ts or any other tenant-scoped function.
    // If this line ever compiles, the boundary has been broken.
    const asTenantActor: ActorContext = owner;
    expect(asTenantActor).toBeDefined();
  });

  it("does not accept a tenant actor either, so the two cannot be swapped", () => {
    const staff: ActorContext = { userId: "u2", tenantId: "t2" };

    // @ts-expect-error - and the reverse: a clinic user's context is not a
    // platform context, so tenant code cannot fabricate Owner access.
    const asPlatformActor: PlatformActorContext = staff;
    expect(asPlatformActor).toBeDefined();
  });
});

describe("PlatformAuthorizationError", () => {
  it("says nothing about which gate refused", () => {
    const reasons = ["no-session", "not-platform-user", "account-inactive"] as const;
    const messages = new Set(reasons.map((reason) => new PlatformAuthorizationError(reason).message));

    // One message for every cause: "signed in but not an Owner" and "no such
    // route" must be indistinguishable to a customer probing the surface.
    expect(messages.size).toBe(1);
    expect([...messages][0]).toBe("Not found.");
  });

  it("keeps the reason for server-side logging", () => {
    expect(new PlatformAuthorizationError("account-inactive").reason).toBe("account-inactive");
  });
});
