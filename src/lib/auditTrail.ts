import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission, type ActorContext } from "@/lib/rbac";
import {
  AUDIT_CATEGORIES,
  SIGN_IN_NOISE_ACTIONS,
  actionsInCategory,
  describeAuditAction,
  isAuditCategory,
  type AuditCategory,
} from "@/lib/auditDescriptions";

/**
 * One organisation's activity log — Stage 11, the tenant side.
 *
 * `audit_logs` has been written since Stage 2 and read by almost nothing. This
 * is the screen that answers "who removed my receptionist", "who switched that
 * feature off", and "when exactly did MEDCARE PRO suspend us" — all questions
 * whose answers were already in the table and reachable only by SQL.
 *
 * WHAT AN ORGANISATION MAY SEE, AND THE TWO CLAUSES THAT DEFINE IT:
 *
 *   1. rows its own people wrote          actorTenantId = this tenant
 *   2. platform decisions about IT        targetType = "Tenant"
 *                                         AND targetId = this tenant
 *
 * Clause 2 is what lets an organisation see its own approval, suspension and
 * plan changes. Platform actions carry `actorTenantId = null` by deliberate
 * design (see the note in lib/platform/decisions.ts), so without it those rows
 * would be invisible to the only people they affect.
 *
 * NEITHER CLAUSE CAN REACH ANOTHER ORGANISATION. Clause 1 is an equality on a
 * scoped column. Clause 2 is an equality on the actor's OWN tenant id, taken
 * from the session — `targetId` is never read from a request, so there is no
 * parameter to tamper with. The verify script asserts both directions against a
 * neighbouring tenant.
 *
 * WHAT IS DELIBERATELY WITHHELD — `ip`, `userAgent`, and the `beforeValue` /
 * `afterValue` JSON. Those exist for platform incident work. Showing one
 * colleague another's IP address inside a clinic is a disclosure nobody asked
 * for, and the JSON carries internal ids that mean nothing to a clinic and
 * something to anyone probing. The Owner surface (lib/platform/auditLog.ts)
 * shows them; this one never selects them, so there is no redaction step that
 * could be forgotten.
 */

export const AUDIT_PAGE_SIZE = 50;

export const auditFilterSchema = z.object({
  category: z.string().trim().optional(),
  module: z.string().trim().optional(),
  decision: z.string().trim().optional(),
  role: z.string().trim().optional(),
  userId: z.string().trim().optional(),
  period: z.string().trim().optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  /** Free text over the actor's name and email. */
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).max(1000).optional(),
});

export type AuditFilterInput = z.infer<typeof auditFilterSchema>;

export type AuditDecision = "success" | "cancelled" | "failed";

export const FAILED_AUDIT_ACTIONS = [
  "LOGIN_CODE_FAILED",
  "LOGIN_CODE_RATE_LIMITED",
  "PASSWORD_RESET_FAILED",
  "PASSWORD_RESET_RATE_LIMITED",
  "CLINIC_REJECTED",
  "CLINIC_SUSPENDED",
  "TEAM_MEMBER_REJECTED",
  "TEAM_MEMBER_SUSPENDED",
  "FEATURE_GLOBAL_DISABLED",
  "PLAN_FEATURE_REMOVED",
  "ROLE_FEATURE_DISABLED",
  "APPOINTMENT_TYPE_DEACTIVATED",
];

export const CANCELLED_AUDIT_ACTIONS = [
  "APPOINTMENT_CANCELLED",
  "APPOINTMENT_NO_SHOW",
  "TEAM_INVITATION_REVOKED",
  "TEAM_MEMBER_REMOVED",
];

export function getAuditDecision(action: string): AuditDecision {
  if (FAILED_AUDIT_ACTIONS.includes(action)) {
    return "failed";
  }
  if (CANCELLED_AUDIT_ACTIONS.includes(action)) {
    return "cancelled";
  }
  return "success";
}

export function getAuditModule(action: string, category: AuditCategory): string {
  if (category === "appointments") return "Appointments";
  if (category === "tasks") return "Tasks";
  if (category === "dashboard") return "Dashboard";
  if (category === "access") return "Security";
  if (category === "team") return "Team";
  if (category === "roles") return "Roles";
  if (category === "entitlements") return "Settings";
  if (category === "organisation") {
    if (action.includes("TELEPHONY") || action.includes("SETTINGS")) {
      return "Settings";
    }
    return "Clinic";
  }
  return "Platform";
}

