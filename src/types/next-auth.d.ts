import type { DefaultSession } from "next-auth";

/**
 * Adds the user id, tenant id and session registry id to the session/token
 * types, populated by the callbacks in `src/lib/auth.config.ts`.
 *
 * `tenantId` is the scoping key every API route filters by. It is declared here
 * so that reading it off the session is type-safe and a route cannot silently
 * fall back to an untrusted client-supplied value.
 *
 * `sid` names the `app_sessions` row behind the token (Stage 2). It is optional
 * because a token minted before the session registry existed will not carry
 * one — and such a token is treated as unauthenticated, which is precisely why
 * the type must admit its absence rather than assert it away.
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      tenantId: string;
      sid?: string;
    } & DefaultSession["user"];
  }

  interface User {
    tenantId?: string;
    sid?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    tenantId?: string;
    sid?: string;
  }
}
