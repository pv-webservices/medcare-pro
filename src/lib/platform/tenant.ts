/**
 * The reserved platform tenant — Stage 1 decision 3, used from Stage 2.
 *
 * `users.tenant_id` is NOT NULL, and an Owner is still a `User`. Rather than
 * relax that column — which would put a nullable tenant into every scoped query
 * in the app — one reserved Tenant row exists for Owner accounts to point at.
 *
 * It is not a customer organisation and must never be treated as one:
 * `CUSTOMER_TENANT_WHERE` excludes it from listings, signup never creates users
 * under it, and requireActor() refuses to hand out a context scoped to it.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { PLATFORM_TENANT_NAME, PLATFORM_TENANT_SLUG } from "@/lib/platformTenant";

type PrismaClientOrTransaction = PrismaClient | Prisma.TransactionClient;

/**
 * The reserved row's contact address. It is never mailed — the row exists only
 * to satisfy the foreign key — but `tenants.email` is unique and NOT NULL, so
 * it needs a value. `.invalid` is reserved by RFC 2606 and can never resolve.
 */
export const PLATFORM_TENANT_EMAIL = "platform@medcare.invalid";

/**
 * Returns the reserved tenant's id, creating it if this deployment has not run
 * the Stage 1 backfill. Create-only and idempotent: an existing row is returned
 * untouched, never rewritten.
 *
 * `emailVerifiedAt` is stamped because src/lib/auth.ts blocks login while the
 * owning tenant is unverified, and there is no mailbox to verify.
 */
export async function ensurePlatformTenant(
  client: PrismaClientOrTransaction,
  now = new Date(),
): Promise<string> {
  const existing = await client.tenant.findFirst({
    where: { OR: [{ slug: PLATFORM_TENANT_SLUG }, { isPlatform: true }] },
    select: { id: true },
  });

  if (existing) {
    return existing.id;
  }

  const created = await client.tenant.create({
    data: {
      businessName: PLATFORM_TENANT_NAME,
      email: PLATFORM_TENANT_EMAIL,
      slug: PLATFORM_TENANT_SLUG,
      isPlatform: true,
      status: "ACTIVE",
      emailVerifiedAt: now,
    },
    select: { id: true },
  });

  return created.id;
}
