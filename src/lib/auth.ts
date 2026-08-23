import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authConfig } from "@/lib/auth.config";
import { createAppSession } from "@/lib/appSession";
import { evaluateAccessStatus } from "@/lib/accessStatus";
import { readClientIp, readUserAgent } from "@/lib/requestMeta";
import { sendLoginCodeEmail } from "@/lib/email";
import {
  RATE_LIMIT_POLICIES,
  RateLimitError,
  createDatabaseRateLimiter,
} from "@/lib/rateLimit";
import { verifyLoginCode, verifyLoginCodeSchema } from "@/lib/loginCode";
import type { TenantStatus } from "@prisma/client";

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
  /**
   * Stage 5 — "Remember me" on the login form, which until now was a checkbox
   * that did nothing. It arrives as a string because the credentials body is
   * form-encoded on the wire, and it is optional so that any caller that omits
   * it keeps the previous 12-hour behaviour exactly.
   *
   * ONLY the truthy string opts in: anything else, including "TRUE", "1" and
   * "yes", falls through to false. A parse that guessed here would hand out
   * 30-day sessions on a typo, and the safe direction is unambiguous.
   *
   * This value has no part in deciding whether the password is right. It is
   * read once, after the credential has already verified, and its whole effect
   * is choosing which of the two constants in sessionPolicy.ts sets
   * `app_sessions.expires_at`. Mirrors the equivalent transform on
   * verifyLoginCodeSchema in lib/loginCode.ts.
   */
  rememberMe: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) => value === true || value === "true"),
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
 * Stage 3 item 4 — the applicant has to be told their application is under
 * review, rather than being shown "invalid email or password" for an account
 * that is perfectly valid and simply not approved yet.
 *
 * WHAT THIS DISCLOSES, AND WHY IT IS ACCEPTABLE. Like EmailNotVerifiedError,
 * this is only ever reached AFTER the password has verified, so the caller has
 * already proven they hold the credential. It reports the state of their own
 * ORGANISATION and nothing about any individual: a user the Owner suspended
 * personally, or one a Tenant Admin removed, still gets the same generic `null`
 * as a wrong password. Confirming "your clinic is not approved yet" to the
 * person who registered it tells them what they already know they are waiting
 * for; confirming "you personally were suspended" is a different disclosure and
 * is deliberately not made here.
 */
export class ClinicStateError extends CredentialsSignin {
  constructor(code: "ClinicPending" | "ClinicRejected" | "ClinicSuspended") {
    super();
    this.code = code;
  }
}

/**
 * Null for a state that gets the generic refusal instead of an explanation.
 * ARCHIVED is one: it is terminal and there is nothing for the applicant to
 * wait for or respond to.
 */
function clinicStateCode(
  status: TenantStatus,
): "ClinicPending" | "ClinicRejected" | "ClinicSuspended" | null {
  switch (status) {
    case "PENDING":
      return "ClinicPending";
    case "REJECTED":
      return "ClinicRejected";
    case "SUSPENDED":
      return "ClinicSuspended";
    default:
      return null;
  }
}

/**
 * The address is not registered at all — "create an account first".
 *
 * ---------------------------------------------------------------------------
 * THIS DELIBERATELY BREAKS THE ENUMERATION GUARANTEE THE REST OF THIS FILE
 * KEEPS. Read this before adding a fourth code, or before "fixing" any of the
 * generic `null`s below to match it.
 *
 * Every other refusal in `authorize` is either generic, or reached only AFTER a
 * password has verified — so the caller had already proven they hold the
 * credential and learned nothing new. This one is different in kind: it is
 * returned to a caller who has proven nothing, and it confirms whether an email
 * address has a MEDCARE PRO account. Anyone can now walk a list of clinic
 * addresses and sort them into "registered" and "not".
 *
 * WHY IT IS HERE ANYWAY. It was asked for, explicitly, as product behaviour: a
 * front-desk user who mistypes their address or has not signed up yet was being
 * told "invalid email or password" and had no way to tell which. The same
 * decision was taken for the login-code form and the password-reset form, so all
 * three now agree. Reversing it means removing this class, the 404 branch in
 * api/auth/login-code/request, and the `unknown-account` branch in
 * lib/passwordReset.ts — and nothing else.
 *
 * WHAT IS STILL NOT DISCLOSED, and must not become so. Only EXISTENCE. A
 * registered address that is unverified, pending, suspended, rejected or has no
 * password set still gets the generic refusal, because the account's STATE is a
 * fact about a real person that an anonymous caller has no claim on.
 *
 * HOW IT IS BOUNDED. `discloseAccountExists` puts the answer behind a per-IP
 * rate limit that never blocks a login — see the note there.
 * ---------------------------------------------------------------------------
 */
export class AccountNotFoundError extends CredentialsSignin {
  code = "AccountNotFound";
}

/**
 * May THIS caller be told that an address is unregistered?
 *
 * The gate does not decide whether the login proceeds — it only decides which
 * of two messages a failed one gets. That asymmetry is the whole design:
 *
 *   - A real user is NEVER locked out by it. They type an address that exists,
 *     so they never reach this call at all; and even if they did, a refused
 *     verdict degrades the message, it does not refuse the sign-in.
 *   - A sweep is capped at `loginDisclosureByIp.maxCount` useful answers per
 *     window per source address. Past that the endpoint goes back to being the
 *     indistinguishable one it was before.
 *
 * Only an unknown address consumes an allowance, so ordinary sign-ins — right
 * password or wrong — never touch the bucket.
 *
 * FAILS CLOSED. If the limiter itself errors, the answer is "no": a database
 * problem must not turn into an uncapped enumeration oracle.
 */
