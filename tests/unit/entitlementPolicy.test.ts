import { describe, expect, it } from "vitest";
import {
  MAX_REASON_LENGTH,
  MIN_REASON_LENGTH,
  describeEntitlementDenial,
  evaluateGlobalSwitch,
  evaluatePlanFeature,
  evaluateReason,
} from "@/lib/platform/entitlementPolicy";

/**
 * The Owner's entitlement rules — Stage 9, layers 1 and 2.
 *
 * Every case here is a rule that, if it broke, would break quietly: a kill
 * switch that flipped without confirmation, a plan feature removed with no
 * record of why, a no-op write overwriting the reason that explained the real
 * change. None of them throws on its own.
 */

const REASON = "BSP outage — suspending outbound messaging until resolved";

describe("evaluateReason", () => {
  it("trims, and returns the stored text", () => {
    expect(evaluateReason(`  ${REASON}  `, true)).toEqual({
      value: REASON,
      denial: null,
    });
  });

  it("treats whitespace as absent", () => {
    // Otherwise a required reason could be satisfied with a space bar.
    expect(evaluateReason("   ", true).denial).toBe("reason-required");
    expect(evaluateReason("   ", false)).toEqual({ value: null, denial: null });
  });

  it("accepts nothing when nothing is required", () => {
    expect(evaluateReason(null, false)).toEqual({ value: null, denial: null });
    expect(evaluateReason(undefined, false)).toEqual({ value: null, denial: null });
  });

  it("still length-checks an optional reason that was given", () => {
    // "optional" means "you need not explain", not "explain badly".
    expect(evaluateReason("too short", false).denial).toBe("reason-too-short");
  });

  it("rejects a reason longer than the column", () => {
    expect(evaluateReason("x".repeat(MAX_REASON_LENGTH + 1), true).denial).toBe(
      "reason-too-long",
    );
    expect(evaluateReason("x".repeat(MAX_REASON_LENGTH), true).denial).toBeNull();
  });

  it("accepts a reason of exactly the minimum length", () => {
    expect(evaluateReason("x".repeat(MIN_REASON_LENGTH), true).denial).toBeNull();
    expect(evaluateReason("x".repeat(MIN_REASON_LENGTH - 1), true).denial).toBe(
      "reason-too-short",
    );
  });
});

describe("evaluateGlobalSwitch", () => {
  const OFF = {
    featureKey: "whatsapp",
    currentlyEnabled: true,
    requestedEnabled: false,
    reason: REASON,
    confirmation: "whatsapp",
  };

  it("allows a switch-off with a reason and the key typed out", () => {
    const verdict = evaluateGlobalSwitch(OFF);
    expect(verdict.allowed).toBe(true);
    expect(verdict.isSwitchOff).toBe(true);
    expect(verdict.normalisedReason).toBe(REASON);
  });

  it("refuses a switch-off with no confirmation", () => {
    expect(evaluateGlobalSwitch({ ...OFF, confirmation: undefined }).denial).toBe(
      "confirmation-required",
    );
    expect(evaluateGlobalSwitch({ ...OFF, confirmation: "  " }).denial).toBe(
      "confirmation-required",
    );
  });

  it("refuses a confirmation naming a different feature", () => {
    // The whole point of the step: it cannot be satisfied without reading which
    // feature is about to go dark for the entire platform.
    expect(evaluateGlobalSwitch({ ...OFF, confirmation: "reports" }).denial).toBe(
      "confirmation-mismatch",
    );
  });

  it("refuses a confirmation with the wrong case", () => {
    // Keys are lower-case machine identifiers. Accepting "WhatsApp" would mean
    // the Owner typed what they thought it was called, not what it is.
    expect(evaluateGlobalSwitch({ ...OFF, confirmation: "WhatsApp" }).denial).toBe(
      "confirmation-mismatch",
    );
  });

  it("tolerates surrounding whitespace in the confirmation", () => {
    // Pasting a key picks up a space often enough that refusing would train
    // people to retype rather than read.
    expect(
      evaluateGlobalSwitch({ ...OFF, confirmation: "  whatsapp " }).allowed,
    ).toBe(true);
  });

  it("requires a reason when switching OFF", () => {
    expect(evaluateGlobalSwitch({ ...OFF, reason: null }).denial).toBe(
      "reason-required",
    );
  });

  it("requires a reason when switching ON as well", () => {
    // Departs from the Stage 3 precedent deliberately: restoring a feature
    // platform-wide is the end of an incident, and the sentence explaining it
    // belongs beside the sentence that started it.
    const verdict = evaluateGlobalSwitch({
      featureKey: "whatsapp",
      currentlyEnabled: false,
      requestedEnabled: true,
      reason: null,
    });
    expect(verdict.denial).toBe("reason-required");
    expect(verdict.isSwitchOff).toBe(false);
  });

  it("needs no confirmation to switch ON", () => {
    expect(
      evaluateGlobalSwitch({
        featureKey: "whatsapp",
        currentlyEnabled: false,
        requestedEnabled: true,
        reason: "BSP outage resolved — messaging restored",
      }).allowed,
    ).toBe(true);
  });

  it("refuses a change that changes nothing, before checking anything else", () => {
    // Checked first on purpose: a no-op that got through would still stamp a
    // fresh reason over the one that explained the real change.
    const verdict = evaluateGlobalSwitch({
      featureKey: "whatsapp",
      currentlyEnabled: true,
      requestedEnabled: true,
      reason: null,
      confirmation: null,
    });
    expect(verdict.denial).toBe("no-change");
  });

  it("checks the reason before the confirmation", () => {
    // So an Owner who typed the key but wrote nothing is told about the reason
    // rather than being sent back to a field they already filled in.
    expect(evaluateGlobalSwitch({ ...OFF, reason: null }).denial).toBe(
      "reason-required",
    );
  });
});

