import { AUDIT_ACTIONS, type AuditAction } from "@/lib/audit";

/**
 * What each audited action MEANS, in words — Stage 11.
 *
 * Pure: no Prisma, no session. The tenant screen, the Owner screen and the CSV
 * export all read this one table, so an action cannot be described one way in
 * the interface and another in a file someone attaches to a support ticket.
 *
 * WHY THIS EXISTS AT ALL. `audit_logs.action` holds strings like
 * `TEAM_MEMBER_SUSPENDED`. Rendering that raw is fine for a developer reading a
 * database client and useless to the clinic manager asking who removed their
 * receptionist. Worse, it fails SILENTLY: an action added by a later stage with
 * no entry here would render as its own constant name and look deliberate. The
 * unit test holds this map against AUDIT_ACTIONS on every run, so adding an
 * action forces a decision about how it reads and who may see it.
 *
 * TWO SIDES, AND WHY THE SPLIT IS DATA RATHER THAN A QUERY. Every action
 * belongs either to the platform (an Owner acting on an organisation) or to the
 * organisation itself (an admin acting on their own people and roles). The
 * tenant-facing screen shows its own actions plus the platform decisions taken
 * ABOUT it — never the platform's decisions about anyone else — and `side` is
 * what lets a reader of this file check that claim without tracing a query.
 */

/** Who took the action, and therefore whose log it belongs on. */
export type AuditSide =
  /** A Platform Owner acting on an organisation. `actorTenantId` is null. */
  | "platform"
  /** Someone inside an organisation, acting within it. */
  | "tenant"
  /** Not a person: session bookkeeping, verification, rate limiting. */
  | "system";

/** Coarse grouping, for the filter control on both screens. */
export type AuditCategory =
  | "access"
  | "organisation"
  | "team"
  | "roles"
  | "entitlements"
  | "platform";

export interface AuditDescription {
  /** Sentence-case, past tense, no full stop. What a reader sees in the list. */
  label: string;
  /** One line of context, shown under the label when a row is expanded. */
  detail: string;
  side: AuditSide;
  category: AuditCategory;
  /**
   * True when the row concerns ONE person's sign-in attempts rather than a
   * decision somebody took. These are the highest-volume and lowest-value rows
   * on a tenant screen, so they are filtered out unless asked for by name.
   */
  isSignInNoise?: boolean;
}

export const AUDIT_DESCRIPTIONS: Readonly<
  Record<AuditAction, AuditDescription>
