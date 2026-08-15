import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authConfig } from "@/lib/auth.config";

/**
 * Auth.js (NextAuth) configuration — PRD §6.1 (FR-1.1 … FR-1.5).
 *
 * Users are created by self-signup (`api/auth/signup`), not by seeding. This
 * file only ever verifies an existing credential — it never creates a user.
 *
 * Credentials live solely on `User`; a `Tenant` has no password of its own, so
 * login always resolves via `User.email`. The FR-1.2 verification flag, however,
 * lives on the Tenant — see the unverified-account check in `authorize`.
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
          select: {
            id: true,
            name: true,
            email: true,
            passwordHash: true,
            tenantId: true,
            tenant: { select: { emailVerifiedAt: true } },
          },
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

        // FR-1.2 / PRD §9 — login is blocked until the tenant's email is
        // verified. Checked only after the password verifies, so an attacker
        // cannot use this branch to discover which emails are registered.
        //
        // FR-1.5 asks for a distinct "please verify your email" message with a
        // resend option, which a bare `null` cannot express. Throwing here
        // surfaces the reason to the login page — safe in this position and
        // this position only, because the caller has already proven they hold
        // the password.
        if (!user.tenant.emailVerifiedAt) {
          throw new Error("EmailNotVerified");
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          tenantId: user.tenantId,
        };
      },
    }),
  ],
});
