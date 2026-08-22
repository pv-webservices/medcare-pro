/**
 * The permission catalogue — PRD §6.8 (FR-8.1, "granular permissions").
 *
 * Pure data: no Prisma, no session, no imports. `lib/rbac.ts` matches these
 * strings exactly when it checks a request, and the roles screen renders this
 * list as its checkboxes, so the two can never drift apart.
 *
 * This list must stay a SUPERSET of everything any seeded role holds. The roles
 * editor submits the full permission set for a role, and anything not listed
 * here is rejected — a permission missing from the catalogue would be silently
 * dropped the first time someone edited the role that held it.
 *
 * Adding a permission: add it here, then enforce it at the call site. A string
 * in this list that nothing checks grants nothing, which is why the ones in
 * that state are marked `pending` and say so on screen rather than quietly
 * implying protection that does not exist.
 */

/** Grants every permission. Held by the seeded Owner role. */
export const WILDCARD = "*";

export type PermissionPending =
  /** The module is a later build stage; nothing enforces this yet. */
  | "stage"
  /** No endpoint exists to perform this action, by design. */
  | "no-endpoint"
  /** A different permission is the real gate for this action today. */
  | "covered-elsewhere";

export interface PermissionDefinition {
  key: string;
  label: string;
  description: string;
  /** Set when nothing in the app checks this string yet. */
  pending?: PermissionPending;
  /** Shown beside the permission when `pending` is set. */
  pendingNote?: string;
}

export interface PermissionGroup {
  /** PRD vocabulary — the module name staff would recognise. */
  module: string;
  permissions: readonly PermissionDefinition[];
}

