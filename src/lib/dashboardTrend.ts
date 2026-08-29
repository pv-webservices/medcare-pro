import { Prisma } from "@prisma/client";
import type { TrendInterval } from "@/lib/dashboardDateRange";

/**
 * Fully-qualified columns used by dashboard trend SQL.
 *
 * Keep these qualified even when a query currently has one table: the patient
 * query joins clinics, which also owns `created_at`, and an unqualified column
 * makes MySQL reject the whole dashboard request as ambiguous.
 */
export const DASHBOARD_TREND_SOURCE_COLUMNS = {
  appointments: "a.slot_start",
  registrations: "r.visit_date",
  patients: "p.created_at",
} as const;

export type DashboardTrendSource = keyof typeof DASHBOARD_TREND_SOURCE_COLUMNS;

export function dashboardBucketSql(
  source: DashboardTrendSource,
  interval: TrendInterval,
): Prisma.Sql {
  // Prisma.raw is safe here because the value comes only from the closed map
  // above; no request or database value can become an SQL identifier.
  const column = Prisma.raw(DASHBOARD_TREND_SOURCE_COLUMNS[source]);
  return interval === "monthly"
    ? Prisma.sql`DATE_FORMAT(${column}, '%Y-%m-01')`
    : Prisma.sql`DATE_FORMAT(${column}, '%Y-%m-%d')`;
}
