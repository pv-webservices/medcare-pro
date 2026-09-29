import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * `registration.aggregate({ where, _sum: { amount }, _count: { _all } })`, same
 * result shape, without Prisma's aggregate SQL.
 *
 * Prisma's aggregate wraps the filter in a derived table
 * (`SELECT SUM(amount) FROM (SELECT …) AS sub`). MariaDB rejects the SECOND
 * execution of that prepared statement on a connection with error 1140 when
 * sql_mode includes ONLY_FULL_GROUP_BY. A real GROUP BY is safe in every mode,
 * so this groups by clinic and adds the exact Decimals back together.
 *
 * Like aggregate, an empty match gives `amount: null` and a count of 0.
 */
export async function registrationTotals(where: Prisma.RegistrationWhereInput) {
  const rows = await prisma.registration.groupBy({ by: ["clinicId"], where, _sum: { amount: true }, _count: { _all: true } });
  let amount: Prisma.Decimal | null = null;
  let count = 0;
  for (const row of rows) {
    count += row._count._all;
    if (row._sum.amount !== null) amount = amount === null ? row._sum.amount : amount.plus(row._sum.amount);
  }
  return { _sum: { amount }, _count: { _all: count } };
}
