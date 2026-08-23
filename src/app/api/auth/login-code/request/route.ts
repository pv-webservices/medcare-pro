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
 * ONE RESPONSE FOR EVERY REGISTERED ADDRESS. Pending account, rejected account,
 * suspended account, suspended organisation, unverified email, platform user,
 * account still inside its resend cooldown, and a perfectly eligible user all
 * produce byte-identical 200s. So does a failure to deliver the mail — see the
 * note in lib/loginCode.ts on why reporting that would itself be a disclosure.
 *
 * 404 IS THE ONE ACCOUNT FACT THIS ENDPOINT NOW DISCLOSES: the address is not
 * registered. That is a deliberate product decision, not an oversight — the
 * reasoning, and what it costs, is stated once on `AccountNotFoundError` in
 * src/lib/auth.ts and referenced from UNKNOWN_ACCOUNT_LOGIN_CODE_MESSAGE. Do not
 * widen it: the service reports `unknown-account` for a missing user and nothing
 * else, and every other ineligibility stays inside the 200.
 *
 * The other two exceptions disclose nothing about any account:
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
    // This handler learns exactly one bit back: whether the address exists. Every
    // other branch collapses into `sent`, which is what keeps the rest of the
    // account's state out of reach here.
    const { message, outcome } = await requestLoginCode(
      { prisma, sendEmail: sendLoginCodeEmail },
      {
        email: parsed.data.email,
        ip: readClientIp(request),
        userAgent: readUserAgent(request),
      },
    );

    if (outcome === "unknown-account") {
      return NextResponse.json(
        { success: false, error: message },
        { status: 404 },
      );
    }

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
