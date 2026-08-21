import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Vitest — PURE UNIT TESTS ONLY.
 *
 * Everything under tests/unit imports modules that touch neither Prisma nor the
 * session, so the suite runs with no database and no environment. That is the
 * whole point: these rules (slug generation, role-key resolution, status
 * transitions, feature precedence) are the ones a migration or an authorisation
 * bug turns on, and they must be testable without standing anything up.
 *
 * Database-backed integration and security checks stay in scripts/verify-*.mts,
 * which are guarded to localhost and run against real rows. The two layers are
 * deliberately separate — see README and the Stage 1 notes.
 */
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    // Mirrors the "@/*" -> "./src/*" mapping in tsconfig.json. Kept explicit
    // rather than pulled from a plugin so the test run has one less dependency.
    alias: { "@": resolve(import.meta.dirname, "src") },
  },
});
