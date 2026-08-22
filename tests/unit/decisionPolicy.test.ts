import { describe, expect, it } from "vitest";
import {
  CLINIC_DECISIONS,
  DECISION_REQUIRES_REASON,
  MAX_REASON_LENGTH,
  MIN_REASON_LENGTH,
  evaluateDecision,
  isClinicDecision,
  resolveEntitlementChanges,
} from "@/lib/platform/decisionPolicy";
import type { TenantStatus } from "@prisma/client";

const REASON = "Duplicate of an existing registration.";

describe("isClinicDecision", () => {
  it("accepts exactly the four decisions", () => {
    expect(isClinicDecision("APPROVE")).toBe(true);
    expect(isClinicDecision("REJECT")).toBe(true);
    expect(isClinicDecision("SUSPEND")).toBe(true);
    expect(isClinicDecision("REACTIVATE")).toBe(true);
  });

  it("rejects anything else, including inherited object keys", () => {
    expect(isClinicDecision("ARCHIVE")).toBe(false);
    expect(isClinicDecision("approve")).toBe(false);
    expect(isClinicDecision(null)).toBe(false);
    expect(isClinicDecision(42)).toBe(false);
    // hasOwnProperty, not `in` — "toString" must not read as a decision.
    expect(isClinicDecision("toString")).toBe(false);
  });
});

describe("evaluateDecision", () => {
  it("approves a pending application", () => {
    const verdict = evaluateDecision({
      decision: CLINIC_DECISIONS.APPROVE,
      currentStatus: "PENDING",
    });
    expect(verdict.allowed).toBe(true);
    expect(verdict.targetStatus).toBe("ACTIVE");
    expect(verdict.normalisedReason).toBeNull();
  });

  it("requires a reason to reject or suspend", () => {
    expect(DECISION_REQUIRES_REASON.REJECT).toBe(true);
    expect(DECISION_REQUIRES_REASON.SUSPEND).toBe(true);

    expect(
      evaluateDecision({ decision: "REJECT", currentStatus: "PENDING" }).reason,
    ).toBe("reason-required");
    expect(
      evaluateDecision({
        decision: "SUSPEND",
        currentStatus: "ACTIVE",
        reason: "   ",
      }).reason,
    ).toBe("reason-required");
  });

  it("enforces the reason length bounds", () => {
    expect(
      evaluateDecision({
        decision: "REJECT",
        currentStatus: "PENDING",
        reason: "too short",
      }).reason,
    ).toBe("reason-too-short");

    expect(
      evaluateDecision({
        decision: "REJECT",
        currentStatus: "PENDING",
        reason: "x".repeat(MAX_REASON_LENGTH + 1),
      }).reason,
    ).toBe("reason-too-long");

    expect(
      evaluateDecision({
        decision: "REJECT",
        currentStatus: "PENDING",
        reason: "x".repeat(MIN_REASON_LENGTH),
      }).allowed,
    ).toBe(true);
  });

  it("trims the stored reason", () => {
    const verdict = evaluateDecision({
      decision: "REJECT",
      currentStatus: "PENDING",
      reason: `  ${REASON}  `,
    });
    expect(verdict.normalisedReason).toBe(REASON);
  });

  it("accepts an optional reason on an approval", () => {
    const verdict = evaluateDecision({
      decision: "APPROVE",
      currentStatus: "PENDING",
      reason: "Verified over the phone.",
    });
    expect(verdict.allowed).toBe(true);
    expect(verdict.normalisedReason).toBe("Verified over the phone.");
  });

  it("refuses to approve anything that is not pending", () => {
    // The point of the starting-state table: approving a SUSPENDED clinic would
    // un-suspend it, under the wrong action name, in an append-only log.
    for (const status of [
      "ACTIVE",
      "SUSPENDED",
      "REJECTED",
      "ARCHIVED",
    ] as TenantStatus[]) {
      const verdict = evaluateDecision({ decision: "APPROVE", currentStatus: status });
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toBe("wrong-starting-status");
    }
  });

  it("refuses to reactivate anything that is not suspended", () => {
    for (const status of [
      "PENDING",
      "ACTIVE",
      "REJECTED",
      "ARCHIVED",
    ] as TenantStatus[]) {
      expect(
        evaluateDecision({ decision: "REACTIVATE", currentStatus: status }).allowed,
      ).toBe(false);
    }
    expect(
      evaluateDecision({ decision: "REACTIVATE", currentStatus: "SUSPENDED" })
        .targetStatus,
    ).toBe("ACTIVE");
  });

  it("refuses to suspend anything that is not active", () => {
    for (const status of [
      "PENDING",
      "SUSPENDED",
      "REJECTED",
      "ARCHIVED",
    ] as TenantStatus[]) {
      expect(
        evaluateDecision({
          decision: "SUSPEND",
          currentStatus: status,
          reason: REASON,
        }).allowed,
      ).toBe(false);
    }
  });

  it("refuses an unknown decision before looking at anything else", () => {
    const verdict = evaluateDecision({
      decision: "DELETE",
      currentStatus: "PENDING",
    });
    expect(verdict.reason).toBe("unknown-decision");
    expect(verdict.targetStatus).toBeNull();
  });

  it("never returns a target status when it refuses", () => {
    const refusals = [
      { decision: "DELETE", currentStatus: "PENDING" as TenantStatus },
      { decision: "REJECT", currentStatus: "ACTIVE" as TenantStatus, reason: REASON },
      { decision: "SUSPEND", currentStatus: "PENDING" as TenantStatus },
    ];
    for (const input of refusals) {
      const verdict = evaluateDecision(input);
      expect(verdict.allowed).toBe(false);
      expect(verdict.targetStatus).toBeNull();
      expect(verdict.normalisedReason).toBeNull();
    }
  });
});

