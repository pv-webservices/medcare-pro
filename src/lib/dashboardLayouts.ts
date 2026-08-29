import { Prisma } from "@prisma/client";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";
import { BadRequestError } from "@/lib/apiHandler";
import {
  DASHBOARD_LAYOUT_VERSION,
  DASHBOARD_WIDGET_LIST,
  filterDashboardLayout,
  normalizeDashboardLayout,
  resolveDashboardLayoutLayers,
  systemDashboardLayout,
  type DashboardLayoutConfig,
  type DashboardWidgetId,
} from "@/lib/dashboardWidgets";
import { resolveModulesForActor, resolveModulesForRole } from "@/lib/features";
import { mayManageRoleDashboardDefault } from "@/lib/dashboardLayoutAuthority";
import { permissionGrantKeys, WILDCARD } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import {
  PermissionError,
  ScopeError,
  accessibleClinicScopes,
  can,
  holdsAnywhere,
  permissionsHeldAnywhere,
  toPermissionList,
  type ActorContext,
} from "@/lib/rbac";

export type DashboardLayoutSource = "personal" | "role" | "system";

export interface EffectiveDashboardLayout {
  layout: DashboardLayoutConfig;
  source: DashboardLayoutSource;
  canCustomize: boolean;
  canManageRoleDefaults: boolean;
  inheritedRoleId: string | null;
}

function asJson(layout: DashboardLayoutConfig): Prisma.InputJsonValue {
  return layout as unknown as Prisma.InputJsonValue;
}

function roleHolds(permissions: readonly string[], permission: string): boolean {
  return permissions.includes(WILDCARD) || permissionGrantKeys(permission).some((key) => permissions.includes(key));
}

async function actorAccountWidePermissions(actor: ActorContext): Promise<Set<string>> {
  const assignments = await prisma.userRole.findMany({
    where: {
      userId: actor.userId,
      clinicId: null,
      role: { tenantId: actor.tenantId },
    },
    select: { role: { select: { permissions: true } } },
  });
  return new Set(assignments.flatMap((assignment) => [...toPermissionList(assignment.role.permissions)]));
}

export async function eligibleWidgetsForActor(actor: ActorContext): Promise<Set<DashboardWidgetId>> {
  const permissions = [
    "dashboard:view",
    ...new Set(DASHBOARD_WIDGET_LIST.map((widget) => widget.requiredPermission)),
  ];
  const [scopes, modules] = await Promise.all([
    accessibleClinicScopes(actor, permissions),
    resolveModulesForActor(actor),
  ]);
  if (scopes.get("dashboard:view")?.scope === "none") return new Set();

  return new Set(
    DASHBOARD_WIDGET_LIST.filter(
      (widget) =>
        scopes.get(widget.requiredPermission)?.scope !== "none" &&
        modules.get(widget.requiredModule)?.allowed === true,
    ).map((widget) => widget.id),
  );
}

async function loadRole(actor: ActorContext, roleId: string) {
  const role = await prisma.role.findFirst({
    where: { id: roleId, tenantId: actor.tenantId },
    select: { id: true, name: true, permissions: true },
  });
  if (!role) throw new ScopeError();
  return { ...role, permissionList: [...toPermissionList(role.permissions)] };
}

export async function eligibleWidgetsForRole(
  actor: ActorContext,
  roleId: string,
): Promise<Set<DashboardWidgetId>> {
  const [role, modules] = await Promise.all([
    loadRole(actor, roleId),
    resolveModulesForRole(actor, roleId),
  ]);
  if (!roleHolds(role.permissionList, "dashboard:view")) return new Set();

  return new Set(
    DASHBOARD_WIDGET_LIST.filter(
      (widget) =>
        roleHolds(role.permissionList, widget.requiredPermission) &&
        modules.get(widget.requiredModule)?.allowed === true,
    ).map((widget) => widget.id),
  );
}

async function personalRow(actor: ActorContext) {
  return prisma.dashboardLayout.findFirst({
    where: { tenantId: actor.tenantId, userId: actor.userId, roleId: null },
    select: { layout: true },
  });
}

/** A role default is used only when there is one distinct role. Multi-role users
 * fall back to the permission-filtered system layout; no role-name priority is invented. */
async function singleAssignedRoleId(actor: ActorContext): Promise<string | null> {
  const assignments = await prisma.userRole.findMany({
    where: { userId: actor.userId, role: { tenantId: actor.tenantId } },
    distinct: ["roleId"],
    select: { roleId: true },
  });
  return assignments.length === 1 ? assignments[0].roleId : null;
}

