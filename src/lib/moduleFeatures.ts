import { DEFAULT_FEATURES } from "@/lib/defaultFeatures";

/**
 * Which feature key gates which module — Stage 8.
 *
 * PURE, and separate from lib/features.ts for a reason beyond tidiness: this
 * map is exactly the sort of thing that breaks silently. A mistyped key does
 * not throw, it just stops gating the module it was supposed to gate. Keeping
 * it free of Prisma means a unit test can hold it against the catalogue on
 * every run, which is what actually catches that.
 */

// ---------------------------------------------------------------------------
// The module map
// ---------------------------------------------------------------------------

/**
 * Which feature key gates which module.
 *
 * Every value here must exist in DEFAULT_FEATURES; a unit test asserts it, so a
 * typo is caught by `npm test` rather than by a module that silently stops
 * being enforced.
 */
export const MODULE_FEATURES = {
  registrations: "registrations",
  doctors: "doctors",
  clinics: "clinics",
  reports: "reports",
  notifications: "notifications",
  whatsapp: "whatsapp",
  team: "team",
  // AP-1. Gated like every other module, but the only PREMIUM one — see the
  // note on its catalogue entry. Silence at layer 3 DENIES here, so a role sees
  // nothing until a Clinic Admin enables it.
  appointments: "appointments",
} as const;

export type ModuleFeatureKey = (typeof MODULE_FEATURES)[keyof typeof MODULE_FEATURES];

/**
 * Features that exist in the catalogue but gate nothing, and why.
 *
 * `settings` is guard 1 above: the Roles and Features screens answer to
 * `role:manage` / `feature:view` / `feature:manage` and to nothing else, so an
 * organisation can always reach the controls that would undo a mistake.
 *
 * `marketing` has no module to gate — the permission catalogue says as much.
 */
export const UNGATED_MODULES: Readonly<Record<string, string>> = {
  settings: "Always available: this is the screen that undoes a mistake.",
  marketing: "No module exists to gate yet.",
};

/** Every key the catalogue defines, for tests and for the seed check. */
export const CATALOGUE_FEATURE_KEYS: readonly string[] = DEFAULT_FEATURES.map(
  (feature) => feature.key,
);