export const PERMISSION_GROUPS: readonly PermissionGroup[] = [
  {
    module: "Clinics",
    permissions: [
      {
        key: "clinic:read",
        label: "View clinics",
        description: "See the clinic list and each clinic's details.",
      },
      {
        key: "clinic:create",
        label: "Add clinics",
        description: "Create a new clinic under the account.",
      },
      {
        key: "clinic:edit",
        label: "Edit clinics",
        description: "Change a clinic's details, logo and theme colour.",
      },
    ],
  },
  {
    module: "Doctors",
    permissions: [
      {
        key: "doctor:read",
        label: "View doctors",
        description: "See doctors, their availability and their leave.",
      },
      {
        key: "doctor:create",
        label: "Add doctors",
        description: "Add a doctor to a clinic.",
      },
      {
        key: "doctor:edit",
        label: "Edit doctors",
        description: "Change a doctor's details, availability and leave.",
      },
      {
        key: "doctor:delete",
        label: "Remove doctors",
        description: "Delete a doctor record.",
        pending: "no-endpoint",
        pendingNote:
          "No delete exists — registrations reference doctors, so removing one would break revenue history.",
      },
    ],
  },
  {
    module: "Patients",
    permissions: [
      {
        key: "patient:read",
        label: "View patients",
        description: "Look up an existing patient for a return visit.",
      },
      {
        key: "patient:create",
        label: "Add patients",
        description: "Create a patient record.",
        pending: "covered-elsewhere",
        pendingNote:
          "Patients are created by registering a visit — “Add registrations” is the real gate.",
      },
      {
        key: "patient:edit",
        label: "Edit patients",
        description: "Change a patient's details.",
        pending: "covered-elsewhere",
        pendingNote:
          "Patient details are edited through the registration form — “Edit registrations” is the real gate.",
      },
    ],
  },
  {
    module: "Registrations",
    permissions: [
      {
        key: "registration:read",
        label: "View registrations",
        description: "See the registration list, filters and CSV export.",
      },
      {
        key: "registration:create",
        label: "Add registrations",
        description: "Record a visit, creating the patient if they are new.",
      },
      {
        key: "registration:edit",
        label: "Edit registrations",
        description: "Change a recorded visit. Every edit is logged either way.",
      },
      {
        key: "registration:history:read",
        label: "View edit history",
        description:
          "See the audit trail of who changed a registration and what changed.",
      },
    ],
  },
  {
    module: "Reports",
    permissions: [
      {
        key: "report:read",
        label: "View revenue reports",
        description: "See revenue totals, KPIs and the growth graph.",
      },
      {
        key: "reports:view",
        label: "View reports",
        description: "See the revenue report.",
        pending: "covered-elsewhere",
        pendingNote:
          "report:read is the permission the reports page and API actually check. This key exists so the newer reports:* naming resolves, but granting it alone opens nothing.",
        // Stage 7 deliberately left this inert while making reports:export
        // live. Turning it into an alias for report:read would be a silent
        // grant: every custom role that ticked it on the strength of the note
        // above would gain revenue visibility nobody decided to give them.
      },
      {
        key: "reports:export",
        label: "Export reports",
        description:
          "Download the revenue trend and breakdowns as CSV. Needs “View revenue reports” as well — this opens the download, not the figures.",
      },
    ],
  },
  {
    module: "Notifications",
    permissions: [
      {
        key: "notification:read",
        label: "View notifications",
        description: "See and clear the record-change feed.",
      },
    ],
  },
  {
    module: "Messages",
    permissions: [
      {
        key: "message:send",
        label: "Send WhatsApp messages",
        description:
          "Send an approved template to patients, and see the message history.",
      },
      {
        key: "message:template",
        label: "Manage message templates",
        description:
          "Write and edit the approved message wording. Separate from sending, so the front desk cannot rewrite what goes out.",
      },
    ],
  },
  {
    module: "Roles & settings",
    permissions: [
      {
        key: "role:read",
        label: "View roles",
        description: "See the account's roles and who holds them.",
      },
      {
        key: "role:manage",
        label: "Manage roles",
        description:
          "Create roles, change their permissions, and assign them to users.",
      },
      // Stage 10 gave these two their first call sites. The descriptions name
      // branding specifically rather than "settings" in the abstract, because
      // branding is the only setting the PRD defines (§6.8, FR-8.3 and FR-8.4)
      // and a description promising more than that would be the same false
      // promise the `pending` mark exists to prevent.
      //
      // Neither key REPLACED anything. Branding has answered to clinic:read /
      // clinic:edit since it was built and still does — see the ANY-folded lists
      // in src/lib/settingsSections.ts — so no role lost a screen the day these
      // started being enforced.
      {
        key: "settings:view",
        label: "View settings",
        description:
          "Open Settings and see the clinic's branding — its logo and theme colour — without changing it.",
      },
      {
        key: "settings:manage",
        label: "Manage settings",
        description:
          "Change the clinic's logo and theme colour. “Edit clinics” also opens this, since branding lives on the clinic record.",
      },
    ],
  },
  // -------------------------------------------------------------------------
  // Stage 1 additions.
  //
  // Every key below was `pending` when Stage 1 catalogued it, because nothing
  // checked it yet: the modules that enforce them arrive in Stages 6-9. Team
  // (Stage 6), reports:export (Stage 7) and the two feature keys (Stage 8) are
  // built and no longer marked. Per
  // this file's own rule, a string listed
  // here that no call site checks grants NOTHING — it is listed now so the roles
  // editor and the seeded Admin role carry it from the start, rather than
  // needing a re-seed the day the call site lands.
  // -------------------------------------------------------------------------
  {
    module: "Team",
    permissions: [
      // Stage 6 built the module these four describe, so the `pending` marks
      // are gone: every one of them is now checked by lib/team.ts or
      // lib/invitations.ts before anything is written.
      {
        key: "team:view",
        label: "View team",
        description: "See the people in this organisation and their roles.",
      },
      {
        key: "team:invite",
        label: "Invite team members",
        description: "Create and revoke invitations to join this organisation.",
      },
      {
        key: "team:approve",
        label: "Approve team members",
        description:
          "Approve or reject someone whose access is pending. Scoped to this organisation only.",
      },
      {
        key: "team:manage",
        label: "Manage team members",
        description:
          "Suspend, reactivate and remove people, ending their sessions. This is the permission that makes someone a Clinic Admin. Changing which roles they hold is separate — that is “Manage roles”.",
      },
    ],
  },
  {
    module: "Features",
    permissions: [
      {
        key: "feature:view",
        label: "View feature access",
        description:
          "See which features this organisation is entitled to, and which are locked.",
      },
      {
        key: "feature:manage",
        label: "Manage feature access",
        description:
          "Choose which of the organisation's entitled features each role may use. Cannot grant a feature the organisation does not hold, cannot override a platform-wide switch, and cannot take a feature away from the account owner.",
      },
    ],
  },
  {
    module: "Marketing",
    permissions: [
      {
        key: "marketing:view",
        label: "View marketing",
        description: "See marketing campaigns and their results.",
        pending: "stage",
        pendingNote: "The marketing module is not built yet.",
      },
      {
        key: "marketing:manage",
        label: "Manage marketing",
        description: "Create and edit marketing campaigns.",
        pending: "stage",
        pendingNote: "The marketing module is not built yet.",
      },
    ],
  },
] as const;

