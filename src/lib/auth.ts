import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authConfig } from "@/lib/auth.config";

/**
 * Auth.js (NextAuth) configuration — PRD §6.1 (FR-1.1, FR-1.2).
 *
 * Single admin per clinic, provisioned by `prisma/seed.ts`. There is no
 * self-signup in the MVP (PRD §5), so this file only ever verifies an existing
 * credential — it never creates a user.
 */

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

/**
 * A real bcrypt hash of a throwaway string, compared against when no user is
 * found. Without it, "email not found" returns measurably faster than "wrong
 * password", which leaks valid admin emails to anyone timing the endpoint —
 * the same leak FR-1.1's acceptance criteria forbids in the response body.
 */
const DUMMY_PASSWORD_HASH =
  "$2b$12$OJ3jFv9KOzjVHbBcdZHbnek5c4VLp0Mt61tWkWe5kFNRaUQfA5j9q";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },

      /**
       * Returns the user on success, or `null` on any failure.
       *
       * Every failure path returns the same `null` — malformed input, unknown
       * email, and wrong password are indistinguishable to the caller. Auth.js
       * turns that into a generic CredentialsSignin error, which the login page
       * renders as "Invalid email or password". Never throw a descriptive error
       * here: it would surface the reason to the client.
       */
      async authorize(credentials) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) {
          return null;
        }

        const { email, password } = parsed.data;

        const user = await prisma.user.findUnique({
          where: { email },
          select: { id: true, name: true, email: true, passwordHash: true },
        });

        // Unknown email, or a user row with no password set. Burn the same
        // amount of time a real comparison would take before failing.
        if (!user?.passwordHash) {
          await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
          return null;
        }

        const isValid = await bcrypt.compare(password, user.passwordHash);
        if (!isValid) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
        };
      },
    }),
  ],
});
