/**
 * Platform read models — Stage 2.
 *
 * Owner-facing reads live here rather than in the tenant-scoped modules, and
 * every one of them queries across tenants EXPLICITLY. That is the point of the
 * split: a cross-tenant read is visible at the call site, instead of hiding
 * behind an `if (isOwner)` inside a function whose name promises scoping.
 *
 * Read-only. Approving, rejecting and suspending clinics are Stage 3.
 */
import { prisma } from "@/lib/prisma";
import { CUSTOMER_TENANT_WHERE } from "@/lib/platformTenant";
import type { PlatformActorContext } from "@/lib/platform/context";
import type { TenantStatus } from "@prisma/client";

export type TenantStatusCounts = Record<TenantStatus, number>;

export interface PlatformOverview {
  tenants: TenantStatusCounts;
  totalCustomerTenants: number;
}

const EMPTY_COUNTS: TenantStatusCounts = {
  PENDING: 0,
  ACTIVE: 0,
  SUSPENDED: 0,
  REJECTED: 0,
  ARCHIVED: 0,
};

/**
 * Counts customer organisations by status.
 *
 * Takes the Owner context as an argument even though it does not filter by it.
 * That is on purpose: it makes the authorization a required input rather than
 * something a caller might forget to do first, and the type means only
 * `requirePlatformOwner()` can produce the argument.
 *
 * `CUSTOMER_TENANT_WHERE` keeps the reserved platform row out of every figure —
 * it is not a customer and must never be counted as one.
 */
export async function getPlatformOverview(
  _owner: PlatformActorContext,
): Promise<PlatformOverview> {
  const grouped = await prisma.tenant.groupBy({
    by: ["status"],
    where: CUSTOMER_TENANT_WHERE,
    _count: { _all: true },
  });

  const tenants = { ...EMPTY_COUNTS };
  for (const row of grouped) {
    tenants[row.status] = row._count._all;
  }

  return {
    tenants,
    totalCustomerTenants: Object.values(tenants).reduce((sum, n) => sum + n, 0),
  };
}
