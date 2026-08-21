import { PLATFORM_TENANT_SLUG } from "@/lib/platformTenant";

/**
 * Tenant slug generation — Stage 1.
 *
 * A slug is the human-readable half of an invitation URL:
 *
 *     /invite/<tenant-slug>/<opaque-token>
 *
 * It exists so a person can see which organisation invited them before they
 * click. It is COSMETIC. Authorisation for accepting an invitation comes from
 * the hashed token and nothing else — never from the slug, and never from the
 * fact that a slug in the URL happens to resolve to a real tenant.
 *
 * Pure: no Prisma, no session. Uniqueness is resolved by passing in a predicate,
 * so the same function serves the backfill (checking a snapshot in memory) and
 * signup (checking the database).
 */

/** Long enough to stay readable, short enough to keep the URL sane. */
const MAX_SLUG_LENGTH = 60;

/** Used when a business name reduces to nothing sluggable (e.g. all emoji). */
const FALLBACK_SLUG = "clinic";

/**
 * Slugs that must never belong to a customer.
 *
 * "platform" is the load-bearing one: it names the reserved Owner tenant, and a
 * customer holding it would collide with the row the Owner's login points at.
 * The rest are top-level route segments — a tenant slug that shadows one turns
 * a legitimate URL into an ambiguous one.
 */
export const RESERVED_SLUGS: readonly string[] = [
  PLATFORM_TENANT_SLUG,
  "owner",
  "admin",
  "api",
  "app",
  "www",
  "login",
  "signup",
  "logout",
  "invite",
  "dashboard",
  "settings",
  "clinics",
  "doctors",
  "registration",
  "reports",
  "notifications",
  "messages",
  "verify-email",
  "support",
  "help",
  "static",
  "public",
  "health",
] as const;

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.includes(slug);
}

/**
 * Turns a business name into a slug candidate.
 *
 * Deterministic: the same input always yields the same output, so a backfill can
 * be re-run and produce identical slugs rather than a second set of them.
 *
 * Accented characters are decomposed and their marks stripped, so "Clínica Núñez"
 * becomes "clinica-nunez" rather than losing the letters entirely.
 */
export function slugifyBusinessName(name: string): string {
  const slug = name
    .normalize("NFKD")
    // Strip the combining marks left behind by NFKD decomposition.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    // Anything that is not an unaccented letter or digit becomes a separator.
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    // Slicing can leave a trailing separator behind.
    .replace(/-+$/g, "");

  return slug.length > 0 ? slug : FALLBACK_SLUG;
}

/**
 * Resolves a base candidate to a slug nothing else holds.
 *
 * Collisions and reserved words are both handled by suffixing: `acme`,
 * `acme-2`, `acme-3`, … The first candidate is never suffixed, so the common
 * case stays clean.
 *
 * `isTaken` is supplied by the caller, which is what keeps this function pure —
 * the backfill passes a Set lookup, signup passes a database query result.
 *
 * Throws rather than looping forever if a caller supplies an `isTaken` that
 * answers true for everything; an unbounded loop inside a migration would be
 * far worse than a loud failure.
 */
export function resolveUniqueSlug(
  base: string,
  isTaken: (candidate: string) => boolean,
  maxAttempts = 1000,
): string {
  const root = base.length > 0 ? base : FALLBACK_SLUG;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const candidate = attempt === 1 ? root : `${root}-${attempt}`;

    if (!isReservedSlug(candidate) && !isTaken(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Could not find a free slug for "${base}" after ${maxAttempts} attempts.`,
  );
}
