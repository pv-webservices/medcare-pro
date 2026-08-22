import { canTransitionTenantStatus } from "@/lib/accessStatus";
import type { TenantStatus } from "@prisma/client";

/**
 * The rules behind an Owner's decision on a clinic application — Stage 3.
 *
 * Pure: no Prisma, no session, no clock. The write module (./decisions.ts) loads
 * the rows, calls in here for the verdict, and only then touches the database —
 * so every rule below is unit-testable without a database, and there is exactly
 * one copy of each.
 *
 * WHY THE FOUR DECISIONS ARE NOT JUST "SET THE STATUS": each one is legal from
 * one starting state only. Without that, "approve" would silently un-suspend a
 * clinic an Owner had suspended for cause, and "reactivate" would approve an
 * application nobody had reviewed. Both would then be recorded under the wrong
 * action name in a log that is never edited afterwards.
 */

export const CLINIC_DECISIONS = {
  APPROVE: "APPROVE",
  REJECT: "REJECT",
  SUSPEND: "SUSPEND",
  REACTIVATE: "REACTIVATE",
} as const;

export type ClinicDecision =
  (typeof CLINIC_DECISIONS)[keyof typeof CLINIC_DECISIONS];

export function isClinicDecision(value: unknown): value is ClinicDecision {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(CLINIC_DECISIONS, value)
  );
}

export const DECISION_TARGET_STATUS: Record<ClinicDecision, TenantStatus> = {
  APPROVE: "ACTIVE",
  REJECT: "REJECTED",
  SUSPEND: "SUSPENDED",
  REACTIVATE: "ACTIVE",
};

/** The only starting state each decision may be taken from. */
export const DECISION_ALLOWED_FROM: Record<
  ClinicDecision,
  readonly TenantStatus[]
> = {
  APPROVE: ["PENDING"],
  REJECT: ["PENDING"],
  SUSPEND: ["ACTIVE"],
  REACTIVATE: ["SUSPENDED"],
};

/**
 * Stage 3 item 7 requires a reason for a rejection. Suspension carries the same
 * requirement for the same reason: it removes access from people who were using
 * the product, and "why" is the first question asked afterwards.
 *
 * Approval and reactivation restore access rather than remove it, so a reason is
 * accepted but not demanded.
 */
export const DECISION_REQUIRES_REASON: Record<ClinicDecision, boolean> = {
  APPROVE: false,
  REJECT: true,
  SUSPEND: true,
  REACTIVATE: false,
};

/** Long enough to be a sentence; short enough for a TEXT column and an email. */
export const MIN_REASON_LENGTH = 10;
export const MAX_REASON_LENGTH = 1000;

export type DecisionDenialReason =
  | "unknown-decision"
  | "reason-required"
  | "reason-too-short"
  | "reason-too-long"
  | "wrong-starting-status"
  | "illegal-transition"
  | null;

export interface DecisionEvaluation {
  allowed: boolean;
  reason: DecisionDenialReason;
  /** Only meaningful when `allowed` — the status to write. */
  targetStatus: TenantStatus | null;
  /** The reason text to store, trimmed, or null when none was given. */
  normalisedReason: string | null;
}

export interface DecisionEvaluationInput {
  decision: unknown;
  currentStatus: TenantStatus;
  reason?: string | null;
}

/**
 * Answers "may this decision be taken on a clinic in this state, with this
 * reason". It does NOT answer "is the caller an Owner" — that is
 * requirePlatformOwner()'s job, and keeping the two apart is what stops this
 * function being mistaken for an authorization check.
 */
