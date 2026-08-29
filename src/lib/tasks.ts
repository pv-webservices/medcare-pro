import type { Prisma, TaskPriority, TaskStatus } from "@prisma/client";
import { z } from "zod";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";
import { BadRequestError } from "@/lib/apiHandler";
import { requireModule } from "@/lib/features";
import { MODULE_FEATURES } from "@/lib/moduleFeatures";
import { WILDCARD } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import {
  accessibleClinicScopes,
  assertClinicInTenant,
  can,
  PermissionError,
  requirePermission,
  ScopeError,
  toPermissionList,
  type ActorContext,
  type ClinicScope,
} from "@/lib/rbac";
import {
  canAssignTaskToUser,
  mayViewTask,
  taskMutationAuthority,
  type TaskAssignmentRefusal,
} from "@/lib/taskAuthority";

const dueAtSchema = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Enter a valid due date and time.");

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, "Enter a task title.").max(160),
  description: z.string().trim().max(5000).optional().nullable(),
  clinicId: z.string().trim().min(1).optional().nullable(),
  assignedToId: z.string().trim().min(1).optional().nullable(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  dueAt: dueAtSchema.optional().nullable(),
});

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1, "Enter a task title.").max(160).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    assignedToId: z.string().trim().min(1).nullable().optional(),
    priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
    dueAt: dueAtSchema.nullable().optional(),
    status: z.enum(["OPEN", "IN_PROGRESS", "CANCELLED"]).optional(),
  })
  .refine((input) => Object.keys(input).length > 0, "Change at least one field.");

