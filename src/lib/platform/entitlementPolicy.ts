import { MAX_REASON_LENGTH, MIN_REASON_LENGTH } from "@/lib/platform/decisionPolicy";

/**
 * The rules behind an Owner's entitlement changes — Stage 9, layers 1 and 2.
 *
 * Pure: no Prisma, no session, no clock. ./entitlements.ts loads the rows,
 * calls in here for the verdict, and only then writes — so every rule below is
 * unit-testable without a database and exists in exactly one copy. Same split
 * as ./decisionPolicy.ts, which governs the Stage 3 approval flow and whose
 * reason-length constants are reused here rather than restated.
 *
 * WHAT EACH LAYER IS, AND WHY ITS FRICTION DIFFERS:
 *
 *   Layer 1 — Feature.globalEnabled. One row, every organisation on the
 *     platform. Switching it off is the largest single act available in this
 *     codebase, so it carries the most friction: a written reason in BOTH
 *     directions, plus the feature's own key typed out to confirm a switch-off.
 *
 *   Layer 2a — PlanFeature. One plan, every organisation on it. A reason is
 *     required to take a feature OUT of a plan and optional to add one, matching
 *     the Stage 3 precedent that removing access must be explained and restoring
 *     it need not be.
 *
 *   Layer 2b — TenantFeatureOverride. One organisation. Stage 1's schema makes
 *     `reason` non-null, so a reason is required whenever an override row is
 *     written, in either direction; ./decisionPolicy.ts's
 *     `resolveEntitlementChanges` decides which rows those are.
 *
 * NONE OF THIS IS AN AUTHORIZATION CHECK. `requirePlatformOwner()` is, and
 * keeping the two apart is what stops a function in this file being mistaken
 * for one.
 */

export { MAX_REASON_LENGTH, MIN_REASON_LENGTH };

export type ReasonDenial = "reason-required" | "reason-too-short" | "reason-too-long";

export interface ReasonVerdict {
  /** The text to store, trimmed, or null when none was given and none is needed. */
  value: string | null;
  denial: ReasonDenial | null;
}

/**
 * Trims and length-checks a written reason.
 *
 * Shared by all three layers so the bounds cannot drift between them, and so a
 * reason that is acceptable on one screen is acceptable on every other.
 */
export function evaluateReason(
  reason: string | null | undefined,
  required: boolean,
): ReasonVerdict {
  const trimmed = reason?.trim() ?? "";

  if (trimmed.length === 0) {
    return required
      ? { value: null, denial: "reason-required" }
      : { value: null, denial: null };
  }
  if (trimmed.length < MIN_REASON_LENGTH) {
    return { value: null, denial: "reason-too-short" };
  }
  if (trimmed.length > MAX_REASON_LENGTH) {
    return { value: null, denial: "reason-too-long" };
  }

  return { value: trimmed, denial: null };
}

// ---------------------------------------------------------------------------
// Layer 1 — the platform-wide kill switch
// ---------------------------------------------------------------------------

export type GlobalSwitchDenial =
  | ReasonDenial
  /** The switch is already in the requested position. */
  | "no-change"
  /** Switching off, and the Owner did not type the feature key. */
  | "confirmation-required"
  /** They typed something, and it was not the feature key. */
  | "confirmation-mismatch";

export interface GlobalSwitchInput {
  featureKey: string;
  currentlyEnabled: boolean;
  requestedEnabled: boolean;
  reason?: string | null;
  /** Must equal `featureKey` when switching off. Ignored when switching on. */
  confirmation?: string | null;
}

export interface GlobalSwitchEvaluation {
  allowed: boolean;
  denial: GlobalSwitchDenial | null;
  normalisedReason: string | null;
  /**
   * True when this flip takes a module away from every organisation at once.
   *
   * Exposed rather than recomputed by the caller because it is what decides
   * both the confirmation requirement here and the wording of the audit row.
   */
  isSwitchOff: boolean;
}

/**
 * Answers "may this platform-wide switch be flipped, with this reason and this
 * confirmation".
 *
 * A REASON IS REQUIRED IN BOTH DIRECTIONS, which departs from the Stage 3
 * precedent of demanding one only when access is removed. Layer 1 is different:
 * switching a feature back ON platform-wide is the end of an incident, and the
 * sentence explaining it is the one a reader wants next to the sentence that
 * started it. Stage 1's schema note anticipated this ("Stage 9 requires a reason
 * for a manual change").
 *
 * THE TYPED CONFIRMATION IS ONLY FOR SWITCHING OFF, and it is deliberately not
 * a checkbox. A checkbox is clicked reflexively next to the button that was
 * already going to be pressed; typing `registrations` requires reading which
 * feature is about to go dark for the entire platform.
 */