export async function getEffectiveDashboardLayout(
  actor: ActorContext,
): Promise<EffectiveDashboardLayout> {
  const [personal, roleId, eligible, held] = await Promise.all([
    personalRow(actor),
    singleAssignedRoleId(actor),
    eligibleWidgetsForActor(actor),
    permissionsHeldAnywhere(actor),
  ]);

  let roleDefault: unknown;
  if (!personal && roleId) {
    const roleDefaultRow = await prisma.dashboardLayout.findFirst({
      where: { tenantId: actor.tenantId, roleId, userId: null },
      select: { layout: true },
    });
    roleDefault = roleDefaultRow?.layout;
  }
  const resolved = resolveDashboardLayoutLayers({
    personal: personal?.layout,
    roleDefault,
    eligibleWidgetIds: eligible,
  });

  return {
    layout: resolved.layout,
    source: resolved.source,
    canCustomize: holdsAnywhere(held, "dashboard:customize"),
    canManageRoleDefaults: await can(actor, "dashboard:layout:manage"),
    inheritedRoleId: resolved.source === "role" ? roleId : null,
  };
}

function assertSubmittedWidgetsEligible(
  layout: DashboardLayoutConfig,
  eligible: ReadonlySet<DashboardWidgetId>,
): void {
  const refused = layout.widgets.find((widget) => !eligible.has(widget.widgetId));
  if (refused) {
    const permission = DASHBOARD_WIDGET_LIST.find((widget) => widget.id === refused.widgetId)?.requiredPermission;
    throw new PermissionError(permission ?? "dashboard:view");
  }
}

function mergedLayout(
  submitted: DashboardLayoutConfig,
  existing: unknown,
  eligible: ReadonlySet<DashboardWidgetId>,
): DashboardLayoutConfig {
  const preserved = normalizeDashboardLayout(existing).widgets.filter(
    (widget) => !eligible.has(widget.widgetId),
  );
  return normalizeDashboardLayout({
    version: DASHBOARD_LAYOUT_VERSION,
    widgets: [...submitted.widgets, ...preserved],
  });
}

export async function savePersonalDashboardLayout(
  actor: ActorContext,
  input: DashboardLayoutConfig,
): Promise<DashboardLayoutConfig> {
  const [held, eligible, existing] = await Promise.all([
    permissionsHeldAnywhere(actor),
    eligibleWidgetsForActor(actor),
    personalRow(actor),
  ]);
  if (!holdsAnywhere(held, "dashboard:customize")) throw new PermissionError("dashboard:customize");
  assertSubmittedWidgetsEligible(input, eligible);
  const layout = mergedLayout(input, existing?.layout, eligible);

  await prisma.$transaction(async (tx) => {
    await tx.dashboardLayout.upsert({
      where: { tenantId_userId: { tenantId: actor.tenantId, userId: actor.userId } },
      create: { tenantId: actor.tenantId, userId: actor.userId, layout: asJson(layout), version: DASHBOARD_LAYOUT_VERSION },
      update: { layout: asJson(layout), version: DASHBOARD_LAYOUT_VERSION },
    });
    await writeAuditLog(tx, {
      action: AUDIT_ACTIONS.DASHBOARD_LAYOUT_PERSONAL_SAVED,
      targetType: "DashboardLayout",
      targetId: actor.userId,
      actorUserId: actor.userId,
      actorTenantId: actor.tenantId,
      afterValue: { version: layout.version, widgets: layout.widgets.map(({ widgetId, order, visible, size }) => ({ widgetId, order, visible, size })) },
    });
  });
  return filterDashboardLayout(layout, eligible);
}

export async function resetPersonalDashboardLayout(actor: ActorContext): Promise<EffectiveDashboardLayout> {
  const held = await permissionsHeldAnywhere(actor);
  if (!holdsAnywhere(held, "dashboard:customize")) throw new PermissionError("dashboard:customize");
  await prisma.$transaction(async (tx) => {
    await tx.dashboardLayout.deleteMany({ where: { tenantId: actor.tenantId, userId: actor.userId, roleId: null } });
    await writeAuditLog(tx, {
      action: AUDIT_ACTIONS.DASHBOARD_LAYOUT_PERSONAL_RESET,
      targetType: "DashboardLayout",
      targetId: actor.userId,
      actorUserId: actor.userId,
      actorTenantId: actor.tenantId,
      afterValue: { source: "inherited" },
    });
  });
  return getEffectiveDashboardLayout(actor);
}