export const taskFilterSchema = z.object({
  view: z.enum(["mine", "created", "all"]).default("mine"),
  clinicId: z.string().trim().min(1).optional(),
  status: z.enum(["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  due: z.enum(["today", "overdue", "upcoming"]).optional(),
  includeArchived: z
    .union([z.literal("true"), z.literal("false"), z.boolean()])
    .optional()
    .transform((value) => value === true || value === "true"),
});

export type CreateTaskInput = z.input<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type TaskFilters = z.infer<typeof taskFilterSchema>;

const taskInclude = {
  clinic: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  assignedTo: { select: { id: true, name: true, email: true } },
  completedBy: { select: { id: true, name: true, email: true } },
} satisfies Prisma.TaskInclude;

type TaskWithPeople = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

export interface TaskListItem {
  id: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  dueAt: string | null;
  clinic: { id: string; name: string } | null;
  createdBy: { id: string; name: string | null; email: string };
  assignedTo: { id: string; name: string | null; email: string } | null;
  completedBy: { id: string; name: string | null; email: string } | null;
  completedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
  canComplete: boolean;
  canArchive: boolean;
}

export interface AssignableTaskUser {
  id: string;
  name: string | null;
  email: string;
}

interface EffectiveAuthority {
  permissions: Set<string>;
  hasTenantWideAuthority: boolean;
  isAccountOwner: boolean;
  hasApplicableAssignment: boolean;
}

function assignmentMessage(refusal: TaskAssignmentRefusal): string {
  switch (refusal) {
    case "different-tenant":
    case "clinic-out-of-scope":
      return "That person is not available in this clinic.";
    case "missing-task-assign":
      return "You do not have permission to assign tasks to other people.";
    case "target-owner":
      return "Tasks cannot be assigned upward to an account owner.";
    case "target-not-below-actor":
      return "You can assign tasks only to people with lower authority in this clinic.";
    case "target-user-inactive":
      return "Tasks can be assigned only to active team members.";
  }
}

function toTaskListItem(
  task: TaskWithPeople,
  permissions: { canEdit: boolean; canComplete: boolean; canArchive: boolean },
): TaskListItem {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    priority: task.priority,
    status: task.status,
    dueAt: task.dueAt?.toISOString() ?? null,
    clinic: task.clinic,
    createdBy: task.createdBy,
    assignedTo: task.assignedTo,
    completedBy: task.completedBy,
    completedAt: task.completedAt?.toISOString() ?? null,
    archivedAt: task.archivedAt?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    ...permissions,
  };
}

async function effectiveAuthority(
  userId: string,
  tenantId: string,
  clinicId: string | null,
): Promise<EffectiveAuthority> {
  const assignments = await prisma.userRole.findMany({
    where: {
      userId,
      role: { tenantId },
      ...(clinicId
        ? { OR: [{ clinicId: null }, { clinicId }] }
        : { clinicId: null }),
    },
    select: { clinicId: true, role: { select: { permissions: true } } },
  });

  const permissions = new Set<string>();
  let hasTenantWideAuthority = false;
  let isAccountOwner = false;

  for (const assignment of assignments) {
    const granted = toPermissionList(assignment.role.permissions);
    granted.forEach((permission) => permissions.add(permission));
    if (assignment.clinicId === null) {
      hasTenantWideAuthority = true;
      if (granted.includes(WILDCARD)) isAccountOwner = true;
    }
  }

  return {
    permissions,
    hasTenantWideAuthority,
    isAccountOwner,
    hasApplicableAssignment: assignments.length > 0,
  };
}

async function isAccountOwner(actor: ActorContext): Promise<boolean> {
  return (await effectiveAuthority(actor.userId, actor.tenantId, null)).isAccountOwner;
}

async function assertTaskPermission(
  actor: ActorContext,
  permission: string,
  clinicId: string | null,
): Promise<void> {
  await requirePermission(actor, permission, clinicId ?? undefined);
}

function scopeAllowsClinic(scope: ClinicScope, clinicId: string | null): boolean {
  if (scope.scope === "all") return true;
  if (scope.scope === "none" || clinicId === null) return false;
  return scope.clinicIds.includes(clinicId);
}

function unionScopes(scopes: readonly ClinicScope[]): ClinicScope {
  if (scopes.some((scope) => scope.scope === "all")) return { scope: "all" };
  const clinicIds = [
    ...new Set(
      scopes.flatMap((scope) =>
        scope.scope === "clinics" ? [...scope.clinicIds] : [],
      ),
    ),
  ];
  return clinicIds.length > 0 ? { scope: "clinics", clinicIds } : { scope: "none" };
}

function clinicWhere(scope: ClinicScope): Prisma.TaskWhereInput {
  if (scope.scope === "all") return {};
  if (scope.scope === "none") return { id: "__no_task__" };
  return { clinicId: { in: [...scope.clinicIds] } };
}

async function assertAssignmentAllowed(
  actor: ActorContext,
  targetUserId: string,
  clinicId: string | null,
): Promise<void> {
  if (targetUserId === actor.userId) return;

  const target = await prisma.user.findFirst({
    where: { id: targetUserId, tenantId: actor.tenantId },
    select: {
      id: true,
      accountStatus: true,
      membershipStatus: true,
      removedAt: true,
    },
  });
  if (!target) throw new ScopeError();

  const [actorAuthority, targetAuthority, actorHasTaskAssign] = await Promise.all([
    effectiveAuthority(actor.userId, actor.tenantId, clinicId),
    effectiveAuthority(target.id, actor.tenantId, clinicId),
    can(actor, "task:assign", clinicId ?? undefined),
  ]);

  if (!targetAuthority.hasApplicableAssignment && !actorAuthority.isAccountOwner) {
    throw new BadRequestError("That person is not available in this clinic.");
  }

  const refusal = canAssignTaskToUser({
    actorPermissions: actorAuthority.permissions,
    targetPermissions: targetAuthority.permissions,
    isAccountOwner: actorAuthority.isAccountOwner,
    sameTenant: true,
    actorHasTaskAssign,
    actorClinicScopeCoversTargetClinic: actorHasTaskAssign,
    actorHasTenantWideAuthority: actorAuthority.hasTenantWideAuthority,
    targetHasTenantWideAuthority: targetAuthority.hasTenantWideAuthority,
    targetIsActive:
      target.accountStatus === "ACTIVE" &&
      target.membershipStatus === "ACTIVE" &&
      target.removedAt === null,
  });

  if (refusal === "missing-task-assign") {
    throw new PermissionError("task:assign");
  }
  if (refusal) throw new BadRequestError(assignmentMessage(refusal));
}

async function taskCapabilities(
  actor: ActorContext,
  task: Pick<TaskWithPeople, "clinicId" | "createdById" | "assignedToId">,
) {
  const clinicId = task.clinicId;
  const [manage, update, complete, remove] = await Promise.all([
    can(actor, "task:manage", clinicId ?? undefined),
    can(actor, "task:update", clinicId ?? undefined),
    can(actor, "task:complete", clinicId ?? undefined),
    can(actor, "task:delete", clinicId ?? undefined),
  ]);
  return taskMutationAuthority({
    isCreator: task.createdById === actor.userId,
    isAssignee: task.assignedToId === actor.userId,
    hasUpdate: update,
    hasComplete: complete,
    hasDelete: remove,
    hasManage: manage,
  });
}

async function loadVisibleTask(
  actor: ActorContext,
  taskId: string,
  options: { includeArchived?: boolean } = {},
): Promise<TaskWithPeople> {
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      tenantId: actor.tenantId,
      ...(options.includeArchived ? {} : { archivedAt: null }),
    },
    include: taskInclude,
  });
  if (!task) throw new ScopeError();

  const [mayView, mayManage] = await Promise.all([
    can(actor, "task:view", task.clinicId ?? undefined),
    can(actor, "task:manage", task.clinicId ?? undefined),
  ]);
  if (!mayViewTask({
    isCreator: task.createdById === actor.userId,
    isAssignee: task.assignedToId === actor.userId,
    hasView: mayView,
    hasManage: mayManage,
  })) throw new ScopeError();

  return task;
}

