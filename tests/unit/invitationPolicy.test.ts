import { describe, expect, it } from "vitest";
import type { InvitationStatus } from "@prisma/client";
import {
  INVITATION_ALREADY_ACCEPTED_MESSAGE,
  INVITATION_INVALID_MESSAGE,
  INVITATION_STATUS_TRANSITIONS,
  INVITATION_TTL_MS,
  canTransitionInvitationStatus,
  computeInvitationExpiry,
  describeInvitationRefusal,
  evaluateInvitation,
  isInvitationOutstanding,
  normaliseInviteEmail,
  type InvitationSnapshot,
} from "@/lib/invitationPolicy";

const NOW = new Date("2026-08-22T10:00:00.000Z");

function snapshot(overrides: Partial<InvitationSnapshot> = {}): InvitationSnapshot {
  return {
    status: "CREATED",
    expiresAt: new Date(NOW.getTime() + INVITATION_TTL_MS),
    email: "amelia@dentalcare.test",
    isTenantActive: true,
    ...overrides,
  };
}

const ALL_STATUSES: InvitationStatus[] = [
  "CREATED",
  "OPENED",
  "EXPIRED",
  "REVOKED",
  "ACCEPTED",
];

describe("the invitation lifecycle", () => {
  it("lets a fresh invitation be opened, spent, revoked or expire", () => {
    expect(canTransitionInvitationStatus("CREATED", "OPENED")).toBe(true);
    expect(canTransitionInvitationStatus("CREATED", "ACCEPTED")).toBe(true);
    expect(canTransitionInvitationStatus("CREATED", "REVOKED")).toBe(true);
    expect(canTransitionInvitationStatus("CREATED", "EXPIRED")).toBe(true);
  });

  it("keeps an opened invitation spendable", () => {
    // Following the link is not accepting it — the form still wants a password.
    expect(canTransitionInvitationStatus("OPENED", "ACCEPTED")).toBe(true);
  });

  it("makes accepted, revoked and expired terminal", () => {
    for (const terminal of ["ACCEPTED", "REVOKED", "EXPIRED"] as const) {
      expect(INVITATION_STATUS_TRANSITIONS[terminal]).toHaveLength(0);
      for (const to of ALL_STATUSES) {
        expect(canTransitionInvitationStatus(terminal, to)).toBe(false);
      }
    }
  });

  it("never allows a spent invitation to be revived", () => {
    // Reissuing is a fresh row with a fresh token. Reviving one would mean an
    // old link in an old inbox starting to work again.
    expect(canTransitionInvitationStatus("ACCEPTED", "CREATED")).toBe(false);
    expect(canTransitionInvitationStatus("REVOKED", "OPENED")).toBe(false);
    expect(canTransitionInvitationStatus("EXPIRED", "CREATED")).toBe(false);
  });

  it("never lets a status transition to itself", () => {
    for (const status of ALL_STATUSES) {
      expect(canTransitionInvitationStatus(status, status)).toBe(false);
    }
  });

  it("covers every status in the table", () => {
    for (const status of ALL_STATUSES) {
      expect(INVITATION_STATUS_TRANSITIONS[status]).toBeDefined();
    }
  });
});

