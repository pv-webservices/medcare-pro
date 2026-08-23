import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendPasswordResetEmail } from "@/lib/email";
import { readClientIp, readUserAgent } from "@/lib/requestMeta";
import {
  RESET_LINK_INVALID_MESSAGE,
  confirmPasswordReset,
  confirmPasswordResetSchema,
} from "@/lib/passwordReset";
import type { ApiResponse } from "@/lib/utils";

/**
 * Redeem a reset link and set the new password — the POST behind
 * /reset-password.
 *
 * NO SESSION IS CREATED HERE. A successful reset answers 200 and the page sends
 * the user to /login to sign in with the password they just chose. Minting a
 * session on the strength of an emailed link would turn the link into the
 * credential, which is exactly what src/lib/passwordReset.ts declines to do.
 *
 * THE VALIDATION ERROR IS SPECIFIC, THE LINK ERROR IS NOT:
 *
 *   200  changed. Every other live session for that user is now revoked.
 *   400  the new password does not meet the length rule — the user must be told
 *        which rule they missed or they cannot comply.
 *   410  the link is invalid, expired, already used, or the account behind it is
 *        no longer resettable. All four answer identically: the holder of a dead
 *        link can act on "request a new one" and on nothing else.
 *
 * `sendPasswordResetEmail` is passed in only to satisfy the service's dependency
 * shape; the confirm path never mails anything.
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

  const parsed = confirmPasswordResetSchema.safeParse(payload);
  if (!parsed.success) {
    // Only the password rule is echoed. A missing or malformed token falls
    // through to the same generic sentence a dead link gets.
    const passwordIssue = parsed.error.issues.find(
      (issue) => issue.path[0] === "password",
    );
    return NextResponse.json(
      { success: false, error: passwordIssue?.message ?? RESET_LINK_INVALID_MESSAGE },
      { status: 400 },
    );
  }

  try {
    const result = await confirmPasswordReset(
      { prisma, sendEmail: sendPasswordResetEmail },
      {
        token: parsed.data.token,
        password: parsed.data.password,
        ip: readClientIp(request),
        userAgent: readUserAgent(request),
      },
    );

    if (result.outcome === "invalid-link") {
      return NextResponse.json(
        { success: false, error: result.message },
        { status: 410 },
      );
    }

    return NextResponse.json(
      { success: true, data: null, message: result.message },
      { status: 200 },
    );
  } catch (error: unknown) {
    console.error("POST /api/auth/password-reset/confirm failed", error);
    return NextResponse.json(
      { success: false, error: "Could not change the password. Try again." },
      { status: 500 },
    );
  }
}
