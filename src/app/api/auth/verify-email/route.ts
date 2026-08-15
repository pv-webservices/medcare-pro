import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  buildVerificationUrl,
  clearVerificationTokens,
  consumeVerificationToken,
  issueVerificationToken,
} from "@/lib/verification";
import { EmailDeliveryError, resendVerificationEmail } from "@/lib/email";
import type { ApiResponse } from "@/lib/utils";

/**
 * Email verification — PRD §6.1 (FR-1.2, FR-1.3, FR-1.5).
 *
 * GET  consumes a token from the emailed link and marks the tenant verified,
 *      then redirects (FR-1.3 sends the user to /login on success).
 * POST re-issues a link for an unverified address (FR-1.5's resend option).
 */

const VERIFY_PAGE = "/verify-email";
const LOGIN_PAGE = "/login";

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
  const url = new URL(path, new URL(request.url).origin);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url);
}

export async function GET(request: Request): Promise<NextResponse> {
  const token = new URL(request.url).searchParams.get("token");

  if (!token) {
    return redirectTo(request, VERIFY_PAGE, { status: "invalid" });
  }

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const result = await consumeVerificationToken(tx, token);

      if (result.status !== "valid") {
        return result.status;
      }

      const tenant = await tx.tenant.findUnique({
        where: { email: result.email },
        select: { id: true, emailVerifiedAt: true },
      });

      // The token resolved but its tenant is gone — treat as an invalid link
      // rather than erroring, since there is nothing left to verify.
      if (!tenant) {
        return "invalid" as const;
      }

      // Already verified: the token has been consumed above, so a double-click
      // on the emailed link lands here. Report success — the address is
      // verified, which is all the user was asking for.
      if (tenant.emailVerifiedAt) {
        return "valid" as const;
      }

      await tx.tenant.update({
        where: { id: tenant.id },
        data: { emailVerifiedAt: new Date() },
      });

      return "valid" as const;
    });

    if (outcome === "valid") {
      // FR-1.3 — verified users are sent to the login screen.
      return redirectTo(request, LOGIN_PAGE, { verified: "1" });
    }

    return redirectTo(request, VERIFY_PAGE, { status: outcome });
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
      await clearVerificationTokens(tx, email);
      const issued = await issueVerificationToken(tx, email);
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
