import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({
  requireActor: vi.fn(),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    userRole: { findMany: vi.fn() },
    role: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));
import { ALL_PERMISSIONS, PERMISSION_GROUPS, isKnownPermission } from "@/lib/permissions";
import { DEFAULT_ROLES } from "@/lib/defaultRoles";
import { CATALOGUE_FEATURE_KEYS, MODULE_FEATURES } from "@/lib/moduleFeatures";
import { prisma } from "@/lib/prisma";
import { createRole, createRoleSchema, roleMutationSchema, updateRole } from "@/lib/roles";

const retired = [
  "clinical-ai:writing",
  "clinical-ai:recording",
  "clinical-ai:transcription",
  "clinical-ai:transcript-read",
  "clinical-ai:facts-extract",
  "clinical-ai:facts-review",
  "dashboard:customize",
  "dashboard:layout:manage",
];
const actor = { userId: "owner-1", tenantId: "tenant-1" };
const role = { id: "role-1", name: "Reception", permissions: ["patient:read"] };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(prisma.userRole.findMany).mockResolvedValue([
    { role: { permissions: ["*"] } },
  ] as never);
  vi.mocked(prisma.role.findFirst).mockResolvedValue(role as never);
});

describe("retired permissions after RM-4", () => {
  it.each(retired)("does not recognise or offer %s", (key) => {
    expect(isKnownPermission(key)).toBe(false);
    expect(ALL_PERMISSIONS).not.toContain(key);
    expect(PERMISSION_GROUPS.flatMap((group) => group.permissions.map((p) => p.key))).not.toContain(key);
    for (const seeded of DEFAULT_ROLES) expect(seeded.permissions).not.toContain(key);
  });

  it.each(retired)("rejects creating and updating roles with %s in the write path", async (key) => {
    const permissions = ["patient:read", key];
    const create = createRoleSchema.parse({ name: "Reception", permissions });
    const update = roleMutationSchema.parse({ action: "updateRole", roleId: role.id, permissions });
    expect(create.permissions).toEqual(permissions);
    expect(update.action).toBe("updateRole");
    if (update.action !== "updateRole") throw new Error("Wrong mutation");
    const message = `Unknown permission: ${key}. Pick from the listed permissions.`;
    await expect(createRole(actor, create)).rejects.toThrow(message);
    await expect(updateRole(actor, update)).rejects.toThrow(message);
    expect(prisma.role.create).not.toHaveBeenCalled();
    expect(prisma.role.update).not.toHaveBeenCalled();
  });

  it("still creates and saves a role carrying only current permissions", async () => {
    const permissions = ["patient:read", "registration:read"];
    vi.mocked(prisma.role.create).mockResolvedValue({ ...role, permissions } as never);
    vi.mocked(prisma.role.update).mockResolvedValue({ ...role, permissions, _count: { userRoles: 0 } } as never);
    await expect(createRole(actor, createRoleSchema.parse({ name: "Reception", permissions })))
      .resolves.toMatchObject({ permissions });
    await expect(updateRole(actor, { action: "updateRole", roleId: role.id, permissions }))
      .resolves.toMatchObject({ permissions });
  });

  it("keeps schema de-duplication and the current catalogue length limit", () => {
    expect(createRoleSchema.parse({ name: "Reception", permissions: ["patient:read", "patient:read"] }).permissions)
      .toEqual(["patient:read"]);
    expect(roleMutationSchema.safeParse({
      action: "updateRole", roleId: role.id, permissions: [...ALL_PERMISSIONS, "patient:read"],
    }).success).toBe(false);
  });

  it("preserves live dashboard vocabulary aliases", async () => {
    const permissions = ["dashboard:registrations:view", "dashboard:notifications:view"];
    vi.mocked(prisma.role.create).mockResolvedValue({ ...role, permissions } as never);
    for (const key of permissions) expect(isKnownPermission(key)).toBe(true);
    await expect(createRole(actor, createRoleSchema.parse({ name: "Legacy vocabulary", permissions })))
      .resolves.toMatchObject({ permissions });
  });

  it("keeps Clinical AI out of the feature catalogue and module map", () => {
    expect(PERMISSION_GROUPS.map((group) => group.module)).not.toContain("Clinical AI");
    expect(CATALOGUE_FEATURE_KEYS).not.toContain("clinical_ai");
    expect(Object.values(MODULE_FEATURES)).not.toContain("clinical_ai");
  });
});
