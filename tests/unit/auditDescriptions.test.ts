import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS } from "@/lib/audit";
import {
  AUDIT_CATEGORIES,
  AUDIT_DESCRIPTIONS,
  SIGN_IN_NOISE_ACTIONS,
  actionsInCategory,
  describeAuditAction,
  isAuditCategory,
} from "@/lib/auditDescriptions";
import {
  ALL_PERMISSIONS,
  DASHBOARD_DATA_PERMISSIONS,
  DASHBOARD_LAYOUT_PERMISSIONS,
  HISTORICAL_ALL_PERMISSIONS,
  PRE_STAGE_11_PERMISSIONS,
  STAGE_1_PERMISSIONS,
  STAGE_11_PERMISSIONS,
  STAGE_AP1_PERMISSIONS,
  TASK_PERMISSIONS,
  findPermission,
  isUntouchedPreStage11AdminSet,
} from "@/lib/permissions";

/**
 * The audit trail's read layer — Stage 11.
 *
 * The failure this exists to catch is the quiet one: a later stage adds an
 * audit action, writes it, and it renders on two screens and in a CSV as
 * `SOME_NEW_ACTION` — which looks deliberate, and tells a clinic manager
 * nothing.
 */

const ACTION_VALUES = Object.values(AUDIT_ACTIONS);

describe("AUDIT_DESCRIPTIONS", () => {
  it("describes every action the app can write", () => {
    // The whole point. Adding an action to AUDIT_ACTIONS without describing it
    // fails here rather than shipping as a raw constant name.
    for (const action of ACTION_VALUES) {
      expect(AUDIT_DESCRIPTIONS[action]).toBeDefined();
    }
  });

  it("describes nothing the app cannot write", () => {
    // The other direction: a description left behind after an action was
    // renamed would sit in the category filter forever, matching no rows.
    for (const action of Object.keys(AUDIT_DESCRIPTIONS)) {
      expect(ACTION_VALUES).toContain(action);
    }
  });

  it("gives each one a label and a detail that are not the constant name", () => {
    for (const [action, description] of Object.entries(AUDIT_DESCRIPTIONS)) {
      expect(description.label.length).toBeGreaterThan(0);
      expect(description.label).not.toBe(action);
      expect(description.detail.length).toBeGreaterThan(10);
    }
  });

  it("uses only categories the filter control offers", () => {
    for (const description of Object.values(AUDIT_DESCRIPTIONS)) {
      expect(isAuditCategory(description.category)).toBe(true);
    }
  });

  it("puts every category to use, so no filter option matches nothing", () => {
    for (const category of AUDIT_CATEGORIES) {
      expect(actionsInCategory(category.key).length).toBeGreaterThan(0);
    }
  });

  it("assigns every action to exactly one category", () => {
    const counted = AUDIT_CATEGORIES.flatMap((category) =>
      actionsInCategory(category.key),
    );
    expect(counted.length).toBe(ACTION_VALUES.length);
    expect(new Set(counted).size).toBe(counted.length);
  });
});

describe("which side an action belongs to", () => {
  it("marks the platform's own entitlement acts as platform-side", () => {
    // These are the rows a tenant screen must attribute to MEDCARE PRO rather
    // than to somebody in the clinic, or an admin will go looking for a
    // colleague who did not do it.
    for (const action of [
      AUDIT_ACTIONS.CLINIC_APPROVED,
      AUDIT_ACTIONS.CLINIC_SUSPENDED,
      AUDIT_ACTIONS.TENANT_ENTITLEMENTS_SET,
      AUDIT_ACTIONS.FEATURE_GLOBAL_DISABLED,
      AUDIT_ACTIONS.PLAN_FEATURE_REMOVED,
    ]) {
      expect(AUDIT_DESCRIPTIONS[action].side).toBe("platform");
    }
  });

  it("marks the tenant's own decisions as tenant-side", () => {
    for (const action of [
      AUDIT_ACTIONS.TEAM_MEMBER_REMOVED,
      AUDIT_ACTIONS.TEAM_MEMBER_SUSPENDED,
      AUDIT_ACTIONS.TEAM_INVITATION_CREATED,
      AUDIT_ACTIONS.ROLE_FEATURE_DISABLED,
    ]) {
      expect(AUDIT_DESCRIPTIONS[action].side).toBe("tenant");
    }
  });

  it("counts the login-code actions as sign-in noise", () => {
    // They outnumber every decision and answer a different question, so the
    // default view hides them. They stay reachable through the category filter.
    for (const action of [
      AUDIT_ACTIONS.LOGIN_CODE_REQUESTED,
      AUDIT_ACTIONS.LOGIN_CODE_FAILED,
      AUDIT_ACTIONS.SESSION_CREATED,
    ]) {
      expect(SIGN_IN_NOISE_ACTIONS).toContain(action);
    }
  });

  it("never treats a decision as noise", () => {
    for (const action of [
      AUDIT_ACTIONS.TEAM_MEMBER_REMOVED,
      AUDIT_ACTIONS.CLINIC_SUSPENDED,
      AUDIT_ACTIONS.FEATURE_GLOBAL_DISABLED,
      AUDIT_ACTIONS.SESSIONS_REVOKED_ALL,
    ]) {
      expect(SIGN_IN_NOISE_ACTIONS).not.toContain(action);
    }
  });
});

describe("describeAuditAction", () => {
  it("returns the description for a known action", () => {
    expect(describeAuditAction(AUDIT_ACTIONS.CLINIC_APPROVED).label).toBe(
      "Organisation approved",
    );
  });

  it("falls back to the raw string rather than throwing", () => {
    // An audit screen is the wrong place to turn a missing description into a
    // blank page — the row stays visible and the test above catches the gap.
    const unknown = describeAuditAction("SOMETHING_A_LATER_STAGE_ADDED");
    expect(unknown.label).toBe("SOMETHING_A_LATER_STAGE_ADDED");
    expect(unknown.detail.length).toBeGreaterThan(0);
  });
});

