import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { seedDefaultRoles, type PrismaClientOrTransaction } from "@/lib/defaultRoles";
import { buildVerificationUrl, issueVerificationToken } from "@/lib/verification";
import { VERIFICATION_PURPOSES } from "@/lib/verificationPurpose";
import { EmailDeliveryError, sendVerificationEmail } from "@/lib/email";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";
import { resolveUniqueSlug, slugifyBusinessName } from "@/lib/tenantSlug";
import {
  MIN_PASSWORD_LENGTH,
  normalizeSignupInput,
  signupSchema,
} from "@/lib/signupInput";
import type { ApiResponse } from "@/lib/utils";

/**
 * Clinic registration — PRD §6.1 (FR-1.1, FR-1.2), widened by Stage 3.
 *
 * Creates one Tenant plus one applicant User, seeds the tenant's default roles,
 * and issues a verification token — all in a single transaction, so a partial
 * signup cannot be left behind. The verification email is sent after the commit.
 *
 * TWO CHANGES FROM THE PRE-STAGE-3 ROUTE, both deliberate:
 *
 *   1. NO ROLE IS ASSIGNED HERE. The account-wide role is granted when the
 *      Platform Owner approves the application (Stage 3 item 10,
 *      src/lib/platform/decisions.ts). An unapproved applicant holding an
 *      account-wide role would be a permission waiting for a status bug.
 *
 *   2. The account is PENDING on two axes, not one. `tenants.status` and
 *      `users.account_status` both default to PENDING, so verifying the email
 *      no longer grants access by itself — src/lib/auth.ts refuses the login
 *      and tells the applicant their application is under review.
 *
 * The roles ARE still seeded here. They are the tenant's own catalogue, they
 * grant nothing on their own, and seeding at signup keeps the approval
 * transaction short.
 */

const BCRYPT_ROUNDS = 12;

/**
 * Slug collisions are resolved by suffixing, but two concurrent signups can
 * still pick the same free candidate before either commits. The unique index
 * catches that; this is how many times the whole transaction is retried before
 * giving up. Three is generous — a second collision on the same name in the
 * same instant is already improbable.
 */
const SLUG_ATTEMPTS = 3;

function json<T>(body: ApiResponse<T>, status: number): NextResponse<ApiResponse<T>> {
  return NextResponse.json(body, { status });
}

/**
 * Picks a free slug for a new organisation.
 *
 * The candidate set is read inside the caller's transaction, so it sees the
 * newest committed slugs. `startsWith` narrows the scan to the only rows that
 * could collide: `resolveUniqueSlug` only ever appends `-2`, `-3`, … to the base.
 */
async function allocateTenantSlug(
  client: PrismaClientOrTransaction,
  clinicName: string,
): Promise<string> {
  const base = slugifyBusinessName(clinicName);

  const neighbours = await client.tenant.findMany({
    where: { slug: { startsWith: base } },
    select: { slug: true },
  });

  const taken = new Set(
    neighbours.map((row) => row.slug).filter((slug): slug is string => slug !== null),
  );

  return resolveUniqueSlug(base, (candidate) => taken.has(candidate));
}

