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
        description: "Send an approved template message to a patient.",
        pending: "stage",
        pendingNote: "WhatsApp is not built yet — this grants nothing today.",
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
