import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { missingCatalogueFeatures } from "@/lib/featureInstallation";

/**
 * Read-only: which catalogue features have no row in `features` on this
 * database. Never inserts or changes anything; fail-closed access is untouched.
 * Callers decide who may see the answer (the Features screen needs feature:view).
 */
export async function listMissingCatalogueFeatures(client: Prisma.TransactionClient = prisma) {
  const rows = await client.feature.findMany({ select: { key: true } });
  return missingCatalogueFeatures(rows.map((row) => row.key));
}