export async function listTasks(
  actor: ActorContext,
  rawFilters: Partial<TaskFilters> = {},
): Promise<{ rows: TaskListItem[]; total: number }> {
  await requireModule(actor, MODULE_FEATURES.tasks);
  const filters = taskFilterSchema.parse(rawFilters);
  const scopes = await accessibleClinicScopes(actor, ["task:view", "task:manage"]);
  const viewScope = scopes.get("task:view") ?? { scope: "none" };
  const manageScope = scopes.get("task:manage") ?? { scope: "none" };
  const ownScope = unionScopes([viewScope, manageScope]);
  if (ownScope.scope === "none") throw new PermissionError("task:view");

  let allowedScope = filters.view === "all" ? manageScope : ownScope;
  if (filters.view === "all" && manageScope.scope === "none") {
    throw new PermissionError("task:manage");
  }

  if (filters.clinicId) {
    await assertClinicInTenant(actor.tenantId, filters.clinicId);
    if (!scopeAllowsClinic(allowedScope, filters.clinicId)) throw new ScopeError();
    allowedScope = { scope: "clinics", clinicIds: [filters.clinicId] };
  }

  const now = new Date();
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  const endToday = new Date(startToday);
  endToday.setDate(endToday.getDate() + 1);

  const where: Prisma.TaskWhereInput = {
    tenantId: actor.tenantId,
    ...clinicWhere(allowedScope),
    ...(filters.includeArchived ? {} : { archivedAt: null }),
    ...(filters.view === "mine"
      ? { OR: [{ assignedToId: actor.userId }, { createdById: actor.userId }] }
      : filters.view === "created"
        ? { createdById: actor.userId }
        : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.priority ? { priority: filters.priority } : {}),
    ...(filters.due === "today"
      ? { dueAt: { gte: startToday, lt: endToday } }
      : filters.due === "overdue"
        ? { dueAt: { lt: now }, status: { notIn: ["COMPLETED", "CANCELLED"] } }
        : filters.due === "upcoming"
          ? { dueAt: { gte: endToday }, status: { notIn: ["COMPLETED", "CANCELLED"] } }
          : {}),
  };

  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where,
      include: taskInclude,
      orderBy: [{ dueAt: "asc" }, { updatedAt: "desc" }],
      take: 200,
    }),
    prisma.task.count({ where }),
  ]);

  const rows = await Promise.all(
    tasks.map(async (task) => toTaskListItem(task, await taskCapabilities(actor, task))),
  );
  return { rows, total };
}