async function assertMayManageRoleDefault(actor: ActorContext, roleId: string) {
  if (!(await can(actor, "dashboard:layout:manage"))) {
    throw new PermissionError("dashboard:layout:manage");
  }
  const [role, actorPermissions] = await Promise.all([
    loadRole(actor, roleId),
    actorAccountWidePermissions(actor),
  ]);
  if (role.permissionList.includes(WILDCARD)) {
    throw new BadRequestError("The protected account-owner dashboard default cannot be changed.");
  }
  if (!mayManageRoleDashboardDefault({ actorPermissions, targetPermissions: role.permissionList })) {
    throw new BadRequestError("You can configure dashboard defaults only for roles below your own authority.");
  }
  return role;
}

export interface RoleDashboardLayoutResult {
  role: { id: string; name: string };
  layout: DashboardLayoutConfig;
  source: "role" | "system";
}

export async function getRoleDashboardLayout(
  actor: ActorContext,
  roleId: string,
): Promise<RoleDashboardLayoutResult> {
  const role = await assertMayManageRoleDefault(actor, roleId);
  const [eligible, stored] = await Promise.all([
    eligibleWidgetsForRole(actor, roleId),
    prisma.dashboardLayout.findFirst({
      where: { tenantId: actor.tenantId, roleId, userId: null },
      select: { layout: true },
    }),
  ]);
  return {
    role: { id: role.id, name: role.name },
    layout: filterDashboardLayout(normalizeDashboardLayout(stored?.layout), eligible),
    source: stored ? "role" : "system",
  };
}

export async function saveRoleDashboardLayout(
  actor: ActorContext,
  roleId: string,
  input: DashboardLayoutConfig,
): Promise<RoleDashboardLayoutResult> {
  const role = await assertMayManageRoleDefault(actor, roleId);
  const [eligible, existing] = await Promise.all([
    eligibleWidgetsForRole(actor, roleId),
    prisma.dashboardLayout.findFirst({ where: { tenantId: actor.tenantId, roleId, userId: null }, select: { layout: true } }),
  ]);
  assertSubmittedWidgetsEligible(input, eligible);
  const layout = mergedLayout(input, existing?.layout, eligible);

  await prisma.$transaction(async (tx) => {
    await tx.dashboardLayout.upsert({
      where: { tenantId_roleId: { tenantId: actor.tenantId, roleId } },
      create: { tenantId: actor.tenantId, roleId, layout: asJson(layout), version: DASHBOARD_LAYOUT_VERSION },
      update: { layout: asJson(layout), version: DASHBOARD_LAYOUT_VERSION },
    });
    await writeAuditLog(tx, {
      action: AUDIT_ACTIONS.DASHBOARD_LAYOUT_ROLE_SAVED,
      targetType: "Role",
      targetId: roleId,
      actorUserId: actor.userId,
      actorTenantId: actor.tenantId,
      afterValue: { version: layout.version, widgets: layout.widgets.map(({ widgetId, order, visible, size }) => ({ widgetId, order, visible, size })) },
    });
  });
  return { role: { id: role.id, name: role.name }, layout: filterDashboardLayout(layout, eligible), source: "role" };
}

export async function resetRoleDashboardLayout(
  actor: ActorContext,
  roleId: string,
): Promise<RoleDashboardLayoutResult> {
  const role = await assertMayManageRoleDefault(actor, roleId);
  await prisma.$transaction(async (tx) => {
    await tx.dashboardLayout.deleteMany({ where: { tenantId: actor.tenantId, roleId, userId: null } });
    await writeAuditLog(tx, {
      action: AUDIT_ACTIONS.DASHBOARD_LAYOUT_ROLE_RESET,
      targetType: "Role",
      targetId: roleId,
      actorUserId: actor.userId,
      actorTenantId: actor.tenantId,
      afterValue: { source: "system" },
    });
  });
  const eligible = await eligibleWidgetsForRole(actor, roleId);
  return { role: { id: role.id, name: role.name }, layout: filterDashboardLayout(systemDashboardLayout(), eligible), source: "system" };
}

export async function getManageableDashboardRoles(
  actor: ActorContext,
): Promise<Array<{ id: string; name: string }>> {
  if (!(await can(actor, "dashboard:layout:manage"))) return [];
  const [roles, actorPermissions] = await Promise.all([
    prisma.role.findMany({
      where: { tenantId: actor.tenantId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, permissions: true },
    }),
    actorAccountWidePermissions(actor),
  ]);
  return roles.flatMap((role) => {
    const targetPermissions = [...toPermissionList(role.permissions)];
    return mayManageRoleDashboardDefault({ actorPermissions, targetPermissions })
      ? [{ id: role.id, name: role.name }]
      : [];
  });
}