describe("resolveEntitlementChanges", () => {
  const catalogue = new Set(["registrations", "reports", "whatsapp"]);

  it("writes an override only where the choice differs from the plan", () => {
    const changes = resolveEntitlementChanges({
      requested: [
        { featureKey: "registrations", enabled: true },
        { featureKey: "reports", enabled: false },
      ],
      planDefaults: new Map([
        ["registrations", true],
        ["reports", true],
      ]),
      catalogue,
      existingOverrides: new Map(),
    });

    expect(changes.overridesToSet).toEqual([
      { featureKey: "reports", enabled: false },
    ]);
    expect(changes.overridesToClear).toEqual([]);
    expect(changes.requiresReason).toBe(true);
  });

  it("treats a feature the plan omits as not entitled", () => {
    const changes = resolveEntitlementChanges({
      requested: [{ featureKey: "whatsapp", enabled: true }],
      planDefaults: new Map(),
      catalogue,
      existingOverrides: new Map(),
    });
    expect(changes.overridesToSet).toEqual([
      { featureKey: "whatsapp", enabled: true },
    ]);
  });

  it("clears an override that has come back into line with the plan", () => {
    const changes = resolveEntitlementChanges({
      requested: [{ featureKey: "reports", enabled: true }],
      planDefaults: new Map([["reports", true]]),
      catalogue,
      existingOverrides: new Map([["reports", false]]),
    });

    expect(changes.overridesToClear).toEqual(["reports"]);
    expect(changes.overridesToSet).toEqual([]);
    // Nothing is being written, so no explanation is demanded.
    expect(changes.requiresReason).toBe(false);
  });

  it("rewrites nothing when the existing override already says this", () => {
    const changes = resolveEntitlementChanges({
      requested: [{ featureKey: "reports", enabled: false }],
      planDefaults: new Map([["reports", true]]),
      catalogue,
      existingOverrides: new Map([["reports", false]]),
    });

    expect(changes.overridesToSet).toEqual([]);
    expect(changes.overridesToClear).toEqual([]);
    expect(changes.requiresReason).toBe(false);
  });

  it("leaves features the request did not mention alone", () => {
    const changes = resolveEntitlementChanges({
      requested: [{ featureKey: "reports", enabled: false }],
      planDefaults: new Map([
        ["registrations", true],
        ["reports", true],
        ["whatsapp", true],
      ]),
      catalogue,
      existingOverrides: new Map([["whatsapp", false]]),
    });

    expect(changes.overridesToClear).toEqual([]);
    expect(changes.overridesToSet).toEqual([
      { featureKey: "reports", enabled: false },
    ]);
  });

  it("reports an unknown key rather than silently dropping it", () => {
    const changes = resolveEntitlementChanges({
      requested: [{ featureKey: "billing", enabled: true }],
      planDefaults: new Map(),
      catalogue,
      existingOverrides: new Map(),
    });
    expect(changes.unknownFeatureKeys).toEqual(["billing"]);
    expect(changes.overridesToSet).toEqual([]);
  });

  it("reports a duplicated key instead of letting the last value win", () => {
    const changes = resolveEntitlementChanges({
      requested: [
        { featureKey: "reports", enabled: false },
        { featureKey: "reports", enabled: true },
      ],
      planDefaults: new Map([["reports", true]]),
      catalogue,
      existingOverrides: new Map(),
    });
    expect(changes.unknownFeatureKeys).toEqual(["reports"]);
  });
});
