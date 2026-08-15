import type { DefaultSession } from "next-auth";

/**
 * Adds the user id to the session/token types, populated by the callbacks in
 * `src/lib/auth.config.ts`.
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
  }
}
