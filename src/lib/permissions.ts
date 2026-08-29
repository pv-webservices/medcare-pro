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

/**
 * Dashboard permissions deliberately live in their own namespace. They only
 * control populated dashboard cards and summaries; operational permissions
 * such as `appointment:create` continue to control actions and module pages.
 */
export const DASHBOARD_DATA_PERMISSIONS = [
  "dashboard:view",
  "dashboard:appointments:view",
  "dashboard:registrations:view",
  "dashboard:revenue:view",
  "dashboard:doctors:view",
  "dashboard:activity:view",
  "dashboard:notifications:view",
  "dashboard:team:view",
  "dashboard:clinics:view",
] as const;

export type DashboardDataPermission =
  (typeof DASHBOARD_DATA_PERMISSIONS)[number];

export const DASHBOARD_PERMISSION_GROUP: PermissionGroup = {
  module: "Dashboard Data",
  permissions: [
    {
      key: "dashboard:view",
      label: "View dashboard",
      description: "Open the operational dashboard and see permitted sections.",
    },
    {
      key: "dashboard:appointments:view",
      label: "View appointment data",
      description: "See appointment counts, status summaries, and schedules on the dashboard.",
    },
    {
      key: "dashboard:registrations:view",
      label: "View registration data",
      description: "See registration counts and recent patient visits on the dashboard.",
    },
    {
      key: "dashboard:revenue:view",
      label: "View revenue data",
      description: "See revenue totals on the dashboard.",
    },
    {
      key: "dashboard:doctors:view",
      label: "View doctor data",
      description: "See doctor availability and coverage on the dashboard.",
    },
    {
      key: "dashboard:activity:view",
      label: "View activity data",
      description: "See recent clinic activity on the dashboard.",
    },
    {
      key: "dashboard:notifications:view",
      label: "View notification data",
      description: "See notification summaries and recent alerts on the dashboard.",
    },
    {
      key: "dashboard:team:view",
      label: "View team data",
      description: "See team summaries on the dashboard when available.",
    },
    {
      key: "dashboard:clinics:view",
      label: "View clinic data",
      description: "See clinic-wide summaries and comparisons on the dashboard when available.",
    },
  ],
};

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
  // -------------------------------------------------------------------------
  // Stage 11 addition — the audit trail's first reader.
  //
  // Enforced from the day it was added, so it never carried a `pending` mark.
  // Existing organisations get it through scripts/backfill-stage11.mts, which
  // tops up only Admin roles nobody has edited — the same rule the Stage 1
  // backfill keeps.
  // -------------------------------------------------------------------------
  {
    module: "Activity log",
    permissions: [
      {
        key: "audit:read",
        label: "View activity log",
        description:
          "See who did what in this organisation and when — team changes, role and feature changes, and the decisions MEDCARE PRO took about the account.",
      },
    ],
  },
  // -------------------------------------------------------------------------
  // AP-1 addition — appointments.
  //
  // AP-1 landed the catalogue and the schema with all eight marked `pending`,
  // and the marks come off one at a time as each stage builds its gate. Per
  // this file's own rule, a string here that no call site checks grants
  // NOTHING, and saying otherwise on the roles screen is a false promise of
  // protection — so a unit test holds each key to its actual state.
  //
  // LIVE:    appointment:read (AP-2), appointment:create (AP-3),
  //          appointment:type:manage (AP-3), appointment:reschedule,
  //          appointment:cancel, appointment:checkin (AP-4),
  //          appointment:convert (AP-5), appointment:update (AP-9).
  // PENDING: none. AP-9 took the last mark off, so every appointment key in
  //          this catalogue now has a call site that checks it.
  //
  // Listing them now rather than per stage means ONE permission backfill over
  // live tenants instead of four. scripts/backfill-ap1-appointments.mts tops up
  // only roles that still match their frozen pre-AP-1 snapshot exactly.
  //
  // Note also that holding one of these grants nothing on its own even once the
  // call sites exist: `appointments` is a PREMIUM feature, so an organisation
  // must be entitled to it AND a Clinic Admin must switch it on for the role.
  // See src/lib/defaultFeatures.ts.
  // -------------------------------------------------------------------------
  {
    module: "Appointments",
    permissions: [
      {
        key: "appointment:read",
        label: "View appointments",
        description:
          "See the appointment board and each booking's details, within the clinics this person can reach.",
        // LIVE since AP-2. Checked by getAppointmentSlots and listAppointments
        // in lib/appointments.ts, and by listAppointmentTypes — the booking
        // form has to be able to read the price list it books against.
      },
      {
        key: "appointment:create",
        label: "Book appointments",
        description:
          "Book a patient into a doctor's free slot. Booking does not create a patient record — converting does.",
        // LIVE since AP-3. Checked by createAppointment.
      },
      {
        key: "appointment:update",
        label: "Edit appointments",
        description:
          "Correct a booking's patient details or amount without moving it to a different slot, and record that the patient has confirmed.",
        // LIVE since AP-9. Checked by updateAppointment in
        // lib/appointmentEdit.ts and by confirmAppointment in
        // lib/appointmentLifecycle.ts.
        //
        // TWO CALL SITES, ONE AUTHORITY, and that is a decision worth finding
        // here rather than in a diff. Confirming is the desk writing down that
        // the patient said they are coming; the roles that may correct a
        // booking are exactly the roles that should be able to record that. A
        // ninth appointment key would have meant a new stage permission list, a
        // backfill for every existing role and two widened catalogue tests, and
        // would have left every organisation that already granted the eight
        // with a button nobody could press until an admin noticed.
      },
      {
        key: "appointment:reschedule",
        label: "Reschedule appointments",
        description:
          "Move a booking to a different slot. The original is kept and marked rescheduled, never deleted.",
        // LIVE since AP-4. Checked by rescheduleAppointment in
        // lib/appointmentReschedule.ts, which also re-derives the target doctor
        // against this permission's own clinic scope.
      },
      {
        key: "appointment:cancel",
        label: "Cancel appointments",
        description:
          "Cancel a booking or mark it a no-show, freeing the slot. The record is kept either way.",
        // LIVE since AP-4. ONE key for both outcomes, as the description has
        // always said: cancelling and marking a no-show are the same authority
        // — deciding a booked slot will not be used — and the audit trail is
        // what tells the two apart. Checked by cancelAppointment and
        // markAppointmentNoShow in lib/appointmentLifecycle.ts.
      },
      {
        key: "appointment:checkin",
        label: "Check patients in",
        description: "Mark a patient as arrived for their appointment.",
        // LIVE since AP-4. Checked by checkInAppointment in
        // lib/appointmentLifecycle.ts. Separate from cancelling because
        // arriving is the front desk's routine work while calling a slot off is
        // a decision, and AP-5 will convert only from CHECKED_IN.
      },
      {
        key: "appointment:convert",
        label: "Convert appointments",
        description:
          "Turn an arrived appointment into a registration, creating the patient record and code if this is their first visit.",
        // LIVE since AP-5. Checked by convertAppointmentToRegistration in
        // lib/appointmentConversion.ts, and it is the ONLY key that path
        // checks: the catalogue entry above already says conversion creates the
        // patient record, so also demanding `registration:create` would let a
        // role hold this key and still be refused by a second one it was never
        // told about. Every seeded role that holds convert holds both anyway.
        //
        // Only a CHECKED_IN appointment converts — arriving is what makes a
        // visit real — and CONVERTED is terminal, so this permission cannot
        // be used twice on the same booking.
      },
      {
        key: "appointment:type:manage",
        label: "Manage appointment types",
        description:
          "Create, rename, re-price, activate and deactivate the bookable services and their durations. Separate from booking: the front desk books appointments, it does not set the price list.",
        // LIVE since AP-3. Checked by createAppointmentType and
        // updateAppointmentType, and by listAppointmentTypes for the
        // includeInactive widening. Brought forward from AP-6/AP-7: nothing can
        // be booked until at least one type exists, so the API had to arrive
        // with booking rather than with the screen that drives it.
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
  DASHBOARD_PERMISSION_GROUP,
] as const;

/** Operational/action permissions shown separately from Dashboard Data. */
export const ACTION_PERMISSION_GROUPS: readonly PermissionGroup[] =
  PERMISSION_GROUPS.filter((group) => group.module !== DASHBOARD_PERMISSION_GROUP.module);

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

/** Everything Stage 11 added to the catalogue. */
export const STAGE_11_PERMISSIONS: readonly string[] = ["audit:read"];

/**
 * Everything AP-1 added to the catalogue.
 *
 * Hand-listed like STAGE_11_PERMISSIONS rather than derived, because the
 * derivation would be circular: the lists below subtract this one from
 * ALL_PERMISSIONS, and ALL_PERMISSIONS already contains these keys. Declared
 * ABOVE the lists that filter on it — these are `const`, so a reference from a
 * module-scope initialiser that ran first would throw.
 *
 * A unit test holds this against the catalogue, so a key added to the
 * Appointments group without being added here fails `npm test`.
 */
export const STAGE_AP1_PERMISSIONS: readonly string[] = [
  "appointment:read",
  "appointment:create",
  "appointment:update",
  "appointment:reschedule",
  "appointment:cancel",
  "appointment:checkin",
  "appointment:convert",
  "appointment:type:manage",
];

/**
 * Everything added to the catalogue by Stage 1.
 *
 * Derived rather than hand-listed so the two can never drift: adding a key to a
 * Stage 1 group above puts it here automatically.
 *
 * A LATER STAGE'S KEYS MUST BE SUBTRACTED, which is what the second filter is
 * for. Without it `audit:read` would land in this list the moment Stage 11 added
 * it, and scripts/backfill-stage1.mts — which appends exactly this list to
 * untouched pre-Stage-1 Admin roles — would silently start doing Stage 11's job
 * under Stage 1's name. Every future stage that adds a key must be subtracted
 * here too; the unit tests check that the lists stay disjoint and complete.
 *
 * AP-1's eight appointment keys are the third filter, for the same reason.
 */
export const STAGE_1_PERMISSIONS: readonly string[] = ALL_PERMISSIONS.filter(
  (permission) =>
    !HISTORICAL_ALL_PERMISSIONS.includes(permission) &&
    !STAGE_11_PERMISSIONS.includes(permission) &&
    !STAGE_AP1_PERMISSIONS.includes(permission) &&
    !DASHBOARD_DATA_PERMISSIONS.includes(
      permission as DashboardDataPermission,
    ),
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

// ---------------------------------------------------------------------------
// Stage 11 — one new key, and the same top-up rule Stage 1 established.
// ---------------------------------------------------------------------------

/**
 * The catalogue exactly as it stood BEFORE Stage 11.
 *
 * Derived rather than frozen as a literal, unlike HISTORICAL_ALL_PERMISSIONS.
 * That snapshot had to be frozen because the keys it names were added to the
 * live catalogue in the same change; this one is simply "everything except what
 * Stage 11 added", which stays correct on its own as long as STAGE_11_PERMISSIONS
 * is accurate — and a unit test checks that it is.
 *
 * AP-1'S KEYS MUST BE SUBTRACTED HERE TOO, and the reason is easy to miss.
 * `isUntouchedPreStage11AdminSet` compares an Admin's stored permissions to
 * this list by EXACT SET EQUALITY. A pre-Stage-11 Admin holds the catalogue as
 * it stood before `audit:read` — which, of course, contains no appointment keys
 * either. Leave them in this list and that comparison never matches again, so
 * scripts/backfill-stage11.mts silently stops handing out `audit:read` to the
 * organisations still owed it, reporting them as "customised" instead. Nothing
 * would fail; the backfill would just quietly do nothing.
 */
export const PRE_STAGE_11_PERMISSIONS: readonly string[] = ALL_PERMISSIONS.filter(
  (permission) =>
    !STAGE_11_PERMISSIONS.includes(permission) &&
    !STAGE_AP1_PERMISSIONS.includes(permission) &&
    !DASHBOARD_DATA_PERMISSIONS.includes(
      permission as DashboardDataPermission,
    ),
);

/**
 * True when `permissions` is exactly the pre-Stage-11 catalogue — i.e. a seeded
 * Admin role nobody has customised since the Stage 1 backfill.
 *
 * A role that does NOT match is left byte-for-byte alone. That includes an
 * Admin still holding only the pre-Stage-1 twenty keys: it needs the Stage 1
 * backfill first, and topping it up with `audit:read` alone would leave it in a
 * state no seed ever produces.
 */
export function isUntouchedPreStage11AdminSet(
  permissions: readonly string[],
): boolean {
  const held = new Set(permissions);
  return (
    held.size === PRE_STAGE_11_PERMISSIONS.length &&
    PRE_STAGE_11_PERMISSIONS.every((permission) => held.has(permission))
  );
}

// ---------------------------------------------------------------------------
// AP-1 — eight new keys, and the same top-up rule Stage 1 established.
// ---------------------------------------------------------------------------

/**
 * The catalogue exactly as it stood BEFORE AP-1 — i.e. including `audit:read`,
 * which Stage 11 had already added by then.
 *
 * Derived, like PRE_STAGE_11_PERMISSIONS and for the same reason: it is simply
 * "everything except what AP-1 added", which stays correct on its own as long
 * as STAGE_AP1_PERMISSIONS is accurate. A unit test checks that it is.
 */
export const PRE_APPOINTMENTS_PERMISSIONS: readonly string[] =
  ALL_PERMISSIONS.filter(
    (permission) =>
      !STAGE_AP1_PERMISSIONS.includes(permission) &&
      !DASHBOARD_DATA_PERMISSIONS.includes(
        permission as DashboardDataPermission,
      ),
  );

/**
 * True when `permissions` is exactly the pre-AP-1 catalogue — i.e. a seeded
 * Admin role nobody has customised since the Stage 11 backfill.
 *
 * A role that does NOT match is left byte-for-byte alone. That deliberately
 * includes an Admin still stuck at an earlier rung — one holding only the
 * pre-Stage-1 twenty, or the pre-Stage-11 set. Those need their own backfill
 * first; appending appointment keys to them would leave them in a state no seed
 * ever produced, which is harder to reason about later than simply being behind.
 * Run the backfills in order: stage1, then stage11, then this one.
 */
export function isUntouchedPreAppointmentsAdminSet(
  permissions: readonly string[],
): boolean {
  const held = new Set(permissions);
  return (
    held.size === PRE_APPOINTMENTS_PERMISSIONS.length &&
    PRE_APPOINTMENTS_PERMISSIONS.every((permission) => held.has(permission))
  );
}
