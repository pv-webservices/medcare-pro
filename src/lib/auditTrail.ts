import { z } from "zod";
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
  /** Free text over the actor's name and email. */
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).max(1000).optional(),
});

export type AuditFilterInput = z.infer<typeof auditFilterSchema>;

export interface AuditEntryView {
  id: string;
  action: string;
  label: string;
  detail: string;
  category: AuditCategory;
  /** True when MEDCARE PRO took this, rather than someone in the organisation. */
  byPlatform: boolean;
  /** Null for a system action with no person behind it. */
  actorName: string | null;
  targetType: string;
  reason: string | null;
  createdAt: Date;
}

export interface AuditTrailPage {
  entries: AuditEntryView[];
  total: number;
  page: number;
  pageSize: number;
  category: AuditCategory | null;
  search: string;
  categories: readonly { key: AuditCategory; label: string }[];
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

export async function getAuditTrail(
  actor: ActorContext,
  filters: AuditFilterInput = {},
): Promise<AuditTrailPage> {
  await requirePermission(actor, "audit:read");

  const category =
    filters.category && isAuditCategory(filters.category) ? filters.category : null;
  const search = filters.search?.trim() ?? "";
  const page = filters.page ?? 1;

  const actions = actionsForCategory(category);

  const where = {
    action: { in: actions },
    OR: [
      // Clause 1 — written by somebody acting inside this organisation.
      { actorTenantId: actor.tenantId },
      // Clause 2 — a platform decision about this organisation. Both halves are
      // constants or session-derived; nothing here comes from the request.
      { targetType: "Tenant", targetId: actor.tenantId },
    ],
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

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * AUDIT_PAGE_SIZE,
      take: AUDIT_PAGE_SIZE,
      // Note what is NOT selected: ip, userAgent, beforeValue, afterValue.
      // Withholding by omission rather than by deleting fields afterwards means
      // there is no redaction step a later edit could skip.
      select: {
        id: true,
        action: true,
        targetType: true,
        reason: true,
        createdAt: true,
        actor: { select: { name: true, email: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    entries: rows.map((row): AuditEntryView => {
      const description = describeAuditAction(row.action);

      return {
        id: row.id,
        action: row.action,
        label: description.label,
        detail: description.detail,
        category: description.category,
        byPlatform: description.side === "platform",
        // Falls back to the email so a person who never set a name is still
        // identifiable, and to null so the screen can say "MEDCARE PRO" or
        // "System" rather than printing an empty cell.
        actorName: row.actor?.name ?? row.actor?.email ?? null,
        targetType: row.targetType,
        reason: row.reason,
        createdAt: row.createdAt,
      };
    }),
    total,
    page,
    pageSize: AUDIT_PAGE_SIZE,
    category,
    search,
    categories: AUDIT_CATEGORIES,
  };
}
