import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendPasswordResetEmail } from "@/lib/email";
import { RateLimitError } from "@/lib/rateLimit";
import { readClientIp, readUserAgent } from "@/lib/requestMeta";
import {
  RESET_REQUESTED_MESSAGE,
  requestPasswordReset,
  requestPasswordResetSchema,
} from "@/lib/passwordReset";
import type { ApiResponse } from "@/lib/utils";

/**
 * Ask for a password reset link — the POST behind /forgot-password.
 *
 * Unauthenticated by definition, so it follows the hand-rolled response style of
 * the other unauthenticated auth routes rather than the requireActor()/
 * apiHandler style used behind a session.
 *
 * STATUS CODES, AND WHAT EACH ONE MEANS TO THE CLIENT:
 *
 *   200  a registered address. Says nothing further — eligible, unverified,
 *        pending and suspended accounts are byte-identical here, and so is a
 *        failure to deliver the mail.
 *   404  no account exists for that address. THE ONE DISCLOSED BRANCH; see the
 *        enumeration note at the top of src/lib/passwordReset.ts.
 *   400  the body is not a valid email address — a client bug, not an account
 *        fact.
 *   429  throttled. Fixed message, no retry window, no subject.
 *
 * The client picks its copy from the STATUS alone (see forgotPasswordState.ts),
 * so no server string reaches the screen.
 */
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

  const parsed = requestPasswordResetSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Enter a valid email address." },
      { status: 400 },
    );
  }

  try {
    const result = await requestPasswordReset(
      { prisma, sendEmail: sendPasswordResetEmail },
      {
        email: parsed.data.email,
        ip: readClientIp(request),
        userAgent: readUserAgent(request),
      },
    );

    if (result.outcome === "unknown-account") {
      return NextResponse.json(
        { success: false, error: result.message },
        { status: 404 },
      );
    }

    return NextResponse.json(
      { success: true, data: null, message: result.message },
      { status: 200 },
    );
  } catch (error: unknown) {
    if (error instanceof RateLimitError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 429 },
      );
    }

    // An unexpected failure answers as the neutral branch does. A 500 for
    // registered addresses and a 404 for unknown ones would be a second, wider
    // oracle than the one this endpoint deliberately opens: it would leak the
    // account's STATE, not just its existence.
    console.error("POST /api/auth/password-reset/request failed", error);
    return NextResponse.json(
      { success: true, data: null, message: RESET_REQUESTED_MESSAGE },
      { status: 200 },
    );
  }
}
