/**
 * Visit Type vocabulary, kept apart from @/lib/registrations so client
 * components can import it without pulling that module's server-only
 * dependencies (Prisma, RBAC, node:crypto) into the browser bundle.
 *
 * A String column rather than an enum (see prisma/schema.prisma): a clinic that
 * wants a third type later should not need a migration to get one.
 */
export const VISIT_TYPES = ["NEW", "FOLLOW_UP"] as const;
export type VisitType = (typeof VISIT_TYPES)[number];

export const VISIT_TYPE_LABELS: Record<VisitType, string> = {
  NEW: "New patient",
  FOLLOW_UP: "Follow-up",
};

/** Anything unrecognised reads as a new visit rather than breaking the page. */
export function toVisitType(value: string): VisitType {
  return (VISIT_TYPES as readonly string[]).includes(value)
    ? (value as VisitType)
    : "NEW";
}