export const ALL_PERMISSIONS: readonly string[] = PERMISSION_GROUPS.flatMap(
  (group) => group.permissions.map((permission) => permission.key),
);

const BY_KEY = new Map(
  PERMISSION_GROUPS.flatMap((group) =>
    group.permissions.map((permission) => [permission.key, permission] as const),
  ),
);

/**
 * The wildcard is deliberately NOT a known permission.
 *
 * It is granted by seeding the Owner role, never by ticking a box: letting the
 * roles editor submit `*` would turn "create a custom role" into "mint an
 * account owner". `lib/roles.ts` rejects it explicitly for the same reason.
 */
export function isKnownPermission(value: string): boolean {
  return BY_KEY.has(value);
}

export function findPermission(key: string): PermissionDefinition | undefined {
  return BY_KEY.get(key);
}

/** Falls back to the raw string, so a legacy value still renders as itself. */
export function describePermission(key: string): string {
  if (key === WILDCARD) {
    return "Everything";
  }
  return BY_KEY.get(key)?.label ?? key;
}

/**
 * The catalogue exactly as it stood BEFORE the Stage 1 additions above.
 *
 * This is a frozen snapshot and must never be edited again — not to add a
 * permission, not to reorder one. Its only job is to answer one question during
 * the Stage 1 backfill: "is this seeded Admin role still untouched?"
 *
 * `seedDefaultRoles` gives a new tenant's Admin role a copy of ALL_PERMISSIONS,
 * so a tenant that never edited theirs holds a set exactly equal to this list.
 * A tenant that DID edit theirs — added a key, removed one — will not match, and
 * the backfill leaves them alone rather than overwriting a deliberate choice.
 *
 * Comparing against the live ALL_PERMISSIONS would be useless here: it already
 * contains the new keys, so nothing would ever match.
 */
export const HISTORICAL_ALL_PERMISSIONS: readonly string[] = [
  "clinic:read",
  "clinic:create",
  "clinic:edit",
  "doctor:read",
  "doctor:create",
  "doctor:edit",
  "doctor:delete",
  "patient:read",
  "patient:create",
  "patient:edit",
  "registration:read",
  "registration:create",
  "registration:edit",
  "registration:history:read",
  "report:read",
  "notification:read",
  "message:send",
  "message:template",
  "role:read",
  "role:manage",
];

/**
 * Everything added to the catalogue by Stage 1 — the difference between
 * HISTORICAL_ALL_PERMISSIONS and ALL_PERMISSIONS.
 *
 * Derived rather than hand-listed so the two can never drift: adding a key to a
 * group above puts it here automatically.
 */
export const STAGE_1_PERMISSIONS: readonly string[] = ALL_PERMISSIONS.filter(
  (permission) => !HISTORICAL_ALL_PERMISSIONS.includes(permission),
);

/**
 * True when `permissions` is exactly the pre-Stage-1 full catalogue — i.e. a
 * seeded Admin role nobody has customised.
 *
 * Order-insensitive and duplicate-tolerant, because the roles editor dedupes and
 * does not preserve catalogue order.
 */
export function isUntouchedHistoricalAdminSet(
  permissions: readonly string[],
): boolean {
  const held = new Set(permissions);
  return (
    held.size === HISTORICAL_ALL_PERMISSIONS.length &&
    HISTORICAL_ALL_PERMISSIONS.every((permission) => held.has(permission))
  );
}