/** True when a unique-constraint violation was raised by the slug index. */
function isSlugConflict(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002"
  ) {
    return false;
  }
  const target = error.meta?.target;
  const fields = Array.isArray(target) ? target.join(",") : String(target ?? "");
  return fields.includes("slug");
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

  let input;
  try {
    input = normalizeSignupInput(parsed.data);
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return json(
        { success: false, error: error.issues[0]?.message ?? "Check your details." },
        400,
      );
    }
    throw error;
  }

  // Hashed before the transaction opens, not inside it. bcrypt at 12 rounds
  // costs a few hundred milliseconds of pure CPU; running it inside would hold
  // a database connection open for that whole time and count against Prisma's
  // interactive-transaction timeout, for no benefit — it touches no rows.
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  let verificationToken: string | null = null;

  for (let attempt = 1; attempt <= SLUG_ATTEMPTS; attempt += 1) {
    try {
      verificationToken = await prisma.$transaction(async (tx) => {
        const now = new Date();
        const slug = await allocateTenantSlug(tx, input.clinicName);

        const tenant = await tx.tenant.create({
          data: {
            businessName: input.clinicName,
            email: input.email,
            slug,
            city: input.city,
            phone: input.phone,
            address: input.address,
            primaryContactEmail: input.businessEmail,
            // Stage 3 requires an explicit consent, and the schema records WHEN
            // it was given rather than a bare boolean — a timestamp can be
            // reconciled with the terms version in force at that moment.
            termsAcceptedAt: now,
            // `status` is left to default to PENDING. Spelling it out here would
            // invite a future edit to set it to something else.
          },
          select: { id: true },
        });

        /**
         * THE ACCOUNT'S FIRST CLINIC, created from the very details this form
         * already collects.
         *
         * WHY THIS IS HERE. Signup captured the clinic's name, city and address
         * and wrote all three onto the TENANT, then created no `clinics` row at
         * all. Every clinical table — doctors, patients, registrations,
         * appointments — is scoped by `clinic_id`, so a brand new account had
         * nowhere to put any of them: the modules rendered, and every one of
         * them was permanently empty. The only way to get a clinic was the
         * Clinics screen, which is exactly the screen this change removes.
         *
         * One account, one clinic, created at signup. The multi-clinic data
         * model is untouched — `clinics` is still a table with a tenant_id and
         * nothing stops a tenant owning several rows — this only guarantees that
         * the count is never zero, which is the case that was broken.
         *
         * The tenant keeps its own copy of these fields: those are the BUSINESS's
         * details as given on the application, and the Platform Owner judges the
         * application against them. This row is the operational clinic that
         * records hang off. They start identical and are edited in different
         * places, which is intended.
         */
        await tx.clinic.create({
          data: {
            tenantId: tenant.id,
            name: input.clinicName,
            city: input.city,
            address: input.address,
          },
        });

        const applicant = await tx.user.create({
          data: {
            tenantId: tenant.id,
            name: input.name,
            email: input.email,
            phone: input.phone,
            passwordHash,
            // accountStatus and membershipStatus both default to PENDING.
          },
          select: { id: true },
        });

        await seedDefaultRoles(tx, tenant.id);

        const issued = await issueVerificationToken(
          tx,
          input.email,
          VERIFICATION_PURPOSES.TENANT_EMAIL,
          now,
        );

        await writeAuditLog(tx, {
          action: AUDIT_ACTIONS.CLINIC_REGISTERED,
          targetType: "Tenant",
          targetId: tenant.id,
          actorUserId: applicant.id,
          actorTenantId: tenant.id,
          afterValue: {
            status: "PENDING",
            clinicName: input.clinicName,
            city: input.city,
          },
        });

        return issued.token;
      });

      break;
    } catch (error: unknown) {
      if (isSlugConflict(error)) {
        if (attempt < SLUG_ATTEMPTS) {
          continue;
        }
        // Out of attempts. Falling through would hit the P2002 branch below and
        // tell the applicant their EMAIL was taken, which is both wrong and
        // alarming — the address is fine, we simply could not name their
        // organisation. Answer generically instead.
        console.error("Signup exhausted slug attempts", input.clinicName);
        return json(
          { success: false, error: "Could not create the account. Try again." },
          500,
        );
      }

      // P2002 on tenants.email or users.email — this address is already taken.
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
  }

  if (verificationToken === null) {
    console.error("Signup could not allocate a unique slug", input.clinicName);
    return json(
      { success: false, error: "Could not create the account. Try again." },
      500,
    );
  }

  // Sent only after the transaction commits — mailing a link to a token that a
  // later rollback erased would send the user to a dead page.
  try {
    await sendVerificationEmail({
      to: input.email,
      businessName: input.clinicName,
      verificationUrl: buildVerificationUrl(verificationToken),
    });
  } catch (error: unknown) {
    // FR-1.2 — never report success when no link went out. The account rows
    // survive deliberately: it is inert until verified, and discarding a valid
    // signup over a transient mail outage is worse than asking for a resend,
    // which POST /api/auth/verify-email provides.
    const detail =
      error instanceof EmailDeliveryError ? error.message : "Unknown error";
    console.error(`Verification email failed for ${input.email}: ${detail}`);

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