export interface AuditEntryView {
  id: string;
  action: string;
  label: string;
  detail: string;
  category: AuditCategory;
  /** Semantic module name for the table pill (e.g. Appointments, Tasks, Security, etc.) */
  module: string;
  /** Semantic decision for the row (success, cancelled, failed) */
  decision: AuditDecision;
  /** True when MEDCARE PRO took this, rather than someone in the organisation. */
  byPlatform: boolean;
  /** Null for a system action with no person behind it. */
  actorName: string | null;
  actorEmail: string | null;
  actorRole: string;
  targetType: string;
  targetId: string | null;
  reason: string | null;
  createdAt: Date;
}

export interface AuditMetricsSummary {
  totalActivities: number;
  successCount: number;
  failedCount: number;
  uniqueUsersCount: number;
}

export interface AuditFilterOption {
  id: string;
  name: string;
}

export interface AuditTrailPage {
  entries: AuditEntryView[];
  total: number;
  page: number;
  pageSize: number;
  category: AuditCategory | null;
  search: string;
  categories: readonly { key: AuditCategory; label: string }[];
  metrics: AuditMetricsSummary;
  availableRoles: AuditFilterOption[];
  availableUsers: AuditFilterOption[];
  filters: {
    decision?: string;
    role?: string;
    module?: string;
    userId?: string;
    period?: string;
  };
}

/**
 * The actions this organisation's log will show.
 *
 * Built from the DESCRIPTION table rather than from whatever happens to be in
 * the database, so a row written by a future stage with no description cannot
 * appear here unexplained. The cost is that adding an action means adding its
 * description — which the unit test already requires.
 */
function actionsForCategory(category: AuditCategory | null): string[] {
  if (category !== null) {
    return actionsInCategory(category);
  }

  // No category chosen: everything except sign-in noise, which outnumbers the
  // decisions by an order of magnitude and answers a different question. It
  // stays one filter click away rather than being hidden outright.
  return AUDIT_CATEGORIES.flatMap((entry) => actionsInCategory(entry.key)).filter(
    (action) => !SIGN_IN_NOISE_ACTIONS.includes(action),
  );
}

const MODULE_TO_CATEGORY: Record<string, AuditCategory> = {
  appointments: "appointments",
  tasks: "tasks",
  dashboard: "dashboard",
  security: "access",
  access: "access",
  team: "team",
  roles: "roles",
  clinic: "organisation",
  organisation: "organisation",
  settings: "entitlements",
  entitlements: "entitlements",
  platform: "platform",
};

