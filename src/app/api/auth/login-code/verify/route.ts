import { NextResponse } from "next/server";
import { signIn } from "@/lib/auth";
import { verifyLoginCodeSchema } from "@/lib/loginCode";
import type { ApiResponse } from "@/lib/utils";

/**
 * Verify a six-digit login code and establish the session — Stage 4.
 *
 * THIS ROUTE VERIFIES NOTHING ITSELF. Read that literally: there is no call to
 * verifyLoginCode() below. The handler delegates to the Auth.js `login-code`
 * Credentials provider through the server-side `signIn` action, and the provider
 * is the single place a code is ever checked or consumed.
 *
 * WHY IT IS BUILT THIS WAY. The obvious implementation — verify here, then
 * somehow mint a token — produces two independent successful-login paths, and
 * two paths that each consume a code is how a single-use code gets used twice.
 * The alternative of verifying here and handing the provider a second one-time
 * ticket to exchange would mean inventing another secret with its own storage,
 * expiry and revocation rules. Delegating instead means the browser's
 * `signIn("login-code", ...)` and this endpoint are the same code path, differing
 * only in who initiates it.
 *
 * HOW THE COOKIE GETS SET. `signIn` with `redirect: false` runs Auth core in raw
 * mode and writes the returned Set-Cookie values through next/headers — so a
 * successful call leaves this response carrying a real session cookie, exactly
 * as the browser flow would. It returns a URL rather than a status; a failed
 * credential comes back as a URL carrying an `error` parameter, which is what
 * the check below reads.
 *
 * The response says only whether it worked. Which of wrong / expired / consumed
 * / exhausted / ineligible occurred stays in the audit trail, because the caller
 * has proven nothing and is owed nothing.
 */

const GENERIC_VERIFY_FAILURE = "That code is not valid. Request a new one.";

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

  const parsed = verifyLoginCodeSchema.safeParse(payload);
  if (!parsed.success) {
    // Same message as a wrong code. A schema complaint that distinguished "not
    // six digits" from "wrong six digits" would be harmless here, but keeping
    // one string means there is no second message to accidentally enrich later.
    return NextResponse.json(
      { success: false, error: GENERIC_VERIFY_FAILURE },
      { status: 400 },
    );
  }

  try {
    const result = await signIn("login-code", {
      email: parsed.data.email,
      code: parsed.data.code,
      // Auth.js serialises credentials as form fields, so this crosses as a
      // string and is coerced back by verifyLoginCodeSchema in the provider.
      rememberMe: String(parsed.data.rememberMe),
      redirect: false,
    });

    // Auth core reports a refused credential by redirecting to the sign-in page
    // with ?error=..., rather than by throwing.
    const failed =
      typeof result === "string" && new URL(result, "http://localhost").searchParams.has("error");

    if (failed) {
      return NextResponse.json(
        { success: false, error: GENERIC_VERIFY_FAILURE },
        { status: 401 },
      );
    }

    return NextResponse.json({ success: true, data: null }, { status: 200 });
  } catch (error: unknown) {
    // CredentialsSignin and friends land here on some Auth.js paths. Everything
    // is one refusal to the caller; the detail goes to the server log.
    console.error("POST /api/auth/login-code/verify failed", error);
    return NextResponse.json(
      { success: false, error: GENERIC_VERIFY_FAILURE },
      { status: 401 },
    );
  }
}
