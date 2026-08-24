import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  buildVerificationUrl,
  clearVerificationTokens,
  consumeVerificationToken,
  issueVerificationToken,
} from "@/lib/verification";
import { VERIFICATION_PURPOSES } from "@/lib/verificationPurpose";
import { EmailDeliveryError, resendVerificationEmail } from "@/lib/email";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";
import type { ApiResponse } from "@/lib/utils";
import type { TenantStatus } from "@prisma/client";

/**
 * Email verification — PRD §6.1 (FR-1.2, FR-1.3, FR-1.5), extended by Stage 3.
 *
 * GET  consumes a token from the emailed link and marks the organisation — and
 *      the applicant who registered it — verified, then redirects.
 * POST re-issues a link for an unverified address (FR-1.5's resend option).
 *
 * WHERE A VERIFIED APPLICANT NOW LANDS. Before Stage 3, verifying was the last
 * gate and success meant "go and log in". It no longer is: the application still
 * has to be approved. So the redirect is chosen from the organisation's status —
 * an approved clinic goes to /login exactly as before, and one still awaiting a
 * decision goes to /pending-approval, which is Stage 3 item 4.
 *
 * The status is disclosed to someone holding a single-use token mailed to that
 * address, about their own organisation. There is no cross-tenant disclosure in
 * it, and the alternative — a verified applicant sent to a login screen that
 * refuses them with no explanation — is the behaviour Stage 3 set out to fix.
 */

const VERIFY_PAGE = "/verify-email";
const LOGIN_PAGE = "/login";
const PENDING_PAGE = "/pending-approval";

const resendSchema = z.object({
  email: z.email().max(255),
});

/**
 * Deliberately uniform for every outcome. Unlike signup, this endpoint is
 * unauthenticated and can be called repeatedly with guessed addresses, so it
 * must not reveal whether an address is registered or already verified.
 */
const RESEND_ACKNOWLEDGEMENT =
  "If that address needs verification, a new link is on its way.";

function redirectTo(request: Request, path: string, params: Record<string, string>) {
  const base = process.env.NEXTAUTH_URL?.trim().replace(/\/$/, "") || new URL(request.url).origin;
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url);
}

/** Where a successfully verified applicant goes, given their organisation's state. */
function destinationForStatus(status: TenantStatus): {
  path: string;
  params: Record<string, string>;
} {
  switch (status) {
    case "ACTIVE":
      // FR-1.3, unchanged — an approved clinic goes straight to the login screen.
      return { path: LOGIN_PAGE, params: { verified: "1" } };
    case "REJECTED":
      return { path: PENDING_PAGE, params: { status: "rejected" } };
    case "SUSPENDED":
      return { path: PENDING_PAGE, params: { status: "suspended" } };
    default:
      return { path: PENDING_PAGE, params: { status: "pending" } };
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const token = new URL(request.url).searchParams.get("token");

  if (!token) {
    return redirectTo(request, VERIFY_PAGE, { status: "invalid" });
  }

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      // Stage 3 — the expected purpose is stated, not inferred. A token minted
      // to verify an individual (Stage 5 invitations) cannot be redeemed here
      // even though it carries the same address.
      const result = await consumeVerificationToken(
        tx,
        token,
        VERIFICATION_PURPOSES.TENANT_EMAIL,
      );

      if (result.status !== "valid") {
        return { status: result.status } as const;
      }

      const tenant = await tx.tenant.findUnique({
        where: { email: result.email },
        select: { id: true, emailVerifiedAt: true, status: true },
      });

      // The token resolved but its tenant is gone — treat as an invalid link
      // rather than erroring, since there is nothing left to verify.
      if (!tenant) {
        return { status: "invalid" } as const;
      }

      const now = new Date();

      // The applicant is the login sharing the organisation's address. Stage 1
      // gave User its own `emailVerifiedAt` because an invited member verifies
      // only their own address; the applicant verifies both at once, from this
      // one link, because at signup the two addresses are the same string.
      const applicant = await tx.user.findFirst({
        where: { tenantId: tenant.id, email: result.email },
        select: { id: true, emailVerifiedAt: true },
      });

      if (applicant && !applicant.emailVerifiedAt) {
        await tx.user.update({
          where: { id: applicant.id },
          data: { emailVerifiedAt: now },
        });
      }

      // Already verified: the token has been consumed above, so a double-click
      // on the emailed link lands here. Report success — the address is
      // verified, which is all the user was asking for.
      if (tenant.emailVerifiedAt) {
        return { status: "valid", tenantStatus: tenant.status } as const;
      }

      await tx.tenant.update({
        where: { id: tenant.id },
        data: { emailVerifiedAt: now },
      });

      await writeAuditLog(tx, {
        action: AUDIT_ACTIONS.CLINIC_EMAIL_VERIFIED,
        targetType: "Tenant",
        targetId: tenant.id,
        // The applicant acted, by clicking a link mailed to their address.
        actorUserId: applicant?.id ?? null,
        actorTenantId: tenant.id,
        afterValue: { emailVerified: true },
      });

      return { status: "valid", tenantStatus: tenant.status } as const;
    });

    if (outcome.status === "valid") {
      const destination = destinationForStatus(outcome.tenantStatus);
      return redirectTo(request, destination.path, destination.params);
    }

    return redirectTo(request, VERIFY_PAGE, { status: outcome.status });
  } catch (error: unknown) {
    console.error("Email verification failed", error);
    return redirectTo(request, VERIFY_PAGE, { status: "error" });
  }
}

export async function POST(
  request: Request,
): Promise<NextResponse<ApiResponse<null>>> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Malformed request body." },
      { status: 400 },
    );
  }

  const parsed = resendSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Enter a valid email address." },
      { status: 400 },
    );
  }

  const email = parsed.data.email.toLowerCase();

  const tenant = await prisma.tenant.findUnique({
    where: { email },
    select: { id: true, businessName: true, emailVerifiedAt: true },
  });

  // Unknown address, or one already verified. Both return the same
  // acknowledgement as a successful resend — see RESEND_ACKNOWLEDGEMENT.
  if (!tenant || tenant.emailVerifiedAt) {
    return NextResponse.json(
      { success: true, data: null, message: RESEND_ACKNOWLEDGEMENT },
      { status: 200 },
    );
  }

  try {
    const token = await prisma.$transaction(async (tx) => {
      // Invalidate outstanding links first, so only the newest one works.
      // Scoped to this purpose: a pending invitation for the same address is a
      // different token in a different flow and must survive.
      await clearVerificationTokens(tx, email, VERIFICATION_PURPOSES.TENANT_EMAIL);
      const issued = await issueVerificationToken(
        tx,
        email,
        VERIFICATION_PURPOSES.TENANT_EMAIL,
      );
      return issued.token;
    });

    await resendVerificationEmail({
      to: email,
      businessName: tenant.businessName,
      verificationUrl: buildVerificationUrl(token),
    });
  } catch (error: unknown) {
    const detail =
      error instanceof EmailDeliveryError ? error.message : "Unknown error";
    console.error(`Verification resend failed for ${email}: ${detail}`);

    // A delivery failure is reported honestly here. The caller has already been
    // told nothing about whether the address exists, so this leaks nothing.
    return NextResponse.json(
      {
        success: false,
        error: "Could not send the verification email. Try again shortly.",
      },
      { status: 502 },
    );
  }

  return NextResponse.json(
    { success: true, data: null, message: RESEND_ACKNOWLEDGEMENT },
    { status: 200 },
  );
}