export async function getTask(actor: ActorContext, taskId: string): Promise<TaskListItem> {
  await requireModule(actor, MODULE_FEATURES.tasks);
  const task = await loadVisibleTask(actor, taskId);
  return toTaskListItem(task, await taskCapabilities(actor, task));
}

export async function createTask(
  actor: ActorContext,
  rawInput: CreateTaskInput,
): Promise<TaskListItem> {
  await requireModule(actor, MODULE_FEATURES.tasks);
  const input = createTaskSchema.parse(rawInput);
  const clinicId = input.clinicId ?? null;

  if (clinicId) {
    await assertTaskPermission(actor, "task:create", clinicId);
  } else {
    await requirePermission(actor, "task:create");
    if (!(await isAccountOwner(actor))) {
      throw new BadRequestError("Choose a clinic for this task.");
    }
  }

  if (input.assignedToId) {
    await assertAssignmentAllowed(actor, input.assignedToId, clinicId);
  }

  const created = await prisma.$transaction(async (tx) => {
    const task = await tx.task.create({
      data: {
        tenantId: actor.tenantId,
        clinicId,
        title: input.title,
        description: input.description || null,
        priority: input.priority,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        createdById: actor.userId,
        assignedToId: input.assignedToId ?? null,
      },
      include: taskInclude,
    });
    await writeAuditLog(tx, {
      action: AUDIT_ACTIONS.TASK_CREATED,
      targetType: "Task",
      targetId: task.id,
      actorUserId: actor.userId,
      actorTenantId: actor.tenantId,
      afterValue: {
        clinicId,
        assignedToId: task.assignedToId,
        priority: task.priority,
        status: task.status,
      },
    });
    if (task.assignedToId && task.assignedToId !== actor.userId) {
      await writeAuditLog(tx, {
        action: AUDIT_ACTIONS.TASK_ASSIGNED,
        targetType: "Task",
        targetId: task.id,
        actorUserId: actor.userId,
        actorTenantId: actor.tenantId,
        afterValue: { assignedToId: task.assignedToId },
      });
    }
    return task;
  });

  // TODO(tasks-notifications): the current Notification model is a clinic feed,
  // not a user-targeted inbox. Do not pretend it can reliably notify one assignee.
  return toTaskListItem(created, await taskCapabilities(actor, created));
}

