import { describe, expect, it } from "vitest";
import {
  ACCOUNT_STATUS_TRANSITIONS,
  canTransitionAccountStatus,
  canTransitionMembershipStatus,
  canTransitionTenantStatus,
  evaluateAccessStatus,
  isAccessAllowed,
  MEMBERSHIP_STATUS_TRANSITIONS,
  TENANT_STATUS_TRANSITIONS,
} from "@/lib/accessStatus";

const ACTIVE = {
  tenantStatus: "ACTIVE",
  accountStatus: "ACTIVE",
  membershipStatus: "ACTIVE",
} as const;

describe("isAccessAllowed", () => {
  it("allows only when all three statuses are ACTIVE", () => {
    expect(isAccessAllowed(ACTIVE)).toBe(true);
  });

  it("refuses when the organisation is not active", () => {
    for (const tenantStatus of ["PENDING", "SUSPENDED", "REJECTED", "ARCHIVED"] as const) {
      expect(isAccessAllowed({ ...ACTIVE, tenantStatus })).toBe(false);
    }
  });

  it("refuses when the platform account is not active", () => {
    for (const accountStatus of ["PENDING", "SUSPENDED", "ARCHIVED"] as const) {
      expect(isAccessAllowed({ ...ACTIVE, accountStatus })).toBe(false);
    }
  });

  it("refuses when the tenant membership is not active", () => {
    for (const membershipStatus of [
      "PENDING",
      "SUSPENDED",
      "REJECTED",
      "REMOVED",
    ] as const) {
      expect(isAccessAllowed({ ...ACTIVE, membershipStatus })).toBe(false);
    }
  });
});

describe("the two statuses are independent gates", () => {
  // This is the whole reason accountStatus and membershipStatus are separate
  // columns. If either could rescue the other, whoever writes one could undo
  // the other party's suspension.
  it("an ACTIVE membership does not rescue an Owner-suspended account", () => {
    expect(
      isAccessAllowed({
        tenantStatus: "ACTIVE",
        accountStatus: "SUSPENDED",
        membershipStatus: "ACTIVE",
      }),
    ).toBe(false);
  });

  it("an ACTIVE account does not rescue a Tenant-Admin-suspended membership", () => {
    expect(
      isAccessAllowed({
        tenantStatus: "ACTIVE",
        accountStatus: "ACTIVE",
        membershipStatus: "SUSPENDED",
      }),
    ).toBe(false);
  });

  it("an ACTIVE user of any kind does not survive a suspended organisation", () => {
    expect(isAccessAllowed({ ...ACTIVE, tenantStatus: "SUSPENDED" })).toBe(false);
  });
});

describe("evaluateAccessStatus reports the broadest failing gate first", () => {
  it("names the tenant when everything is suspended at once", () => {
    expect(
      evaluateAccessStatus({
        tenantStatus: "SUSPENDED",
        accountStatus: "SUSPENDED",
        membershipStatus: "SUSPENDED",
      }),
    ).toEqual({ allowed: false, reason: "tenant" });
  });

  it("names the account before the membership", () => {
    expect(
      evaluateAccessStatus({
        tenantStatus: "ACTIVE",
        accountStatus: "SUSPENDED",
        membershipStatus: "SUSPENDED",
      }),
    ).toEqual({ allowed: false, reason: "account" });
  });

  it("returns no reason when access is allowed", () => {
    expect(evaluateAccessStatus(ACTIVE)).toEqual({ allowed: true, reason: null });
  });
});

describe("status transitions", () => {
  it("allows the Owner to suspend and reactivate an account", () => {
    expect(canTransitionAccountStatus("ACTIVE", "SUSPENDED")).toBe(true);
    expect(canTransitionAccountStatus("SUSPENDED", "ACTIVE")).toBe(true);
  });

  it("allows the Owner to suspend and reactivate an organisation", () => {
    expect(canTransitionTenantStatus("ACTIVE", "SUSPENDED")).toBe(true);
    expect(canTransitionTenantStatus("SUSPENDED", "ACTIVE")).toBe(true);
  });

  it("allows the Tenant Admin to approve, reject, suspend and reinstate", () => {
    expect(canTransitionMembershipStatus("PENDING", "ACTIVE")).toBe(true);
    expect(canTransitionMembershipStatus("PENDING", "REJECTED")).toBe(true);
    expect(canTransitionMembershipStatus("ACTIVE", "SUSPENDED")).toBe(true);
    expect(canTransitionMembershipStatus("SUSPENDED", "ACTIVE")).toBe(true);
  });

  it("does not let a rejected applicant be flipped straight to active", () => {
    // Re-admitting a rejected applicant is a fresh decision with its own audit
    // trail, not a status flip.
    expect(canTransitionMembershipStatus("REJECTED", "ACTIVE")).toBe(false);
    expect(canTransitionTenantStatus("REJECTED", "ACTIVE")).toBe(false);
  });

  it("treats ARCHIVED and REMOVED as terminal", () => {
    expect(ACCOUNT_STATUS_TRANSITIONS.ARCHIVED).toHaveLength(0);
    expect(TENANT_STATUS_TRANSITIONS.ARCHIVED).toHaveLength(0);
    expect(MEMBERSHIP_STATUS_TRANSITIONS.REMOVED).toHaveLength(0);
  });

  it("rejects a no-op transition, so an identical audit entry is never written", () => {
    expect(canTransitionAccountStatus("ACTIVE", "ACTIVE")).toBe(false);
    expect(canTransitionMembershipStatus("ACTIVE", "ACTIVE")).toBe(false);
    expect(canTransitionTenantStatus("ACTIVE", "ACTIVE")).toBe(false);
  });

  it("never lists a status as a transition to itself", () => {
    for (const [from, targets] of Object.entries(ACCOUNT_STATUS_TRANSITIONS)) {
      expect(targets).not.toContain(from);
    }
    for (const [from, targets] of Object.entries(MEMBERSHIP_STATUS_TRANSITIONS)) {
      expect(targets).not.toContain(from);
    }
    for (const [from, targets] of Object.entries(TENANT_STATUS_TRANSITIONS)) {
      expect(targets).not.toContain(from);
    }
  });

  it("keeps every named target reachable as a source, so no state is a dead end by accident", () => {
    const sources = new Set(Object.keys(MEMBERSHIP_STATUS_TRANSITIONS));
    for (const targets of Object.values(MEMBERSHIP_STATUS_TRANSITIONS)) {
      for (const target of targets) {
        expect(sources.has(target)).toBe(true);
      }
    }
  });
});
