/**
 * test:billing under MySQL 8's default strict sql_mode (ONLY_FULL_GROUP_BY included).
 *
 * Prisma has no per-connection init hook, so the pool is pinned to ONE connection and
 * test-billing.mts sets the mode on that session, then checks it still holds at the end.
 * The URL is rewritten here, before @/lib/prisma is imported and builds its client.
 */
import "./require-node-24.mjs";
import "dotenv/config";

const url = new URL(process.env.DATABASE_URL ?? "mysql://invalid");
url.searchParams.set("connection_limit", "1");
process.env.DATABASE_URL = url.toString();
process.env.BILLING_TEST_SQL_MODE = "strict";
await import("./test-billing.mjs");