> = {
  // --- Platform bookkeeping -----------------------------------------------
  [AUDIT_ACTIONS.OWNER_CREATED]: {
    label: "Platform owner created",
    detail: "A MEDCARE PRO staff login was created.",
    side: "platform",
    category: "platform",
  },
  [AUDIT_ACTIONS.OWNER_ALREADY_PRESENT]: {
    label: "Platform owner already existed",
    detail: "The owner-creation script ran and found an owner already in place.",
    side: "platform",
    category: "platform",
  },

  // --- Sessions ------------------------------------------------------------
  [AUDIT_ACTIONS.SESSION_CREATED]: {
    label: "Signed in",
    detail: "A new session was opened.",
    side: "system",
    category: "access",
    isSignInNoise: true,
  },
  [AUDIT_ACTIONS.SESSION_REVOKED]: {
    label: "Session ended",
    detail: "A session was closed, on this device or by an administrator.",
    side: "system",
    category: "access",
    isSignInNoise: true,
  },
  [AUDIT_ACTIONS.SESSIONS_REVOKED_ALL]: {
    label: "Signed out everywhere",
    detail: "Every session for this login was ended at once.",
    side: "tenant",
    category: "access",
  },

  // --- Registration and the Owner's decision on it -------------------------
  [AUDIT_ACTIONS.CLINIC_REGISTERED]: {
    label: "Organisation registered",
    detail: "Somebody submitted this organisation's application to join.",
    side: "tenant",
    category: "organisation",
  },
  [AUDIT_ACTIONS.CLINIC_EMAIL_VERIFIED]: {
    label: "Organisation email verified",
    detail: "The address on the application was confirmed from its emailed link.",
    side: "tenant",
    category: "organisation",
  },
  [AUDIT_ACTIONS.CLINIC_APPROVED]: {
    label: "Organisation approved",
    detail: "MEDCARE PRO approved this organisation and opened its access.",
    side: "platform",
    category: "organisation",
  },
  [AUDIT_ACTIONS.CLINIC_REJECTED]: {
    label: "Organisation rejected",
    detail: "MEDCARE PRO declined this application. The reason is recorded.",
    side: "platform",
    category: "organisation",
  },
  [AUDIT_ACTIONS.CLINIC_SUSPENDED]: {
    label: "Organisation suspended",
    detail: "MEDCARE PRO suspended access for everyone in this organisation.",
    side: "platform",
    category: "organisation",
  },
  [AUDIT_ACTIONS.CLINIC_REACTIVATED]: {
    label: "Organisation reactivated",
    detail: "A suspension was lifted and access returned.",
    side: "platform",
    category: "organisation",
  },
  [AUDIT_ACTIONS.CLINIC_ADMIN_ASSIGNED]: {
    label: "First administrator appointed",
    detail: "The person who applied was given the account-wide owner role.",
    side: "platform",
    category: "roles",
  },
  [AUDIT_ACTIONS.TENANT_ENTITLEMENTS_SET]: {
    label: "Plan or features changed",
    detail:
      "MEDCARE PRO changed which plan this organisation is on, or which features it holds.",
    side: "platform",
    category: "entitlements",
  },

  // --- Six-digit login codes ----------------------------------------------
  [AUDIT_ACTIONS.LOGIN_CODE_REQUESTED]: {
    label: "Sign-in code requested",
    detail: "A one-time code was sent to a login's email address.",
    side: "system",
    category: "access",
    isSignInNoise: true,
  },
  [AUDIT_ACTIONS.LOGIN_CODE_SUCCEEDED]: {
    label: "Sign-in code accepted",
    detail: "A one-time code was entered correctly.",
    side: "system",
    category: "access",
    isSignInNoise: true,
  },
  [AUDIT_ACTIONS.LOGIN_CODE_FAILED]: {
    label: "Sign-in code refused",
    detail: "A code was wrong, expired, already used, or out of attempts.",
    side: "system",
    category: "access",
    isSignInNoise: true,
  },
  [AUDIT_ACTIONS.LOGIN_CODE_RATE_LIMITED]: {
    label: "Sign-in attempts throttled",
    detail: "Too many attempts came from one address or one email.",
    side: "system",
    category: "access",
    isSignInNoise: true,
  },

  // --- Invitations and membership -----------------------------------------
  [AUDIT_ACTIONS.TEAM_INVITATION_CREATED]: {
    label: "Invitation sent",
    detail: "Somebody was invited to join this organisation.",
    side: "tenant",
    category: "team",
  },
  [AUDIT_ACTIONS.TEAM_INVITATION_SUPERSEDED]: {
    label: "Invitation replaced",
    detail: "A new invitation to the same address cancelled an outstanding one.",
    side: "tenant",
    category: "team",
  },
  [AUDIT_ACTIONS.TEAM_INVITATION_REVOKED]: {
    label: "Invitation revoked",
    detail: "An outstanding invitation was withdrawn before it was accepted.",
    side: "tenant",
    category: "team",
  },
  [AUDIT_ACTIONS.TEAM_INVITATION_ACCEPTED]: {
    label: "Invitation accepted",
    detail: "Somebody used their invitation and created their login.",
    side: "tenant",
    category: "team",
  },
  [AUDIT_ACTIONS.MEMBER_ACCOUNT_ACTIVATED]: {
    label: "Invited login opened",
    detail:
      "An invited person's account was opened under the delegated grant that accepting an invitation carries.",
    side: "platform",
    category: "team",
  },
  [AUDIT_ACTIONS.TEAM_MEMBER_APPROVED]: {
    label: "Team member approved",
    detail: "An administrator approved somebody's access to this organisation.",
    side: "tenant",
    category: "team",
  },
  [AUDIT_ACTIONS.TEAM_MEMBER_REJECTED]: {
    label: "Team member rejected",
    detail: "An administrator declined somebody's access.",
    side: "tenant",
    category: "team",
  },
  [AUDIT_ACTIONS.TEAM_MEMBER_SUSPENDED]: {
    label: "Team member suspended",
    detail: "An administrator suspended somebody and ended their sessions.",
    side: "tenant",
    category: "team",
  },
  [AUDIT_ACTIONS.TEAM_MEMBER_REACTIVATED]: {
    label: "Team member reactivated",
    detail: "A suspension was lifted and the person could sign in again.",
    side: "tenant",
    category: "team",
  },
  [AUDIT_ACTIONS.TEAM_MEMBER_REMOVED]: {
    label: "Team member removed",
    detail: "An administrator removed somebody from this organisation.",
    side: "tenant",
    category: "team",
  },

  // --- Per-role feature switches (layer 3) ---------------------------------
  [AUDIT_ACTIONS.ROLE_FEATURE_ENABLED]: {
    label: "Feature switched on for a role",
    detail: "An administrator gave a role access to one of the organisation's features.",
    side: "tenant",
    category: "entitlements",
  },
  [AUDIT_ACTIONS.ROLE_FEATURE_DISABLED]: {
    label: "Feature switched off for a role",
    detail: "An administrator took a feature away from one role.",
    side: "tenant",
    category: "entitlements",
  },
  [AUDIT_ACTIONS.ROLE_FEATURE_RESET]: {
    label: "Feature setting cleared for a role",
    detail: "A role went back to following the organisation's own entitlement.",
    side: "tenant",
    category: "entitlements",
  },

  // --- The platform's own entitlement layers -------------------------------
  [AUDIT_ACTIONS.FEATURE_GLOBAL_ENABLED]: {
    label: "Feature switched on across MEDCARE PRO",
    detail: "A platform-wide switch was restored for every organisation.",
    side: "platform",
    category: "platform",
  },
  [AUDIT_ACTIONS.FEATURE_GLOBAL_DISABLED]: {
    label: "Feature switched off across MEDCARE PRO",
    detail: "A platform-wide switch was taken down for every organisation.",
    side: "platform",
    category: "platform",
  },
  [AUDIT_ACTIONS.PLAN_FEATURE_ADDED]: {
    label: "Feature added to a plan",
    detail: "Every organisation on that plan gained the feature.",
    side: "platform",
    category: "platform",
  },
  [AUDIT_ACTIONS.PLAN_FEATURE_REMOVED]: {
    label: "Feature removed from a plan",
    detail: "Every organisation on that plan lost the feature.",
    side: "platform",
    category: "platform",
  },
};