export function evaluateDecision(
  input: DecisionEvaluationInput,
): DecisionEvaluation {
  const denied = (reason: DecisionDenialReason): DecisionEvaluation => ({
    allowed: false,
    reason,
    targetStatus: null,
    normalisedReason: null,
  });

  if (!isClinicDecision(input.decision)) {
    return denied("unknown-decision");
  }

  const decision = input.decision;
  const trimmed = input.reason?.trim() ?? "";
  const normalisedReason = trimmed.length > 0 ? trimmed : null;

  if (DECISION_REQUIRES_REASON[decision] && normalisedReason === null) {
    return denied("reason-required");
  }
  if (normalisedReason !== null && normalisedReason.length < MIN_REASON_LENGTH) {
    return denied("reason-too-short");
  }
  if (normalisedReason !== null && normalisedReason.length > MAX_REASON_LENGTH) {
    return denied("reason-too-long");
  }

  if (!DECISION_ALLOWED_FROM[decision].includes(input.currentStatus)) {
    return denied("wrong-starting-status");
  }

  const targetStatus = DECISION_TARGET_STATUS[decision];

  // Belt to the braces above: the same transition table that governs every
  // other status change in the app has to agree. If the two ever disagree, the
  // answer is no.
  if (!canTransitionTenantStatus(input.currentStatus, targetStatus)) {
    return denied("illegal-transition");
  }

  return { allowed: true, reason: null, targetStatus, normalisedReason };
}

// ---------------------------------------------------------------------------
// Feature entitlements — Stage 3 item 9.
// ---------------------------------------------------------------------------

export interface EntitlementRequest {
  featureKey: string;
  enabled: boolean;
}

export interface EntitlementChanges {
  /** Overrides to write: the choice differs from the plan default. */
  overridesToSet: readonly EntitlementRequest[];
  /**
   * Override rows to delete: the choice now matches the plan, so the row would
   * say nothing. Deleting keeps the tenant tracking its plan if the plan changes
   * later, which a redundant override would silently prevent.
   */
  overridesToClear: readonly string[];
  /** Requested keys that are not in the catalogue. Any entry means refuse. */
  unknownFeatureKeys: readonly string[];
  /** True when an override is being written — Stage 1 requires a reason then. */
  requiresReason: boolean;
}

export interface EntitlementInput {
  requested: readonly EntitlementRequest[];
  /** Feature key to enabled, from PlanFeature. An absent key is not in the plan. */
  planDefaults: ReadonlyMap<string, boolean>;
  /** Every feature key that exists. */
  catalogue: ReadonlySet<string>;
  /** Feature key to enabled, from the tenant's TenantFeatureOverride rows. */
  existingOverrides: ReadonlyMap<string, boolean>;
}

/**
 * Turns "here is what the Owner ticked" into the minimum set of override rows.
 *
 * A feature the caller did not mention is left exactly as it is. That makes a
 * partial submission safe: an Owner toggling one feature cannot accidentally
 * clear entitlements that were not on their screen.
 *
 * `planDefaults.get(key) ?? false` — a feature absent from the plan resolves to
 * "not entitled", matching `isTenantEntitled` in lib/featureResolution.ts.
 */
export function resolveEntitlementChanges(
  input: EntitlementInput,
): EntitlementChanges {
  const overridesToSet: EntitlementRequest[] = [];
  const overridesToClear: string[] = [];
  const unknownFeatureKeys: string[] = [];

  const seen = new Set<string>();

  for (const entry of input.requested) {
    if (!input.catalogue.has(entry.featureKey)) {
      unknownFeatureKeys.push(entry.featureKey);
      continue;
    }
    // A duplicated key in one request is a malformed request, not a merge
    // problem — the last value would silently win. Refuse it the same way an
    // unknown key is refused.
    if (seen.has(entry.featureKey)) {
      unknownFeatureKeys.push(entry.featureKey);
      continue;
    }
    seen.add(entry.featureKey);

    const planDefault = input.planDefaults.get(entry.featureKey) ?? false;
    const hasOverride = input.existingOverrides.has(entry.featureKey);

    if (entry.enabled === planDefault) {
      if (hasOverride) {
        overridesToClear.push(entry.featureKey);
      }
      continue;
    }

    // Already overridden to exactly this value: nothing to write, and rewriting
    // would replace a considered reason with a fresh one for no change.
    if (input.existingOverrides.get(entry.featureKey) === entry.enabled) {
      continue;
    }

    overridesToSet.push(entry);
  }

  return {
    overridesToSet,
    overridesToClear,
    unknownFeatureKeys,
    requiresReason: overridesToSet.length > 0,
  };
}
