/**
 * The reserved platform tenant — Stage 1 foundation for Owner isolation.
 *
 * `users.tenant_id` is non-null, so a Platform Owner login still needs a Tenant
 * row to point at. Exactly one reserved row exists for that purpose. It is NOT
 * a customer, and letting it leak into a customer query would show the Owner's
 * own bookkeeping row in a list of clinics.
 *
 * Pure data and predicates: no Prisma, no session, no imports. The backfill
 * script, the seed, the Owner read models and the unit tests all share it.
 *
 * WHAT THIS MODULE DOES NOT DO: it is not an authorisation check. Stage 2 adds
 * `requirePlatformOwner()`, which returns a PlatformActorContext carrying
 * { userId, platformRole, sessionId } and deliberately NO `tenantId` field — so
 * that handing an Owner to a tenant-scoped function is a type error rather than
 * a silent cross-tenant read. No `if (isOwner)` bypass is ever added inside a
 * tenant-scoped library.
 */

/** The one slug a customer can never register. */
export const PLATFORM_TENANT_SLUG = "platform";

/** Display name for the reserved row, so it is obvious in a database client. */
export const PLATFORM_TENANT_NAME = "MEDCARE PRO Platform";

/**
 * Spread into every `where` that lists or counts CUSTOMER organisations.
 *
 * Composing this constant rather than hand-writing `isPlatform: false` means a
 * grep for the name finds every customer query at once, and a missed filter is
 * visible by its absence.
 *
 *   prisma.tenant.findMany({ where: { ...CUSTOMER_TENANT_WHERE, status: "ACTIVE" } })
 */
export const CUSTOMER_TENANT_WHERE = { isPlatform: false } as const;

/** Thrown when the reserved tenant reaches code that only handles customers. */
export class PlatformTenantError extends Error {
  constructor() {
    super("The platform tenant is not a customer organisation.");
    this.name = "PlatformTenantError";
  }
}

export function isPlatformTenant(
  tenant: { isPlatform?: boolean | null; slug?: string | null } | null | undefined,
): boolean {
  if (!tenant) {
    return false;
  }
  return tenant.isPlatform === true || tenant.slug === PLATFORM_TENANT_SLUG;
}

/**
 * Belt to `CUSTOMER_TENANT_WHERE`'s braces.
 *
 * Call it wherever a tenant row has been loaded by id — a route parameter, a
 * cookie, a backfill — before treating it as a customer. The filter stops the
 * platform row appearing in lists; this stops it being addressed directly.
 */
export function assertNotPlatformTenant(
  tenant: { isPlatform?: boolean | null; slug?: string | null } | null | undefined,
): void {
  if (isPlatformTenant(tenant)) {
    throw new PlatformTenantError();
  }
}