describe("evaluatePlanFeature", () => {
  it("adds a feature without demanding a reason", () => {
    const verdict = evaluatePlanFeature({
      currentlyIncluded: false,
      requestedIncluded: true,
    });
    expect(verdict.allowed).toBe(true);
    expect(verdict.isRemoval).toBe(false);
    expect(verdict.normalisedReason).toBeNull();
  });

  it("demands a reason to remove one", () => {
    // A removal takes a module from every organisation on the plan the moment
    // it commits, and "why" is the first question asked afterwards.
    const verdict = evaluatePlanFeature({
      currentlyIncluded: true,
      requestedIncluded: false,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.denial).toBe("reason-required");
    expect(verdict.isRemoval).toBe(true);
  });

  it("allows a removal that carries one", () => {
    const verdict = evaluatePlanFeature({
      currentlyIncluded: true,
      requestedIncluded: false,
      reason: "Moved to the premium plan from the 1st",
    });
    expect(verdict.allowed).toBe(true);
    expect(verdict.normalisedReason).toBe("Moved to the premium plan from the 1st");
  });

  it("refuses a change that changes nothing, in both directions", () => {
    expect(
      evaluatePlanFeature({ currentlyIncluded: true, requestedIncluded: true })
        .denial,
    ).toBe("no-change");
    expect(
      evaluatePlanFeature({ currentlyIncluded: false, requestedIncluded: false })
        .denial,
    ).toBe("no-change");
  });
});

describe("what a refusal tells the Owner", () => {
  it("names the feature key in both confirmation messages", () => {
    // These reach a Platform Owner on their own admin screen, not a customer,
    // so unlike FEATURE_DENIAL_MESSAGES they may say exactly what is wrong.
    expect(describeEntitlementDenial("confirmation-required", "reports")).toContain(
      "reports",
    );
    expect(describeEntitlementDenial("confirmation-mismatch", "reports")).toContain(
      "reports",
    );
  });

  it("quotes the actual bounds rather than saying “too short”", () => {
    expect(describeEntitlementDenial("reason-too-short", "reports")).toContain(
      String(MIN_REASON_LENGTH),
    );
    expect(describeEntitlementDenial("reason-too-long", "reports")).toContain(
      String(MAX_REASON_LENGTH),
    );
  });

  it("has a distinct message for every denial", () => {
    const denials = [
      "no-change",
      "reason-required",
      "reason-too-short",
      "reason-too-long",
      "confirmation-required",
      "confirmation-mismatch",
    ] as const;

    const messages = denials.map((denial) =>
      describeEntitlementDenial(denial, "reports"),
    );
    expect(new Set(messages).size).toBe(messages.length);
  });
});
