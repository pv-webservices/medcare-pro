/**
 * Append-only audit trail — Stage 2 onwards, PRD §9.
 *
 * `audit_logs` rows are written and never updated or deleted, the same contract
 * `registration_edit_log` already keeps. Both actor foreign keys are RESTRICT,
 * so a user or tenant that appears in the trail cannot be hard-deleted out from
 * under it; they are ARCHIVED instead.
 *
 * WHAT MUST NEVER REACH THIS TABLE (Stage 1 decision 15):
 *   - plaintext six-digit login codes, or their hashes;
 *   - invitation tokens, or their hashes;
 *   - passwords or password hashes;
 *   - patient records or any clinical detail.
 *
 * The trail is read by Owners and exported during support work, so a secret
 * copied into it outlives every expiry and single-use guard protecting the
 * original. `assertSafeAuditMetadata` enforces that mechanically rather than by
 * convention — see the note on why it throws.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { IP_COLUMN_MAX, USER_AGENT_MAX, truncateForColumn } from "@/lib/sessionPolicy";

type PrismaClientOrTransaction = PrismaClient | Prisma.TransactionClient;

/**
 * Action names. VARCHAR(64), SCREAMING_SNAKE, past tense — they record what
 * happened, not what was requested.
 */
export const AUDIT_ACTIONS = {
  OWNER_CREATED: "OWNER_CREATED",
  OWNER_ALREADY_PRESENT: "OWNER_ALREADY_PRESENT",
  SESSION_CREATED: "SESSION_CREATED",
  SESSION_REVOKED: "SESSION_REVOKED",

  // --- Stage 3: clinic registration and the Owner's decision on it ---------
  /** An applicant submitted a registration. Actor is the applicant. */
  CLINIC_REGISTERED: "CLINIC_REGISTERED",
  /** The organisation's address was verified from the emailed link. */
  CLINIC_EMAIL_VERIFIED: "CLINIC_EMAIL_VERIFIED",
  CLINIC_APPROVED: "CLINIC_APPROVED",
  CLINIC_REJECTED: "CLINIC_REJECTED",
  CLINIC_SUSPENDED: "CLINIC_SUSPENDED",
  CLINIC_REACTIVATED: "CLINIC_REACTIVATED",
  /** The first user was given their account-wide role at approval. */
  CLINIC_ADMIN_ASSIGNED: "CLINIC_ADMIN_ASSIGNED",
  /** The Owner set the tenant's plan and/or its feature overrides. */
  TENANT_ENTITLEMENTS_SET: "TENANT_ENTITLEMENTS_SET",

  // --- Stage 4: six-digit login codes and session revocation ---------------
  //
  // Every one of these carries `{ method: "login-code", outcome: ... }` and the
  // LoginCode row id in `targetId`. NEVER the code, its digest, or the pepper —
  // assertSafeAuditMetadata below throws on a metadata key naming any of them,
  // which is why the row id travels in a column instead.
  /** A code was issued and handed to the mailer. Not written for a refused request. */
  LOGIN_CODE_REQUESTED: "LOGIN_CODE_REQUESTED",
  LOGIN_CODE_SUCCEEDED: "LOGIN_CODE_SUCCEEDED",
  /** Wrong, expired, consumed, exhausted, or the account stopped being eligible. */
  LOGIN_CODE_FAILED: "LOGIN_CODE_FAILED",
  /** Throttling refused a request or a verification. Carries no subject. */
  LOGIN_CODE_RATE_LIMITED: "LOGIN_CODE_RATE_LIMITED",
  /** The user signed out of every device at once. */
  SESSIONS_REVOKED_ALL: "SESSIONS_REVOKED_ALL",

  // --- "Forgot password?" --------------------------------------------------
  //
  // `targetId` carries the User id. NEVER the reset token or its hash — the
  // guard below throws on a metadata key containing "token", which is the same
  // rule that keeps invitation tokens out of this table.
  /** A reset link was issued and handed to the mailer. */
  PASSWORD_RESET_REQUESTED: "PASSWORD_RESET_REQUESTED",
  /** A link was redeemed and the password actually changed. */
  PASSWORD_RESET_COMPLETED: "PASSWORD_RESET_COMPLETED",
  /** A redemption was refused — link invalid, expired, or account ineligible. */
  PASSWORD_RESET_FAILED: "PASSWORD_RESET_FAILED",
  /** Throttling refused a reset request. Carries no subject. */
  PASSWORD_RESET_RATE_LIMITED: "PASSWORD_RESET_RATE_LIMITED",

  // --- Stage 6: invitations and the tenant-side membership lifecycle -------
  //
  // `targetId` carries the Invitation row id or the User id. NEVER the token or
  // its hash: assertSafeAuditMetadata throws on a metadata key containing
  // "token", which is what keeps a bearer credential out of a table that is
  // never deleted and is read during support work.
  TEAM_INVITATION_CREATED: "TEAM_INVITATION_CREATED",
  /** A new invitation to the same address superseded an outstanding one. */
  TEAM_INVITATION_SUPERSEDED: "TEAM_INVITATION_SUPERSEDED",
  TEAM_INVITATION_REVOKED: "TEAM_INVITATION_REVOKED",
  TEAM_INVITATION_ACCEPTED: "TEAM_INVITATION_ACCEPTED",
  /**
   * The platform axis of an invited login was opened under the delegated grant
   * described in src/lib/platform/memberActivation.ts. Written ONLY there.
   */
  MEMBER_ACCOUNT_ACTIVATED: "MEMBER_ACCOUNT_ACTIVATED",
  /** Tenant-side membership decisions. `users.membership_status` moves only here. */
  TEAM_MEMBER_APPROVED: "TEAM_MEMBER_APPROVED",
  TEAM_MEMBER_REJECTED: "TEAM_MEMBER_REJECTED",
  TEAM_MEMBER_SUSPENDED: "TEAM_MEMBER_SUSPENDED",
  TEAM_MEMBER_REACTIVATED: "TEAM_MEMBER_REACTIVATED",
  TEAM_MEMBER_REMOVED: "TEAM_MEMBER_REMOVED",

  // --- Stage 8: the Tenant Admin's per-role feature switches (layer 3) -----
  //
  // `targetId` carries the Role id; the feature key travels in `afterValue`.
  // Layers 1 and 2 belong to the Platform Owner and are recorded under
  // TENANT_ENTITLEMENTS_SET, not here — keeping the two apart is what lets a
  // reader tell "the organisation lost the module" from "an admin took it away
  // from one role".
  ROLE_FEATURE_ENABLED: "ROLE_FEATURE_ENABLED",
  ROLE_FEATURE_DISABLED: "ROLE_FEATURE_DISABLED",
  /** The explicit row was removed, so the role inherits the tenant again. */
  ROLE_FEATURE_RESET: "ROLE_FEATURE_RESET",

  // --- Stage 9: the Platform Owner's entitlement layers (1 and 2a) ---------
  //
  // The counterpart to the three ROLE_FEATURE_* actions above, and kept
  // separate from them for the same reason those are kept separate from
  // TENANT_ENTITLEMENTS_SET: a reader must be able to tell "the platform
  // switched the module off for everyone" from "this organisation lost it" from
  // "an admin took it away from one role". Three causes, three people to ask,
  // three action names.
  //
  // Layer 1. `targetId` is the Feature id; the key and the number of
  // organisations entitled at the moment of the flip travel in `afterValue`,
  // because after a kill switch that count is no longer recoverable.
  FEATURE_GLOBAL_ENABLED: "FEATURE_GLOBAL_ENABLED",
  FEATURE_GLOBAL_DISABLED: "FEATURE_GLOBAL_DISABLED",
  /** Layer 2a. `targetId` is the Plan id. */
  PLAN_FEATURE_ADDED: "PLAN_FEATURE_ADDED",
  PLAN_FEATURE_REMOVED: "PLAN_FEATURE_REMOVED",
  // Layer 2b has no new action: a standalone per-tenant override writes
  // TENANT_ENTITLEMENTS_SET, exactly as the Stage 3 approval screen does, so
  // one organisation's entitlement history reads as one sequence.

  // --- AP-3: booking, and the price list it books against ------------------
  //
  // `targetId` carries the Appointment id or the AppointmentType id, and
  // `targetType` says which. NEVER the patient: `afterValue` records that a
  // slot was taken, by whom and at what price, not who it was taken for. The
  // patient's name and number live on the appointment row, which is read under
  // `appointment:read`; this table is append-only and is read during support
  // work, so it carries the scheduling fact and nothing clinical.
  APPOINTMENT_CREATED: "APPOINTMENT_CREATED",

  // Retiring a type is kept distinct from editing one, because "why can nobody
  // book a follow-up any more?" and "who changed the price?" are different
  // questions with different answers, and folding both into one action would
  // hide the one that stops bookings.
  APPOINTMENT_TYPE_CREATED: "APPOINTMENT_TYPE_CREATED",
  APPOINTMENT_TYPE_UPDATED: "APPOINTMENT_TYPE_UPDATED",
  APPOINTMENT_TYPE_ACTIVATED: "APPOINTMENT_TYPE_ACTIVATED",
  APPOINTMENT_TYPE_DEACTIVATED: "APPOINTMENT_TYPE_DEACTIVATED",
  // --- AP-4: the lifecycle -----------------------------------------------
  //
  // Same rule as the booking action above: `targetId` carries the Appointment
  // id and the metadata carries the SCHEDULING fact — which doctor, which day,
  // which times, which status either side of the change. Never the patient's
  // name, number or id. A reason typed at the desk travels in the `reason`
  // column, which is where this trail has always kept operator free text.
  //
  // Four separate actions rather than one APPOINTMENT_STATUS_CHANGED, because
  // "who cancelled my 09:30?", "how many people did not turn up last week?" and
  // "when did that patient arrive?" are three different questions, and folding
  // them into one action would make every one of them a metadata search.

  /**
   * The appointment was moved. `targetId` is the ORIGINAL row — the one that was
   * acted on — and `afterValue.newAppointmentId` leads forward to the row that
   * replaced it. The reverse direction needs no audit row: the new appointment
   * carries `rescheduled_from_id`, which the schema designed as the
   * authoritative link.
   */
  APPOINTMENT_RESCHEDULED: "APPOINTMENT_RESCHEDULED",
  APPOINTMENT_CANCELLED: "APPOINTMENT_CANCELLED",
  /**
   * Kept distinct from a cancellation on purpose. Both free the slot, but one is
   * a decision somebody made and the other is a patient who did not arrive, and
   * a clinic counting either would get the wrong number from a merged action.
   */
  APPOINTMENT_NO_SHOW: "APPOINTMENT_NO_SHOW",
  APPOINTMENT_CHECKED_IN: "APPOINTMENT_CHECKED_IN",

  // --- AP-5: conversion ---------------------------------------------------
  /**
   * An arrived patient's appointment became a real Registration.
   *
   * `targetId` is the Appointment, so the trail reads from the side that was
   * acted on, and `afterValue.registrationId` leads forward to the visit that
   * came out of it. The reverse direction needs no row: `registrations`
   * carries `appointment_id`, which the schema designed as the authoritative —
   * and UNIQUE — link.
   *
   * THE METADATA IS A SCHEDULING FACT PLUS ONE ID, exactly as AP-3's booking
   * and AP-4's transitions are. Never the patient's name, number, address or
   * id, and never the `PT-YYYY-####` code — quite apart from the rule, the
   * word "code" is one `assertSafeAuditMetadata` throws on, which is the
   * mechanism doing the remembering rather than the author.
   *
   * SLOT OCCUPANCY DOES NOT CHANGE HERE. CONVERTED is an occupying status, so
   * `active_slot_start` keeps mirroring `slot_start` — a visit that demonstrably
   * happened consumed the doctor's time.
   */
  APPOINTMENT_CONVERTED: "APPOINTMENT_CONVERTED",

  // --- AP-9: correcting a booking, and confirming one ----------------------

  /**
   * The patient acknowledged the booking. A fifth status action rather than a
   * flag on another, for the reason the four above are separate: "how many of
   * next week's bookings have we actually confirmed?" is a question a clinic
   * asks, and folding it into a generic status action would make it a metadata
   * search.
   *
   * Occupancy does not change — CONFIRMED occupies the slot exactly as
   * SCHEDULED did — so this row records an acknowledgement, not a movement.
   */
  APPOINTMENT_CONFIRMED: "APPOINTMENT_CONFIRMED",

  /**
   * A booking's own details were corrected — never its slot, doctor, service or
   * status, each of which has its own action above.
   *
   * WHAT THE METADATA MAY CARRY, and this is the AP-3 rule holding rather than
   * a new one: `afterValue.changedFields` names the COLUMNS that changed and
   * never their values, so the trail records that a mobile number was
   * corrected and not what it was corrected to. The single exception is
   * `amount`, carried on both sides, because a price is a commercial fact this
   * table already records at booking and "who changed the price, and to what?"
   * cannot be answered without the two numbers.
   *
   * This is a weaker trail than a registration edit gets: `registration_edit_log`
   * keeps per-field before/after values, and nothing equivalent exists for an
   * appointment. That is a deliberate limit of AP-9, not an oversight — adding
   * one is a new table.
   */
  APPOINTMENT_UPDATED: "APPOINTMENT_UPDATED",

  // --- Tasks ---------------------------------------------------------------
  // Task titles and descriptions may contain sensitive clinic context, so the
  // audit metadata records only ids, state, priority and timestamps.
  TASK_CREATED: "TASK_CREATED",
  TASK_ASSIGNED: "TASK_ASSIGNED",
  TASK_UPDATED: "TASK_UPDATED",
  TASK_COMPLETED: "TASK_COMPLETED",
  TASK_ARCHIVED: "TASK_ARCHIVED",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

/**
 * Key names that must never appear in `beforeValue` / `afterValue`.
 *
 * Matched case-insensitively against the whole key, and also as a substring, so
 * `codeHash`, `code_hash` and `plainCode` are all caught by "code". The cost of
 * that breadth is the occasional false positive on an innocent key; the cost of
 * being narrower is a secret in a table that is never deleted.
 */
const FORBIDDEN_METADATA_KEYS = [
  "password",
  "passwordhash",
  "code",
  "codehash",
  "token",
  "tokenhash",
  "otp",
  "secret",
  "pepper",
  "apikey",
  "authorization",
] as const;

function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Throws if any key anywhere in the value is a forbidden one.
 *
 * IT THROWS RATHER THAN REDACTING. Silently stripping would let the mistake
 * ship: the call site keeps believing it logged the field, and nobody finds out
 * until an incident. Throwing surfaces it in the test that first exercises the
 * path. This is a programming error, not a runtime condition — no correct
 * caller can trigger it.
 */
export function assertSafeAuditMetadata(value: unknown, path = "metadata"): void {
  if (value === null || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeAuditMetadata(item, `${path}[${index}]`));
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const normalised = normaliseKey(key);
    const hit = FORBIDDEN_METADATA_KEYS.find((forbidden) =>
      normalised.includes(forbidden),
    );
    if (hit) {
      throw new Error(
        `Refusing to write audit metadata: ${path}.${key} looks like a secret ("${hit}"). The audit trail is append-only and is read by support staff.`,
      );
    }
    assertSafeAuditMetadata(child, `${path}.${key}`);
  }
}

