import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendLoginCodeEmail } from "@/lib/email";
import { RateLimitError } from "@/lib/rateLimit";
import {
  GENERIC_LOGIN_CODE_MESSAGE,
  requestLoginCode,
  requestLoginCodeSchema,
} from "@/lib/loginCode";
import { readClientIp, readUserAgent } from "@/lib/requestMeta";
import type { ApiResponse } from "@/lib/utils";

/**
 * Request a six-digit login code — Stage 4.
 *
 * Unauthenticated by definition, so it follows the hand-rolled response style of
 * the other two unauthenticated auth routes (signup, verify-email) rather than
 * the requireActor()/apiHandler style used everywhere behind a session.
 *
 * ONE RESPONSE, ALWAYS. Unknown address, pending account, rejected account,
 * suspended account, suspended organisation, unverified email, platform user,
 * account still inside its resend cooldown, and a perfectly eligible user all
 * produce byte-identical 200s. So does a failure to deliver the mail — see the
 * note in lib/loginCode.ts on why reporting that would itself be a disclosure.
 *
 * The two exceptions, both of which disclose nothing about any account:
 *   400  the body is not a valid email address at all — a client bug, not an
 *        account fact, and answering it generically would leave a broken form
 *        silently doing nothing.
 *   429  the caller is throttled. Fixed message, no retry window, no subject.
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

  const parsed = requestLoginCodeSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Enter a valid email address." },
      { status: 400 },
    );
  }

  try {
    // The service decides everything — eligibility, cooldown, issuing, mailing.
    // This handler never learns which branch was taken, which is the simplest
    // possible guarantee that it cannot leak one.
    const { message } = await requestLoginCode(
      { prisma, sendEmail: sendLoginCodeEmail },
      {
        email: parsed.data.email,
        ip: readClientIp(request),
        userAgent: readUserAgent(request),
      },
    );

    return NextResponse.json({ success: true, data: null, message }, { status: 200 });
  } catch (error: unknown) {
    if (error instanceof RateLimitError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 429 },
      );
    }

    // An unexpected failure must not become an oracle either: a 500 on real
    // addresses and a 200 on unknown ones would be a perfectly good enumeration
    // channel. Log it and answer exactly as every other outcome answers.
    console.error("POST /api/auth/login-code/request failed", error);
    return NextResponse.json(
      { success: true, data: null, message: GENERIC_LOGIN_CODE_MESSAGE },
      { status: 200 },
    );
  }
}