export function evaluateGlobalSwitch(
  input: GlobalSwitchInput,
): GlobalSwitchEvaluation {
  const isSwitchOff = !input.requestedEnabled;

  const denied = (denial: GlobalSwitchDenial): GlobalSwitchEvaluation => ({
    allowed: false,
    denial,
    normalisedReason: null,
    isSwitchOff,
  });

  // Checked first: a "change" that changes nothing would otherwise write an
  // audit row and a new reason over the one that explained the real change.
  if (input.currentlyEnabled === input.requestedEnabled) {
    return denied("no-change");
  }

  const reason = evaluateReason(input.reason, true);
  if (reason.denial) {
    return denied(reason.denial);
  }

  if (isSwitchOff) {
    const typed = input.confirmation?.trim() ?? "";
    if (typed.length === 0) {
      return denied("confirmation-required");
    }
    // Exact match, not case-insensitive: the keys are lower-case machine
    // identifiers, and accepting "Registrations" would mean the Owner typed
    // what they thought the feature was called rather than reading what it is.
    if (typed !== input.featureKey) {
      return denied("confirmation-mismatch");
    }
  }

  return {
    allowed: true,
    denial: null,
    normalisedReason: reason.value,
    isSwitchOff,
  };
}

// ---------------------------------------------------------------------------
// Layer 2a — what a plan includes
// ---------------------------------------------------------------------------

export type PlanFeatureDenial = ReasonDenial | "no-change";

export interface PlanFeatureInput {
  currentlyIncluded: boolean;
  requestedIncluded: boolean;
  reason?: string | null;
}

export interface PlanFeatureEvaluation {
  allowed: boolean;
  denial: PlanFeatureDenial | null;
  normalisedReason: string | null;
  /** True when the feature is being taken out of the plan. */
  isRemoval: boolean;
}

/**
 * Answers "may this feature be added to or removed from this plan".
 *
 * PLAN MEMBERSHIP IS TWO-STATE HERE, not three. The database can hold a
 * PlanFeature row with `enabled = false`, which is indistinguishable from no row
 * at all as far as `isTenantEntitled` is concerned — both deny, and both can be
 * overridden per tenant. Offering an Owner two ways to say the same thing would
 * be a distinction with no consequence, so "not included" deletes the row.
 *
 * A reason is required to REMOVE and optional to ADD, because a removal takes a
 * module away from every organisation on the plan the moment it commits, and
 * "why" is the first question asked afterwards.
 */
export function evaluatePlanFeature(
  input: PlanFeatureInput,
): PlanFeatureEvaluation {
  const isRemoval = input.currentlyIncluded && !input.requestedIncluded;

  const denied = (denial: PlanFeatureDenial): PlanFeatureEvaluation => ({
    allowed: false,
    denial,
    normalisedReason: null,
    isRemoval,
  });

  if (input.currentlyIncluded === input.requestedIncluded) {
    return denied("no-change");
  }

  const reason = evaluateReason(input.reason, isRemoval);
  if (reason.denial) {
    return denied(reason.denial);
  }

  return { allowed: true, denial: null, normalisedReason: reason.value, isRemoval };
}

// ---------------------------------------------------------------------------
// Turning a denial into something the Owner can act on
// ---------------------------------------------------------------------------

/**
 * One message per denial, written for the person who hit it.
 *
 * These reach a Platform Owner, not a customer, so unlike the tenant-facing
 * FEATURE_DENIAL_MESSAGES they may name the thing that is wrong — an Owner
 * being told "check the submitted values" about their own admin screen would
 * have to guess.
 */
export function describeEntitlementDenial(
  denial: GlobalSwitchDenial | PlanFeatureDenial,
  featureKey: string,
): string {
  switch (denial) {
    case "no-change":
      return "That is already the current setting.";
    case "reason-required":
      return "Give a written reason for this change.";
    case "reason-too-short":
      return `Give a reason of at least ${MIN_REASON_LENGTH} characters.`;
    case "reason-too-long":
      return `Keep the reason under ${MAX_REASON_LENGTH} characters.`;
    case "confirmation-required":
      return `Type “${featureKey}” to confirm switching it off for every organisation.`;
    case "confirmation-mismatch":
      return `That does not match. Type “${featureKey}” exactly.`;
  }
}