export interface AuditEntry {
  action: AuditAction | string;
  targetType: string;
  targetId?: string | null;

  /** Null for an action taken by the system rather than a person. */
  actorUserId?: string | null;
  /** Captured at the time of the action; see the schema note on why. */
  actorPlatformRole?: "SUPER_ADMIN" | "SUPPORT_ADMIN" | null;
  /** Null for a platform-wide action with no single tenant behind it. */
  actorTenantId?: string | null;

  beforeValue?: Prisma.InputJsonValue | null;
  afterValue?: Prisma.InputJsonValue | null;
  reason?: string | null;

  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

/**
 * Appends one row. Pass a transaction client to make the record atomic with the
 * change it describes — an approval that commits without its audit row, or an
 * audit row without its approval, is worse than either alone.
 */
export async function writeAuditLog(
  client: PrismaClientOrTransaction,
  entry: AuditEntry,
): Promise<void> {
  assertSafeAuditMetadata(entry.beforeValue, "beforeValue");
  assertSafeAuditMetadata(entry.afterValue, "afterValue");

  await client.auditLog.create({
    data: {
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      actorUserId: entry.actorUserId ?? null,
      actorPlatformRole: entry.actorPlatformRole ?? null,
      actorTenantId: entry.actorTenantId ?? null,
      beforeValue: entry.beforeValue ?? undefined,
      afterValue: entry.afterValue ?? undefined,
      reason: entry.reason ?? null,
      ip: truncateForColumn(entry.ip, IP_COLUMN_MAX),
      userAgent: truncateForColumn(entry.userAgent, USER_AGENT_MAX),
      requestId: truncateForColumn(entry.requestId, 64),
    },
  });
}
