/**
 * Auth.js (NextAuth) configuration — PRD §6.1 (FR-1.1, FR-1.2).
 *
 * SCAFFOLD ONLY. Not implemented yet; wired up in the auth stage.
 * Planned shape:
 *  - Credentials provider (email + password, verified against `User.passwordHash`)
 *  - PrismaAdapter over `src/lib/prisma.ts`
 *  - Unauthenticated requests redirect to `/login`; successful login to `/dashboard`
 *
 * Requires: `npm i next-auth @auth/prisma-adapter bcryptjs`
 */

export {};
