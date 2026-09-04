import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { CUSTOMER_TENANT_WHERE } from "@/lib/platformTenant";
import {
  AUDIT_CATEGORIES,
  actionsInCategory,
  describeAuditAction,
  isAuditCategory,
  type AuditCategory,
} from "@/lib/auditDescriptions";
import type { PlatformActorContext } from "@/lib/platform/context";
import type { Prisma } from "@prisma/client";

/**
 * The cross-tenant audit trail — Stage 11, the Owner side.
 *
 * Owner reads live in src/lib/platform/* and query across tenants EXPLICITLY,
 * which is the whole point of the split: a cross-tenant read is visible at the
 * call site instead of hiding behind an `if (isOwner)` inside a function whose
 * name promises scoping. This is the widest such read in the codebase, so it
 * takes the Owner context as a required argument that only
 * `requirePlatformOwner()` can produce.
 *
 * WHAT THIS SHOWS THAT THE TENANT SCREEN DOES NOT: `ip`, `userAgent`, and the
 * `beforeValue` / `afterValue` JSON. Those are the fields incident work needs —
 * "which address was hammering that login", "what was the plan before someone
 * changed it" — and the reason lib/auditTrail.ts does not select them.
 *
 * READ-ONLY, AND NECESSARILY SO. There is no update and no delete anywhere in
 * this module or in lib/audit.ts. `audit_logs` is append-only by the same
 * contract `registration_edit_log` keeps, and both actor foreign keys are
 * RESTRICT so a row cannot be orphaned out of existence either.
 */

export const OWNER_AUDIT_PAGE_SIZE = 100;

/** The export ceiling. See the note in `listAuditLogForExport`. */
export const OWNER_AUDIT_EXPORT_MAX = 5000;

export const ownerAuditFilterSchema = z.object({
  category: z.string().trim().optional(),
  /** A specific action name, when the category is too coarse. */
  action: z.string().trim().max(64).optional(),
  /** One organisation. Empty means every one of them. */
  tenantId: z.string().trim().max(64).optional(),
  /** Free text over the actor's name and email. */
  search: z.string().trim().max(120).optional(),
  /** ISO dates, inclusive of the whole `from` day and the whole `to` day. */
  from: z.string().trim().max(10).optional(),
  to: z.string().trim().max(10).optional(),
  page: z
    .preprocess(
      (val) => (val === "" || val === null || val === undefined ? undefined : val),
      z.coerce.number().int().min(1).max(1000).optional(),
    ),
});

export type OwnerAuditFilterInput = z.infer<typeof ownerAuditFilterSchema>;

export interface OwnerAuditEntry {
  id: string;
  action: string;
  label: string;
  category: AuditCategory;
  side: string;
  actorName: string | null;
  actorEmail: string | null;
  /** Null for a platform-wide action with no organisation behind it. */
  tenantName: string | null;
  tenantId: string | null;
  targetType: string;
  targetId: string | null;
  reason: string | null;
  ip: string | null;
  userAgent: string | null;
  beforeValue: Prisma.JsonValue | null;
  afterValue: Prisma.JsonValue | null;
  createdAt: Date;
}

export interface OwnerAuditPage {
  entries: OwnerAuditEntry[];
  total: number;
  page: number;
  pageSize: number;
  filters: {
    category: AuditCategory | null;
    action: string | null;
    tenantId: string | null;
    search: string;
    from: string | null;
    to: string | null;
  };
  categories: readonly { key: AuditCategory; label: string }[];
  /** Customer organisations, for the filter control. */
  tenants: { id: string; name: string }[];
}