export async function updateTask(
  actor: ActorContext,
  taskId: string,
  rawInput: UpdateTaskInput,
): Promise<TaskListItem> {
  await requireModule(actor, MODULE_FEATURES.tasks);
  const input = updateTaskSchema.parse(rawInput);
  const task = await loadVisibleTask(actor, taskId);
  const capabilities = await taskCapabilities(actor, task);
  if (!capabilities.canEdit) throw new PermissionError("task:update");

  if (input.assignedToId !== undefined && input.assignedToId !== task.assignedToId) {
    if (input.assignedToId) {
      await assertAssignmentAllowed(actor, input.assignedToId, task.clinicId);
    } else {
      await assertTaskPermission(actor, "task:assign", task.clinicId);
    }
  }

  const changedFields = Object.keys(input);
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.task.update({
      where: { id: task.id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined
          ? { description: input.description || null }
          : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.dueAt !== undefined
          ? { dueAt: input.dueAt ? new Date(input.dueAt) : null }
          : {}),
        ...(input.assignedToId !== undefined
          ? { assignedToId: input.assignedToId }
          : {}),
        ...(input.status !== undefined
          ? {
              status: input.status,
              completedAt: null,
              completedById: null,
            }
          : {}),
      },
      include: taskInclude,
    });
    await writeAuditLog(tx, {
      action: AUDIT_ACTIONS.TASK_UPDATED,
      targetType: "Task",
      targetId: task.id,
      actorUserId: actor.userId,
      actorTenantId: actor.tenantId,
      afterValue: { changedFields, status: row.status, priority: row.priority },
    });
    if (input.assignedToId !== undefined && input.assignedToId !== task.assignedToId) {
      await writeAuditLog(tx, {
        action: AUDIT_ACTIONS.TASK_ASSIGNED,
        targetType: "Task",
        targetId: task.id,
        actorUserId: actor.userId,
        actorTenantId: actor.tenantId,
        beforeValue: { assignedToId: task.assignedToId },
        afterValue: { assignedToId: row.assignedToId },
      });
    }
    return row;
  });
  return toTaskListItem(updated, await taskCapabilities(actor, updated));
}

export async function assignTask(
  actor: ActorContext,
  taskId: string,
  assignedToId: string | null,
): Promise<TaskListItem> {
  return updateTask(actor, taskId, { assignedToId });
}

export async function completeTask(
  actor: ActorContext,
  taskId: string,
): Promise<TaskListItem> {
  await requireModule(actor, MODULE_FEATURES.tasks);
  const task = await loadVisibleTask(actor, taskId);
  const capabilities = await taskCapabilities(actor, task);
  if (!capabilities.canComplete) throw new PermissionError("task:complete");

  const completed = await prisma.$transaction(async (tx) => {
    const row = await tx.task.update({
      where: { id: task.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        completedById: actor.userId,
      },
      include: taskInclude,
    });
    await writeAuditLog(tx, {
      action: AUDIT_ACTIONS.TASK_COMPLETED,
      targetType: "Task",
      targetId: task.id,
      actorUserId: actor.userId,
      actorTenantId: actor.tenantId,
      beforeValue: { status: task.status },
      afterValue: { status: row.status, completedById: actor.userId },
    });
    return row;
  });
  return toTaskListItem(completed, await taskCapabilities(actor, completed));
}

export async function archiveTask(
  actor: ActorContext,
  taskId: string,
): Promise<{ id: string; archivedAt: string }> {
  await requireModule(actor, MODULE_FEATURES.tasks);
  const task = await loadVisibleTask(actor, taskId, { includeArchived: true });
  const capabilities = await taskCapabilities(actor, task);
  if (!capabilities.canArchive) throw new PermissionError("task:delete");
  if (task.archivedAt) {
    return { id: task.id, archivedAt: task.archivedAt.toISOString() };
  }

  const archivedAt = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.task.update({ where: { id: task.id }, data: { archivedAt } });
    await writeAuditLog(tx, {
      action: AUDIT_ACTIONS.TASK_ARCHIVED,
      targetType: "Task",
      targetId: task.id,
      actorUserId: actor.userId,
      actorTenantId: actor.tenantId,
      afterValue: { archivedAt: archivedAt.toISOString() },
    });
  });
  return { id: task.id, archivedAt: archivedAt.toISOString() };
}