export async function getAuditTrail(
  actor: ActorContext,
  filters: AuditFilterInput = {},
): Promise<AuditTrailPage> {
  await requirePermission(actor, "audit:read");

  const moduleParam = filters.module?.trim().toLowerCase();
  const rawCategory =
    filters.category || (moduleParam && MODULE_TO_CATEGORY[moduleParam]);

  const category =
    rawCategory && isAuditCategory(rawCategory) ? rawCategory : null;
  const search = filters.search?.trim() ?? "";
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? AUDIT_PAGE_SIZE;

  let actions = actionsForCategory(category);

  // Filter actions by decision if requested
  const decisionParam = filters.decision?.trim().toLowerCase();
  if (decisionParam === "success") {
    actions = actions.filter((a) => getAuditDecision(a) === "success");
  } else if (decisionParam === "failed") {
    actions = actions.filter((a) => getAuditDecision(a) === "failed");
  } else if (decisionParam === "cancelled") {
    actions = actions.filter((a) => getAuditDecision(a) === "cancelled");
  }

  // Base scope for this tenant
  const tenantBaseScope = {
    OR: [
      // Clause 1 — written by somebody acting inside this organisation.
      { actorTenantId: actor.tenantId },
      // Clause 2 — a platform decision about this organisation.
      { targetType: "Tenant", targetId: actor.tenantId },
    ],
  };

  // Date period filter
  let periodDateFilter: { gte?: Date } | undefined;
  const periodParam = filters.period?.trim();
  if (periodParam && periodParam !== "all") {
    const now = new Date();
    if (periodParam === "today") {
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      periodDateFilter = { gte: todayStart };
    } else if (periodParam === "yesterday") {
      const yesterdayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      periodDateFilter = { gte: yesterdayStart };
    } else if (periodParam === "7d") {
      periodDateFilter = { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) };
    } else if (periodParam === "30d") {
      periodDateFilter = { gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) };
    } else if (periodParam === "90d") {
      periodDateFilter = { gte: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) };
    }
  }

  const roleParam = filters.role?.trim();
  const userIdParam = filters.userId?.trim();

  const where: Prisma.AuditLogWhereInput = {
    action: { in: actions },
    ...tenantBaseScope,
    ...(periodDateFilter ? { createdAt: periodDateFilter } : {}),
    ...(userIdParam ? { actorUserId: userIdParam } : {}),
    ...(roleParam
      ? {
          actor: {
            userRoles: {
              some: {
                OR: [
                  { roleId: roleParam },
                  { role: { name: roleParam } },
                ],
              },
            },
          },
        }
      : {}),
    ...(search
      ? {
          actor: {
            is: {
              OR: [
                { name: { contains: search } },
                { email: { contains: search } },
              ],
            },
          },
        }
      : {}),
  };

  // Query rows, total, and tenant metrics in parallel
  const [rows, total, totalActivitiesCount, failedActivitiesCount, distinctActors, availableRoles, availableUsers] =
    await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        // Note what is NOT selected: ip, userAgent, beforeValue, afterValue.
        // Withholding by omission rather than by deleting fields afterwards means
        // there is no redaction step a later edit could skip.
        select: {
          id: true,
          action: true,
          targetType: true,
          targetId: true,
          reason: true,
          createdAt: true,
          actor: {
            select: {
              id: true,
              name: true,
              email: true,
              userRoles: {
                where: {
                  role: { tenantId: actor.tenantId },
                },
                select: {
                  role: { select: { name: true } },
                },
              },
            },
          },
        },
      }),
      prisma.auditLog.count({ where }),
      // Overall activities count for tenant
      prisma.auditLog.count({
        where: tenantBaseScope,
      }),
      // Failed activities count for tenant
      prisma.auditLog.count({
        where: {
          ...tenantBaseScope,
          action: { in: FAILED_AUDIT_ACTIONS },
        },
      }),
      // Unique users who performed activities in this tenant
      prisma.auditLog.findMany({
        where: {
          ...tenantBaseScope,
          actorUserId: { not: null },
        },
        select: { actorUserId: true },
        distinct: ["actorUserId"],
      }),
      // Available roles in tenant for filter dropdown
      prisma.role.findMany({
        where: { tenantId: actor.tenantId },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      // Available users in tenant for filter dropdown
      prisma.user.findMany({
        where: { tenantId: actor.tenantId },
        select: { id: true, name: true, email: true },
        orderBy: { name: "asc" },
      }),
    ]);

  const uniqueUsersCount = distinctActors.length;
  const failedCount = failedActivitiesCount;
  const successCount = Math.max(0, totalActivitiesCount - failedCount);

  return {
    entries: rows.map((row): AuditEntryView => {
      const description = describeAuditAction(row.action);
      const decision = getAuditDecision(row.action);
      const moduleName = getAuditModule(row.action, description.category);

      let actorRole = "Staff";
      if (description.side === "platform") {
        actorRole = "Platform";
      } else if (!row.actor) {
        actorRole = "System";
      } else if (row.actor.userRoles && row.actor.userRoles.length > 0) {
        actorRole = row.actor.userRoles[0].role.name;
      }

      return {
        id: row.id,
        action: row.action,
        label: description.label,
        detail: description.detail,
        category: description.category,
        module: moduleName,
        decision,
        byPlatform: description.side === "platform",
        // Falls back to the email so a person who never set a name is still
        // identifiable, and to null so the screen can say "MEDCARE PRO" or
        // "System" rather than printing an empty cell.
        actorName: row.actor?.name ?? row.actor?.email ?? null,
        actorEmail: row.actor?.email ?? null,
        actorRole,
        targetType: row.targetType,
        targetId: row.targetId,
        reason: row.reason,
        createdAt: row.createdAt,
      };
    }),
    total,
    page,
    pageSize,
    category,
    search,
    categories: AUDIT_CATEGORIES,
    metrics: {
      totalActivities: totalActivitiesCount,
      successCount,
      failedCount,
      uniqueUsersCount,
    },
    availableRoles: availableRoles.map((r) => ({ id: r.id, name: r.name })),
    availableUsers: availableUsers.map((u) => ({
      id: u.id,
      name: u.name?.trim() ? u.name : u.email,
    })),
    filters: {
      decision: filters.decision,
      role: filters.role,
      module: filters.module || (category ? String(category) : undefined),
      userId: filters.userId,
      period: filters.period,
    },
  };
}