/**
 * Falls back to the raw string rather than throwing.
 *
 * A row whose action has no entry is a programming oversight, not a runtime
 * condition — the unit test catches it before it ships. But an audit screen is
 * the wrong place to turn an oversight into a blank page, so an unknown action
 * renders as itself and stays visible.
 */
export function describeAuditAction(action: string): AuditDescription {
  return (
    AUDIT_DESCRIPTIONS[action as AuditAction] ?? {
      label: action,
      detail: "This action has no description yet.",
      side: "system",
      category: "access",
    }
  );
}

export const AUDIT_CATEGORIES: readonly {
  key: AuditCategory;
  label: string;
}[] = [
  { key: "access", label: "Sign-in and sessions" },
  { key: "organisation", label: "Organisation" },
  { key: "team", label: "Team" },
  { key: "roles", label: "Roles" },
  { key: "entitlements", label: "Features and plan" },
  { key: "platform", label: "Platform" },
];

export function isAuditCategory(value: string): value is AuditCategory {
  return AUDIT_CATEGORIES.some((category) => category.key === value);
}

/** Every action in a category — used to turn a filter choice into a query. */
export function actionsInCategory(category: AuditCategory): string[] {
  return Object.entries(AUDIT_DESCRIPTIONS)
    .filter(([, description]) => description.category === category)
    .map(([action]) => action);
}

/**
 * The actions a tenant screen hides by default.
 *
 * Sign-in rows outnumber every decision by an order of magnitude and answer a
 * different question. They stay available behind the category filter rather
 * than being removed, because "who tried to sign in and failed" is exactly what
 * an administrator wants on the one day they want it.
 */
export const SIGN_IN_NOISE_ACTIONS: readonly string[] = Object.entries(
  AUDIT_DESCRIPTIONS,
)
  .filter(([, description]) => description.isSignInNoise === true)
  .map(([action]) => action);
