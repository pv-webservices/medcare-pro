import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authConfig } from "@/lib/auth.config";
import { createAppSession } from "@/lib/appSession";
import { evaluateAccessStatus } from "@/lib/accessStatus";

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

/**
 * FR-1.5 — lets the login page tell "unverified" apart from "wrong password".
 *
 * Auth.js collapses every `authorize` failure into a generic CredentialsSignin
 * error, EXCEPT that a subclass's `code` is copied into the callback URL
 * (@auth/core/index.js) and surfaced as `code` by `signIn({ redirect: false })`.
 * That is the only supported channel for distinguishing the two.
 *
 * This code does reveal that the address is registered — but it is only ever
 * reached after the password has already verified, so it tells a caller nothing
 * they had not already proven.
 */
export class EmailNotVerifiedError extends CredentialsSignin {
  code = "EmailNotVerified";
}

/**
 * Best-effort client IP for the session record.
 *
 * Self-hosted behind a proxy, so `x-forwarded-for` is the only source there is;
 * its first entry is the original client. It is client-controllable and is
 * therefore recorded for the "your devices" list and incident review ONLY —
 * nothing authorizes on it.
 */
function readClientIp(request: Request | undefined): string | null {
  const forwarded = request?.headers?.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() ?? null;
  }
  return request?.headers?.get("x-real-ip") ?? null;
}

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
      async authorize(credentials, request) {
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
            accountStatus: true,
            membershipStatus: true,
            tenant: {
              select: { emailVerifiedAt: true, status: true, isPlatform: true },
            },
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
        if (!user.tenant.emailVerifiedAt) {
          throw new EmailNotVerifiedError();
        }

        // Stage 2 — the core authorization rule, applied at the door as well as
        // on every request. Without it a suspended user would sign in
        // successfully and then be bounced by requireActor() on the very next
        // navigation, which reads as a broken app rather than a locked account.
        //
        // Returns the same generic null as a wrong password: which of the three
        // statuses refused is not something an unauthenticated caller may learn.
        // The platform tenant is exempt from the tenant-status gate because it
        // has no approval lifecycle (see lib/platform/context.ts).
        const access = evaluateAccessStatus({
          tenantStatus: user.tenant.isPlatform ? "ACTIVE" : user.tenant.status,
          accountStatus: user.accountStatus,
          membershipStatus: user.membershipStatus,
        });
        if (!access.allowed) {
          return null;
        }

        // The session registry row is created here, at the one point where a
        // credential has actually been proven. Its id becomes the `sid` claim;
        // a token without one is unauthenticated (lib/sessionPolicy.ts).
        const now = new Date();
        const sid = await createAppSession(prisma, {
          userId: user.id,
          tenantId: user.tenantId,
          ip: readClientIp(request),
          userAgent: request?.headers?.get("user-agent") ?? null,
          now,
        });

        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: now },
        });

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          tenantId: user.tenantId,
          sid,
        };
      },
    }),
  ],
});
