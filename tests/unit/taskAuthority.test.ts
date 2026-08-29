import { describe, expect, it } from "vitest";
import {
  canAssignTaskToUser,
  mayViewTask,
  taskMutationAuthority,
} from "@/lib/taskAuthority";

const admin = new Set(["task:view", "task:create", "task:assign", "task:update", "task:complete", "task:delete", "task:manage", "team:manage", "doctor:read"]);
const doctor = new Set(["task:view", "task:create", "task:complete", "doctor:read"]);
const receptionist = new Set(["task:view", "task:create", "task:complete"]);
const staff = new Set(["task:view", "task:complete"]);

function refusal(overrides: Partial<Parameters<typeof canAssignTaskToUser>[0]> = {}) {
  return canAssignTaskToUser({
    actorPermissions: admin,
    targetPermissions: doctor,
    isAccountOwner: false,
    sameTenant: true,
    actorHasTaskAssign: true,
    actorClinicScopeCoversTargetClinic: true,
    actorHasTenantWideAuthority: false,
    targetHasTenantWideAuthority: false,
    targetIsActive: true,
    ...overrides,
  });
}

describe("task assignment authority", () => {
  it("lets an account owner assign to clinic admin and wildcard holders", () => {
    expect(refusal({ isAccountOwner: true, targetPermissions: admin })).toBeNull();
    expect(refusal({ isAccountOwner: true, targetPermissions: new Set(["*"]) })).toBeNull();
  });

  it("lets clinic admin assign doctor, receptionist and staff in scope", () => {
    expect(refusal({ targetPermissions: doctor })).toBeNull();
    expect(refusal({ targetPermissions: receptionist })).toBeNull();
    expect(refusal({ targetPermissions: staff })).toBeNull();
  });

  it("blocks clinic admin from owner and equal admin", () => {
    expect(refusal({ targetPermissions: new Set(["*"]) })).toBe("target-owner");
    expect(refusal({ targetPermissions: admin })).toBe("target-not-below-actor");
  });

  it("blocks receptionist and doctor from clinic admin", () => {
    expect(refusal({ actorPermissions: receptionist, targetPermissions: admin })).toBe("target-not-below-actor");
    expect(refusal({ actorPermissions: doctor, targetPermissions: admin })).toBe("target-not-below-actor");
  });

  it("blocks staff from doctor, admin and owner", () => {
    expect(refusal({ actorPermissions: staff, targetPermissions: doctor })).toBe("target-not-below-actor");
    expect(refusal({ actorPermissions: staff, targetPermissions: admin })).toBe("target-not-below-actor");
    expect(refusal({ actorPermissions: staff, targetPermissions: new Set(["*"]) })).toBe("target-owner");
  });

  it("requires task:assign and clinic coverage", () => {
    expect(refusal({ actorHasTaskAssign: false })).toBe("missing-task-assign");
    expect(refusal({ actorClinicScopeCoversTargetClinic: false })).toBe("clinic-out-of-scope");
  });

  it("rejects cross-tenant, inactive and tenant-wide higher targets", () => {
    expect(refusal({ sameTenant: false })).toBe("different-tenant");
    expect(refusal({ targetIsActive: false })).toBe("target-user-inactive");
    expect(refusal({ targetHasTenantWideAuthority: true, actorHasTenantWideAuthority: false })).toBe("target-not-below-actor");
  });
});

describe("task visibility", () => {
  it("shows assigned and created tasks to a viewer", () => {
    expect(mayViewTask({ isCreator: false, isAssignee: true, hasView: true, hasManage: false })).toBe(true);
    expect(mayViewTask({ isCreator: true, isAssignee: false, hasView: true, hasManage: false })).toBe(true);
  });

  it("lets managers view any task and blocks unrelated viewers", () => {
    expect(mayViewTask({ isCreator: false, isAssignee: false, hasView: false, hasManage: true })).toBe(true);
    expect(mayViewTask({ isCreator: false, isAssignee: false, hasView: true, hasManage: false })).toBe(false);
  });
});

describe("task mutation authority", () => {
  it("requires update for creator edits and complete for assignee completion", () => {
    expect(taskMutationAuthority({ isCreator: true, isAssignee: false, hasUpdate: true, hasComplete: false, hasDelete: false, hasManage: false }).canEdit).toBe(true);
    expect(taskMutationAuthority({ isCreator: false, isAssignee: true, hasUpdate: false, hasComplete: true, hasDelete: false, hasManage: false }).canComplete).toBe(true);
  });

  it("requires delete or manage for archive and manage broadens all actions", () => {
    expect(taskMutationAuthority({ isCreator: false, isAssignee: false, hasUpdate: false, hasComplete: false, hasDelete: true, hasManage: false }).canArchive).toBe(true);
    expect(taskMutationAuthority({ isCreator: false, isAssignee: false, hasUpdate: false, hasComplete: false, hasDelete: false, hasManage: true })).toEqual({ canEdit: true, canComplete: true, canArchive: true });
  });
});
