import { PrismaClient } from "@prisma/client";

/**
 * Prisma client singleton.
 *
 * Next.js hot-reloads modules in development, which would otherwise open a new
 * connection pool on every reload and exhaust the clinic's MySQL connections.
 * Cache the instance on `globalThis` outside production.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Query/error output may embed bound clinical notes and medication values.
    // Routes provide controlled error reporting; never print database payloads.
    log: process.env.NODE_ENV === "development" ? ["warn"] : [],
  });

if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = prisma;
}