export async function listAssignableUsers(
  actor: ActorContext,
  clinicId: string | null,
): Promise<AssignableTaskUser[]> {
  await requireModule(actor, MODULE_FEATURES.tasks);
  if (clinicId) await assertClinicInTenant(actor.tenantId, clinicId);

  const [mayCreate, mayAssign] = await Promise.all([
    can(actor, "task:create", clinicId ?? undefined),
    can(actor, "task:assign", clinicId ?? undefined),
  ]);
  if (!mayCreate && !mayAssign) throw new PermissionError("task:assign");

  const owner = await isAccountOwner(actor);
  if (!clinicId && !owner) throw new BadRequestError("Choose a clinic first.");

  const users = await prisma.user.findMany({
    where: {
      tenantId: actor.tenantId,
      accountStatus: "ACTIVE",
      membershipStatus: "ACTIVE",
      removedAt: null,
      userRoles: {
        some: {
          role: { tenantId: actor.tenantId },
          ...(clinicId
            ? { OR: [{ clinicId: null }, { clinicId }] }
            : owner
              ? {}
              : { clinicId: null }),
        },
      },
    },
    select: { id: true, name: true, email: true },
    orderBy: [{ name: "asc" }, { email: "asc" }],
  });

  const assignable: AssignableTaskUser[] = [];
  for (const user of users) {
    if (user.id === actor.userId) {
      if (mayCreate) assignable.push(user);
      continue;
    }
    if (!mayAssign) continue;
    try {
      await assertAssignmentAllowed(actor, user.id, clinicId);
      assignable.push(user);
    } catch (error) {
      if (error instanceof PermissionError || error instanceof BadRequestError) continue;
      throw error;
    }
  }
  return assignable;
}

export async function listTaskClinics(actor: ActorContext): Promise<
  { id: string; name: string }[]
> {
  await requireModule(actor, MODULE_FEATURES.tasks);
  const scopes = await accessibleClinicScopes(actor, [
    "task:view",
    "task:create",
    "task:manage",
  ]);
  const scope = unionScopes([...scopes.values()]);
  if (scope.scope === "none") throw new PermissionError("task:view");
  return prisma.clinic.findMany({
    where: {
      tenantId: actor.tenantId,
      ...(scope.scope === "clinics" ? { id: { in: [...scope.clinicIds] } } : {}),
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export async function taskPageCapabilities(actor: ActorContext): Promise<{
  canCreate: boolean;
  canCreateTenantWide: boolean;
  canManage: boolean;
}> {
  await requireModule(actor, MODULE_FEATURES.tasks);
  const scopes = await accessibleClinicScopes(actor, ["task:create", "task:manage"]);
  const createScope = scopes.get("task:create") ?? { scope: "none" };
  const manageScope = scopes.get("task:manage") ?? { scope: "none" };
  const owner = await isAccountOwner(actor);
  return {
    canCreate: createScope.scope !== "none",
    canCreateTenantWide: owner && createScope.scope === "all",
    canManage: manageScope.scope !== "none",
  };
}

export async function taskDashboardSummary(actor: ActorContext): Promise<{
  myOpen: number;
  dueToday: number;
  overdue: number;
  completedToday: number;
}> {
  await requireModule(actor, MODULE_FEATURES.tasks);
  const scope = await (async () => {
    const scopes = await accessibleClinicScopes(actor, ["dashboard:tasks:view"]);
    return scopes.get("dashboard:tasks:view") ?? { scope: "none" as const };
  })();
  if (scope.scope === "none") throw new PermissionError("dashboard:tasks:view");

  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const base: Prisma.TaskWhereInput = {
    tenantId: actor.tenantId,
    archivedAt: null,
    assignedToId: actor.userId,
    ...clinicWhere(scope),
  };
  const [myOpen, dueToday, overdue, completedToday] = await Promise.all([
    prisma.task.count({ where: { ...base, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    prisma.task.count({
      where: {
        ...base,
        status: { in: ["OPEN", "IN_PROGRESS"] },
        dueAt: { gte: start, lt: end },
      },
    }),
    prisma.task.count({
      where: {
        ...base,
        status: { in: ["OPEN", "IN_PROGRESS"] },
        dueAt: { lt: now },
      },
    }),
    prisma.task.count({
      where: { ...base, status: "COMPLETED", completedAt: { gte: start, lt: end } },
    }),
  ]);
  return { myOpen, dueToday, overdue, completedToday };
}