async function discloseAccountExists(ip: string | null): Promise<boolean> {
  try {
    const verdict = await createDatabaseRateLimiter(prisma).checkAndIncrement({
      policy: RATE_LIMIT_POLICIES.loginDisclosureByIp,
      subject: ip ?? "unknown",
    });
    return verdict.allowed;
  } catch (error: unknown) {
    console.error("Login disclosure rate-limit check failed", error);
    return false;
  }
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

        const { email, password, rememberMe } = parsed.data;

        const user = await prisma.user.findUnique({
          where: { email },
          select: {
            id: true,
            name: true,
            email: true,
            passwordHash: true,
            tenantId: true,
            emailVerifiedAt: true,
            accountStatus: true,
            membershipStatus: true,
            tenant: {
              select: { emailVerifiedAt: true, status: true, isPlatform: true },
            },
          },
        });

        // Burn the same amount of time a real comparison would take before
        // failing. Kept even on the disclosed branch below: it costs one bcrypt
        // and still flattens the *other* refusals against each other.
        if (!user?.passwordHash) {
          await bcrypt.compare(password, DUMMY_PASSWORD_HASH);

          // No such account — the one disclosed refusal. See AccountNotFoundError.
          // A user row that merely has no password (an invitation that was never
          // accepted) is NOT this case and keeps the generic refusal: that would
          // be disclosing the account's state, not its existence.
          if (!user && (await discloseAccountExists(readClientIp(request)))) {
            throw new AccountNotFoundError();
          }

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

        // Stage 3 — and this person's OWN address. Stage 1 split the two
        // because an invited team member verifies only their own, and the
        // Stage 1 backfill filled this column for every pre-existing user from
        // their tenant, so no existing login is affected.
        if (!user.emailVerifiedAt) {
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
          // Stage 3 item 4 — an organisation-level refusal is explained; a
          // user-level one is not. See the note on ClinicStateError.
          if (!user.tenant.isPlatform && access.reason === "tenant") {
            const code = clinicStateCode(user.tenant.status);
            if (code) {
              throw new ClinicStateError(code);
            }
          }
          return null;
        }

        // The session registry row is created here, at the one point where a
        // credential has actually been proven. Its id becomes the `sid` claim;
        // a token without one is unauthenticated (lib/sessionPolicy.ts).
        const now = new Date();
        const sid = await createAppSession(prisma, {
          userId: user.id,
          tenantId: user.tenantId,
          // Lengthens THIS session and nothing else — see the note on the
          // schema field above.
          rememberMe,
          ip: readClientIp(request),
          userAgent: readUserAgent(request),
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

    /**
     * Stage 4 — the six-digit login code, as a SECOND provider alongside the
     * password one above, which is untouched.
     *
     * THIS IS THE ONE PLACE A LOGIN CODE IS CONSUMED. Both entry points reach
     * it: the browser calls `signIn("login-code", ...)`, and
     * POST /api/auth/login-code/verify calls the server-side `signIn` action,
     * which builds an internal request against this same provider. Neither
     * verifies anything itself, so a code cannot be spent twice by taking two
     * different routes to the same login.
     *
     * `authorize` returns the identical shape as the password provider —
     * { id, email, name, tenantId, sid } — so the jwt/session callbacks in
     * auth.config.ts carry `sid` for this provider with no change at all. They
     * key off the presence of `user`, not off which provider produced it.
     */
    Credentials({
      id: "login-code",
      credentials: {
        email: { label: "Email", type: "email" },
        code: { label: "Login code", type: "text" },
        rememberMe: { label: "Remember this device", type: "checkbox" },
      },

      /**
       * Returns the user, or `null` for every failure without exception.
       *
       * Unlike the password provider, this one throws NO descriptive subclass of
       * CredentialsSignin. EmailNotVerifiedError and ClinicStateError are safe
       * up there because they are only reachable after a password has already
       * verified, so the caller has proven they hold the credential. Here there
       * is no such proof: a caller submitting a guessed code has proven nothing,
       * so telling them "that account is suspended" rather than "wrong code"
       * would hand an unauthenticated stranger the account's state. Every
       * refusal is the same null.
       */
      async authorize(credentials, request) {
        const parsed = verifyLoginCodeSchema.safeParse(credentials);
        if (!parsed.success) {
          return null;
        }

        try {
          const verified = await verifyLoginCode(
            { prisma, sendEmail: sendLoginCodeEmail },
            {
              ...parsed.data,
              ip: readClientIp(request),
              userAgent: readUserAgent(request),
            },
          );

          return verified ?? null;
        } catch (error: unknown) {
          // Throttling reaches the user as the same generic refusal. Letting it
          // propagate would surface a distinguishable Auth.js error, which is
          // both a worse experience and a signal that the address is worth
          // continuing to attack. The 429 belongs on the request endpoint, which
          // is where a client can act on it.
          if (error instanceof RateLimitError) {
            return null;
          }
          throw error;
        }
      },
    }),
  ],
});