/** Turns one day-precision ISO date into the instant that day starts/ends. */
function dayBoundary(value: string | undefined, edge: "start" | "end"): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  // `to` is inclusive of its whole day, which is what a person filling in a date
  // range means. An exclusive upper bound would silently drop everything that
  // happened on the last day they asked for.
  const iso = edge === "start" ? `${value}T00:00:00.000Z` : `${value}T23:59:59.999Z`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildWhere(filters: OwnerAuditFilterInput) {
  const category =
    filters.category && isAuditCategory(filters.category) ? filters.category : null;
  const action = filters.action?.trim() || null;
  const tenantId = filters.tenantId?.trim() || null;
  const search = filters.search?.trim() ?? "";
  const from = dayBoundary(filters.from, "start");
  const to = dayBoundary(filters.to, "end");

  // An explicit action wins over its category: naming one is strictly more
  // specific than naming the group it lives in.
  const actions = action ? [action] : category ? actionsInCategory(category) : null;

  const where: Prisma.AuditLogWhereInput = {
    ...(actions ? { action: { in: actions } } : {}),
    ...(tenantId
      ? {
          // Both the rows this organisation wrote and the platform decisions
          // taken about it, matching what its own admins see.
          OR: [
            { actorTenantId: tenantId },
            { targetType: "Tenant", targetId: tenantId },
          ],
        }
      : {}),
    ...(search
      ? {
          actor: {
            is: {
              OR: [{ name: { contains: search } }, { email: { contains: search } }],
            },
          },
        }
      : {}),
    ...(from || to
      ? {
          createdAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        }
      : {}),
  };

  return {
    where,
    resolved: {
      category,
      action,
      tenantId,
      search,
      from: filters.from?.trim() || null,
      to: filters.to?.trim() || null,
    },
  };
}

const ENTRY_SELECT = {
  id: true,
  action: true,
  targetType: true,
  targetId: true,
  reason: true,
  ip: true,
  userAgent: true,
  beforeValue: true,
  afterValue: true,
  createdAt: true,
  actor: { select: { name: true, email: true } },
  actorTenant: { select: { id: true, businessName: true } },
} as const;

type AuditRow = Prisma.AuditLogGetPayload<{ select: typeof ENTRY_SELECT }>;

function toEntry(row: AuditRow): OwnerAuditEntry {
  const description = describeAuditAction(row.action);

  return {
    id: row.id,
    action: row.action,
    label: description.label,
    category: description.category,
    side: description.side,
    actorName: row.actor?.name ?? null,
    actorEmail: row.actor?.email ?? null,
    tenantName: row.actorTenant?.businessName ?? null,
    tenantId: row.actorTenant?.id ?? null,
    targetType: row.targetType,
    targetId: row.targetId,
    reason: row.reason,
    ip: row.ip,
    userAgent: row.userAgent,
    beforeValue: row.beforeValue,
    afterValue: row.afterValue,
    createdAt: row.createdAt,
  };
}

export async function listAuditLog(
  _owner: PlatformActorContext,
  filters: OwnerAuditFilterInput = {},
): Promise<OwnerAuditPage> {
  const { where, resolved } = buildWhere(filters);
  const page = filters.page ?? 1;

  const [rows, total, tenants] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * OWNER_AUDIT_PAGE_SIZE,
      take: OWNER_AUDIT_PAGE_SIZE,
      select: ENTRY_SELECT,
    }),
    prisma.auditLog.count({ where }),
    prisma.tenant.findMany({
      where: CUSTOMER_TENANT_WHERE,
      orderBy: { businessName: "asc" },
      select: { id: true, businessName: true },
      take: 500,
    }),
  ]);

  return {
    entries: rows.map(toEntry),
    total,
    page,
    pageSize: OWNER_AUDIT_PAGE_SIZE,
    filters: resolved,
    categories: AUDIT_CATEGORIES,
    tenants: tenants.map((tenant) => ({ id: tenant.id, name: tenant.businessName })),
  };
}

/**
 * The same query, unpaginated, for the CSV export.
 *
 * CAPPED rather than unbounded. An audit table grows without limit and nothing
 * ever deletes from it, so "export everything" is a request that gets slower
 * every day and eventually takes the process down. The cap is applied to the
 * NEWEST rows, and the caller is told when it bit, so a narrower date range is
 * an obvious next step rather than a silent truncation.
 */
export async function listAuditLogForExport(
  _owner: PlatformActorContext,
  filters: OwnerAuditFilterInput = {},
): Promise<{ entries: OwnerAuditEntry[]; truncated: boolean; total: number }> {
  const { where } = buildWhere(filters);

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: OWNER_AUDIT_EXPORT_MAX,
      select: ENTRY_SELECT,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    entries: rows.map(toEntry),
    truncated: total > OWNER_AUDIT_EXPORT_MAX,
    total,
  };
}
