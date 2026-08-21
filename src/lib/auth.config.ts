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

  // Auth.js v5 reads AUTH_SECRET by default; NEXTAUTH_SECRET is named
  // explicitly here so the variable in .env.example is the one that counts.
  secret: process.env.NEXTAUTH_SECRET,

  // Self-hosted on Hostinger behind a proxy rather than on Vercel, so the host
  // header has to be trusted for callback URLs to resolve correctly.
  trustHost: true,

  // Intentionally empty: the middleware instance only needs to *read* a
  // session cookie, never to issue one. Providers are added in `auth.ts`.
  providers: [],

  callbacks: {
    // Persists the user id, tenant id and — since Stage 2 — the session
    // registry id.
    //
    // `sid` is the only claim that authorizes anything, and it does so only by
    // pointing at an `app_sessions` row that is then read from the database
    // (lib/session.ts). `id` and `tenantId` ride along so that non-authorizing
    // code can avoid a round-trip, but requireActor() re-derives `tenantId`
    // from the session row rather than trusting the copy here.
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.tenantId = user.tenantId;
        token.sid = user.sid;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        if (token.id) {
          session.user.id = token.id as string;
        }
        if (token.tenantId) {
          session.user.tenantId = token.tenantId as string;
        }
        if (token.sid) {
          session.user.sid = token.sid as string;
        }
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