describe("computeInvitationExpiry", () => {
  it("is seven days out", () => {
    expect(INVITATION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(computeInvitationExpiry(NOW).getTime()).toBe(
      NOW.getTime() + INVITATION_TTL_MS,
    );
  });

  it("does not mutate the clock it was given", () => {
    const before = NOW.getTime();
    computeInvitationExpiry(NOW);
    expect(NOW.getTime()).toBe(before);
  });
});

describe("evaluateInvitation", () => {
  it("accepts a fresh invitation into an active organisation", () => {
    expect(evaluateInvitation({ snapshot: snapshot(), now: NOW })).toEqual({
      usable: true,
      refusal: null,
    });
  });

  it("accepts one that has merely been opened", () => {
    const verdict = evaluateInvitation({
      snapshot: snapshot({ status: "OPENED" }),
      now: NOW,
    });
    expect(verdict.usable).toBe(true);
  });

  it("refuses a token that matches nothing", () => {
    expect(evaluateInvitation({ snapshot: null, now: NOW })).toEqual({
      usable: false,
      refusal: "not-found",
    });
  });

  it("refuses a revoked invitation", () => {
    expect(
      evaluateInvitation({ snapshot: snapshot({ status: "REVOKED" }), now: NOW })
        .refusal,
    ).toBe("revoked");
  });

  it("refuses one that is already spent", () => {
    expect(
      evaluateInvitation({ snapshot: snapshot({ status: "ACCEPTED" }), now: NOW })
        .refusal,
    ).toBe("already-accepted");
  });

  it("reports a spent invitation as spent even after it would have expired", () => {
    // Both are true; only one is useful to the person holding the link.
    const verdict = evaluateInvitation({
      snapshot: snapshot({
        status: "ACCEPTED",
        expiresAt: new Date(NOW.getTime() - 1),
      }),
      now: NOW,
    });
    expect(verdict.refusal).toBe("already-accepted");
  });

  it("enforces expiry on the clock, not only on the stored status", () => {
    // Nothing sweeps expired rows, so a row still marked CREATED must still be
    // refused the moment its expiry passes.
    const verdict = evaluateInvitation({
      snapshot: snapshot({ expiresAt: new Date(NOW.getTime() - 1) }),
      now: NOW,
    });
    expect(verdict.refusal).toBe("expired");
  });

  it("refuses exactly at the expiry boundary", () => {
    const verdict = evaluateInvitation({
      snapshot: snapshot({ expiresAt: NOW }),
      now: NOW,
    });
    expect(verdict.refusal).toBe("expired");
  });

  it("accepts one millisecond before the boundary", () => {
    const verdict = evaluateInvitation({
      snapshot: snapshot({ expiresAt: new Date(NOW.getTime() + 1) }),
      now: NOW,
    });
    expect(verdict.usable).toBe(true);
  });

  it("refuses a stored EXPIRED status even with time left on the clock", () => {
    const verdict = evaluateInvitation({
      snapshot: snapshot({
        status: "EXPIRED",
        expiresAt: new Date(NOW.getTime() + INVITATION_TTL_MS),
      }),
      now: NOW,
    });
    expect(verdict.refusal).toBe("expired");
  });

  it("refuses an invitation into an organisation that is not active", () => {
    // A suspended or rejected clinic cannot staff itself by mailing links.
    const verdict = evaluateInvitation({
      snapshot: snapshot({ isTenantActive: false }),
      now: NOW,
    });
    expect(verdict.refusal).toBe("tenant-inactive");
  });

  it("refuses a link-only invitation, which this stage never issues", () => {
    const verdict = evaluateInvitation({
      snapshot: snapshot({ email: null }),
      now: NOW,
    });
    expect(verdict.usable).toBe(false);
    expect(verdict.refusal).toBe("not-found");
  });

  it("never reports usable and a refusal at the same time", () => {
    const cases: (InvitationSnapshot | null)[] = [
      null,
      snapshot(),
      snapshot({ status: "REVOKED" }),
      snapshot({ status: "ACCEPTED" }),
      snapshot({ isTenantActive: false }),
      snapshot({ email: null }),
      snapshot({ expiresAt: new Date(NOW.getTime() - 1) }),
    ];

    for (const candidate of cases) {
      const verdict = evaluateInvitation({ snapshot: candidate, now: NOW });
      expect(verdict.usable).toBe(verdict.refusal === null);
    }
  });
});

describe("what a refusal is allowed to say", () => {
  it("gives the same sentence to every reason but one", () => {
    for (const refusal of ["not-found", "revoked", "expired", "tenant-inactive"] as const) {
      expect(describeInvitationRefusal(refusal)).toBe(INVITATION_INVALID_MESSAGE);
    }
  });

  it("tells someone who already accepted to sign in", () => {
    // The one disclosure, and only to whoever already holds the token.
    expect(describeInvitationRefusal("already-accepted")).toBe(
      INVITATION_ALREADY_ACCEPTED_MESSAGE,
    );
  });

  it("names no organisation, no person and no internal state", () => {
    const forbidden = [
      "suspended",
      "rejected",
      "tenant",
      "clinic",
      "revoked",
      "database",
      "prisma",
      "token",
      "hash",
    ];

    for (const copy of [INVITATION_INVALID_MESSAGE, INVITATION_ALREADY_ACCEPTED_MESSAGE]) {
      for (const word of forbidden) {
        expect(copy.toLowerCase()).not.toContain(word);
      }
    }
  });

  it("does not distinguish a revoked link from one that never existed", () => {
    // Otherwise the public page becomes an oracle for whether a token ever was.
    expect(describeInvitationRefusal("revoked")).toBe(
      describeInvitationRefusal("not-found"),
    );
  });
});

describe("isInvitationOutstanding", () => {
  const live = { status: "CREATED" as InvitationStatus, expiresAt: new Date(NOW.getTime() + 1000) };

  it("is true for a live invitation", () => {
    expect(isInvitationOutstanding(live, NOW)).toBe(true);
    expect(isInvitationOutstanding({ ...live, status: "OPENED" }, NOW)).toBe(true);
  });

  it("is false once it is spent, revoked or expired", () => {
    expect(isInvitationOutstanding({ ...live, status: "ACCEPTED" }, NOW)).toBe(false);
    expect(isInvitationOutstanding({ ...live, status: "REVOKED" }, NOW)).toBe(false);
    expect(isInvitationOutstanding({ ...live, status: "EXPIRED" }, NOW)).toBe(false);
  });

  it("is false for a row still marked CREATED whose clock has run out", () => {
    // So the list never offers to revoke something that is already dead.
    expect(
      isInvitationOutstanding(
        { status: "CREATED", expiresAt: new Date(NOW.getTime() - 1) },
        NOW,
      ),
    ).toBe(false);
  });
});

describe("normaliseInviteEmail", () => {
  it("lowercases and trims, so one address cannot be invited twice", () => {
    expect(normaliseInviteEmail("  Amelia@Clinic.COM ")).toBe("amelia@clinic.com");
  });

  it("is idempotent", () => {
    const once = normaliseInviteEmail(" A@B.com ");
    expect(normaliseInviteEmail(once)).toBe(once);
  });

  it("leaves an already-clean address alone", () => {
    expect(normaliseInviteEmail("a@b.com")).toBe("a@b.com");
  });
});
