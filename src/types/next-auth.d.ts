import type { DefaultSession } from "next-auth";

/**
 * Adds the user id and tenant id to the session/token types, populated by the
 * callbacks in `src/lib/auth.config.ts`.
 *
 * `tenantId` is the scoping key every API route filters by. It is declared here
 * so that reading it off the session is type-safe and a route cannot silently
 * fall back to an untrusted client-supplied value.
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      tenantId: string;
    } & DefaultSession["user"];
  }

  interface User {
    tenantId?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    tenantId?: string;
  }
}
