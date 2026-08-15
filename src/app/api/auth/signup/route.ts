import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { OWNER_ROLE_NAME, seedDefaultRoles } from "@/lib/defaultRoles";
import { buildVerificationUrl, issueVerificationToken } from "@/lib/verification";
import { EmailDeliveryError, sendVerificationEmail } from "@/lib/email";
import type { ApiResponse } from "@/lib/utils";

/**
 * Signup — PRD §6.1 (FR-1.1, FR-1.2).
 *
 * Creates one Tenant plus one owner User, seeds the tenant's default roles,
 * assigns Owner tenant-wide, and issues a verification token — all in a single
 * transaction, so a partial signup (a tenant with no owner, or an owner with no
 * role) cannot be left behind. The verification email is sent after the commit.
 *
 * The account is unusable until verified: src/lib/auth.ts blocks login while
 * `tenants.email_verified_at` is null.
 */

const BCRYPT_ROUNDS = 12;

/**
 * Not specified in the PRD. 12 characters matches the minimum the v1 admin
 * provisioning script enforced, so the project's existing stance is preserved.
 */
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 200;

/**
 * Mirrors credentialsSchema in src/lib/auth.ts, with the additions signup needs.
 * Login deliberately uses `.min(1)` for the password — restating the strength
 * policy at login would tell an attacker what to generate. Signup is where the
 * policy is actually enforced.
 */
const signupSchema = z.object({
  businessName: z.string().trim().min(1, "Business name is required").max(255),
  email: z.email().max(255),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
});

function json<T>(body: ApiResponse<T>, status: number): NextResponse<ApiResponse<T>> {
  return NextResponse.json(body, { status });
}

export async function POST(request: Request): Promise<NextResponse<ApiResponse<null>>> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ success: false, error: "Malformed request body." }, 400);
  }

  const parsed = signupSchema.safeParse(payload);
  if (!parsed.success) {
    return json(
      {
        success: false,
        error:
          parsed.error.issues[0]?.message ??
          `Check your details. Passwords must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      },
      400,
    );
  }

  const businessName = parsed.data.businessName;
  const email = parsed.data.email.toLowerCase();

  // Hashed before the transaction opens, not inside it. bcrypt at 12 rounds
  // costs a few hundred milliseconds of pure CPU; running it inside would hold
  // a database connection open for that whole time and count against Prisma's
  // interactive-transaction timeout, for no benefit — it touches no rows.
  const passwordHash = await bcrypt.hash(parsed.data.password, BCRYPT_ROUNDS);

  let verificationToken: string;

  try {
    verificationToken = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { businessName, email },
      });

      await tx.user.create({
        data: {
          tenantId: tenant.id,
          name: businessName,
          email,
          passwordHash,
        },
      });

      await seedDefaultRoles(tx, tenant.id);

      // seedDefaultRoles has just created this, so it resolves; findUniqueOrThrow
      // turns a future rename of OWNER_ROLE_NAME into a loud failure here rather
      // than a silently role-less owner.
      const ownerRole = await tx.role.findUniqueOrThrow({
        where: { tenantId_name: { tenantId: tenant.id, name: OWNER_ROLE_NAME } },
        select: { id: true },
      });

      const owner = await tx.user.findUniqueOrThrow({
        where: { email },
        select: { id: true },
      });

      await tx.userRole.create({
        data: {
          userId: owner.id,
          roleId: ownerRole.id,
          // Null = tenant-wide. The owner is not scoped to any single clinic.
          clinicId: null,
        },
      });

      const issued = await issueVerificationToken(tx, email);
      return issued.token;
    });
  } catch (error: unknown) {
    // P2002 = unique constraint violation, i.e. this email is already taken on
    // either tenants.email or users.email.
    //
    // TRADEOFF: this confirms to an anonymous caller that an address is
    // registered, which the login flow goes to some length to avoid. Signup
    // cannot really hide it — a silent success would leave the real account
    // owner receiving mail about a signup that did not happen, and the person
    // in front of the form with no way forward.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return json(
        {
          success: false,
          error:
            "An account with that email already exists. Log in instead, or request a new verification link.",
        },
        409,
      );
    }

    console.error("Signup transaction failed", error);
    return json(
      { success: false, error: "Could not create the account. Try again." },
      500,
    );
  }

  // Sent only after the transaction commits — mailing a link to a token that a
  // later rollback erased would send the user to a dead page.
  try {
    await sendVerificationEmail({
      to: email,
      businessName,
      verificationUrl: buildVerificationUrl(verificationToken),
    });
  } catch (error: unknown) {
    // FR-1.2 — never report success when no link went out. The account rows
    // survive deliberately: it is inert until verified, and discarding a valid
    // signup over a transient mail outage is worse than asking for a resend,
    // which POST /api/auth/verify-email provides.
    const detail =
      error instanceof EmailDeliveryError ? error.message : "Unknown error";
    console.error(`Verification email failed for ${email}: ${detail}`);

    return json(
      {
        success: false,
        error:
          "Your account was created, but the verification email could not be sent. Request a new link to continue.",
      },
      502,
    );
  }

  return json({ success: true, data: null }, 201);
}