describe("the audit:read permission", () => {
  it("is in the catalogue and enforced from the start", () => {
    expect(ALL_PERMISSIONS).toContain("audit:read");
    // Never carried a `pending` mark: it shipped with its call sites.
    expect(findPermission("audit:read")?.pending).toBeUndefined();
  });

  it("is exactly what Stage 11 added", () => {
    expect([...STAGE_11_PERMISSIONS]).toEqual(["audit:read"]);
  });

  it("is kept out of STAGE_1_PERMISSIONS, which a backfill script appends", () => {
    // The bug this pins: STAGE_1_PERMISSIONS is derived as "everything not in
    // the pre-Stage-1 snapshot", so a key added by ANY later stage lands in it
    // unless subtracted. scripts/backfill-stage1.mts appends exactly that list
    // to untouched Admin roles, so the failure mode is Stage 1's backfill
    // quietly granting a later stage's permission under Stage 1's name.
    for (const permission of STAGE_11_PERMISSIONS) {
      expect(STAGE_1_PERMISSIONS).not.toContain(permission);
    }
  });

  it("leaves the stage lists disjoint and, together, complete", () => {
    // AP-1 added a THIRD stage list. This assertion is why: it failed the
    // moment the appointment keys entered the catalogue without one, which is
    // the guardrail doing its job rather than a test that needed relaxing.
    // Every future stage joins this array too.
    const combined = [
      ...STAGE_1_PERMISSIONS,
      ...STAGE_11_PERMISSIONS,
      ...STAGE_AP1_PERMISSIONS,
      ...TASK_PERMISSIONS,
      ...DASHBOARD_DATA_PERMISSIONS,
      ...DASHBOARD_LAYOUT_PERMISSIONS,
    ];
    expect(new Set(combined).size).toBe(combined.length);

    // Every catalogue key belongs either to the frozen pre-Stage-1 snapshot or
    // to exactly one stage list. A key in none of them would be invisible to
    // every backfill and would reach existing organisations never.
    for (const permission of ALL_PERMISSIONS) {
      const accounted =
        HISTORICAL_ALL_PERMISSIONS.includes(permission) ||
        combined.includes(permission);
      expect(accounted).toBe(true);
    }
  });

  it("is the only difference between the catalogue and its pre-Stage-11 snapshot", () => {
    // PRE_STAGE_11_PERMISSIONS is derived, not frozen, so this is what keeps it
    // honest — and the backfill depends on it being exactly right.
    //
    // AP-1's keys are subtracted from it as well, and must be discounted here
    // too. The reason is easy to miss: isUntouchedPreStage11AdminSet compares
    // by EXACT SET EQUALITY against this list, and a genuine pre-Stage-11 Admin
    // holds no appointment keys either. Leaving them in would mean that
    // comparison never matches again and scripts/backfill-stage11.mts silently
    // stops handing out audit:read to the organisations still owed it.
    expect(PRE_STAGE_11_PERMISSIONS.length).toBe(
      ALL_PERMISSIONS.length -
        STAGE_11_PERMISSIONS.length -
        STAGE_AP1_PERMISSIONS.length -
        TASK_PERMISSIONS.length -
        DASHBOARD_DATA_PERMISSIONS.length -
        DASHBOARD_LAYOUT_PERMISSIONS.length,
    );
    for (const permission of [
      ...STAGE_11_PERMISSIONS,
      ...STAGE_AP1_PERMISSIONS,
      ...TASK_PERMISSIONS,
      ...DASHBOARD_DATA_PERMISSIONS,
      ...DASHBOARD_LAYOUT_PERMISSIONS,
    ]) {
      expect(PRE_STAGE_11_PERMISSIONS).not.toContain(permission);
    }
  });
});

describe("isUntouchedPreStage11AdminSet", () => {
  it("matches a seeded Admin nobody has edited since the Stage 1 backfill", () => {
    expect(isUntouchedPreStage11AdminSet([...PRE_STAGE_11_PERMISSIONS])).toBe(true);
  });

  it("ignores ordering, because the roles editor does not preserve it", () => {
    expect(
      isUntouchedPreStage11AdminSet([...PRE_STAGE_11_PERMISSIONS].reverse()),
    ).toBe(true);
  });

  it("does not match a role with a permission removed or added", () => {
    expect(isUntouchedPreStage11AdminSet(PRE_STAGE_11_PERMISSIONS.slice(1))).toBe(
      false,
    );
    expect(
      isUntouchedPreStage11AdminSet([...PRE_STAGE_11_PERMISSIONS, "audit:read"]),
    ).toBe(false);
  });

  it("is idempotent — a topped-up Admin does not match a second time", () => {
    expect(isUntouchedPreStage11AdminSet([...ALL_PERMISSIONS])).toBe(false);
  });

  it("does not match the Owner role", () => {
    // The wildcard picks up new catalogue entries on its own; touching it would
    // be both unnecessary and a way to accidentally narrow it.
    expect(isUntouchedPreStage11AdminSet(["*"])).toBe(false);
  });

  it("does not match an Admin still on the pre-Stage-1 catalogue", () => {
    // That role needs the Stage 1 backfill first. Adding audit:read alone would
    // leave it in a state no seed ever produces.
    expect(isUntouchedPreStage11AdminSet(["clinic:read", "clinic:edit"])).toBe(
      false,
    );
  });
});
