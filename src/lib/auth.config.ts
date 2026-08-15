import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe Auth.js configuration — PRD §6.1.
 *
 * This module deliberately imports NOTHING that touches Prisma or bcrypt.
 * `src/middleware.ts` loads it on every request; pulling the Prisma client into
 * that bundle would put a database client in the hot path of every page load
 * and work against the PRD §10 performance budget.
 *
 * The Credentials provider (which does need Prisma + bcrypt) lives in
 * `src/lib/auth.ts` and spreads this config.
 */
export const authConfig = {
  // FR-1.2 — send unauthenticated users to our own login screen, not the
  // default Auth.js page.
  pages: {
    signIn: "/login",
  },

  // The Credentials provider only works with JWT sessions — Auth.js does not
  // support database sessions for credentials logins. See docs note in
  // prisma/schema.prisma about the (currently unused) `sessions` table.
  session: {
    strategy: "jwt",
  },

  // PRD §11 / per-clinic setup: each deployment supplies its own secret.
  // Auth.js v5 reads AUTH_SECRET by default; NEXTAUTH_SECRET is named
  // explicitly here so the variable in .env.example is the one that counts.
  secret: process.env.NEXTAUTH_SECRET,

  // Clinics self-host on Hostinger behind a proxy rather than on Vercel, so the
  // host header has to be trusted for callback URLs to resolve correctly.
  trustHost: true,

  // Intentionally empty: the middleware instance only needs to *read* a
  // session cookie, never to issue one. Providers are added in `auth.ts`.
  providers: [],

  callbacks: {
    // Persist the user id on the token so `session.user.id` is available
    // without a database round-trip on every request.
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    session({ session, token }) {
      if (token.id && session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
