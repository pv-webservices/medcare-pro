import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/lib/auth.config";

/**
 * Route protection — PRD §6.1 (FR-1.2).
 *
 * Uses the edge-safe config only: this runs on every matched request, so it
 * decodes the session JWT rather than hitting the database.
 */
const { auth } = NextAuth(authConfig);

/**
 * URL prefixes served by the `src/app/(dashboard)` route group. Route groups
 * are stripped from the URL, so there is no "/(dashboard)" path to match on —
 * this list has to be kept in step with the folders in that group by hand.
 */
const PROTECTED_PREFIXES = [
  "/dashboard",
  // AP-6. Was missing while every other folder in the group was listed, so an
  // unauthenticated request for /appointments fell through to the page instead
  // of being redirected here. The page's own requireActor() still refused it —
  // this was a gap in the courtesy layer, not an access-control hole — but the
  // refusal arrived as a server error rather than a redirect to /login.
  "/appointments",
  "/registration",
  "/doctors",
  "/clinics",
  "/reports",
  "/notifications",
  "/messages",
  "/team",
  "/settings",
] as const;

/**
 * The platform surface (Stage 2). Kept out of PROTECTED_PREFIXES because it
 * bounces to a different login screen, and out of PUBLIC_AUTH_PATHS because a
 * signed-in clinic user must NOT be redirected away from it — being redirected
 * would itself confirm that /owner is real.
 *
 * This is a presence check and nothing more. Whether the session belongs to an
 * Owner is decided in the page by requirePlatformOwner(), against the database.
 * The middleware runs on the edge and can only see the JWT, which by decision
 * carries no authorization we are willing to trust.
 */
const OWNER_PREFIX = "/owner";
const OWNER_LOGIN_PATH = "/owner/login";

/**
 * Reachable without a session. `/signup` and `/verify-email` are part of the
 * FR-1.1/FR-1.2 flow, which by definition runs before one exists; the two
 * password-reset screens are the same shape.
 */
const PUBLIC_AUTH_PATHS = [
  "/login",
  "/signup",
  "/verify-email",
  "/forgot-password",
  "/reset-password",
] as const;

/**
 * Public auth paths that a "signed-in" visitor is NEVER bounced away from.
 *
 * THE BUG THIS FIXES, because it is not obvious from the code alone. "Signed in"
 * on this line means only "a decodable JWT is present" — it can be intact while
 * the `app_sessions` row behind it is revoked or expired. A user in that state
 * who clicked "Sign up" on the login screen went: /signup → bounced to /dashboard
 * → the shell refuses the dead session → back to /login?ended=1. Three redirects
 * that look exactly like the page refusing to navigate, which is what it was
 * reported as.
 *
 * The dashboard now clears that dead cookie at the source (see
 * signedOutDestination in src/app/(dashboard)/layout.tsx), so the loop is gone
 * from the other end too. This list is the second half of the rule, and it holds
 * on its own merits: a stale cookie must never be what stands between a user and
 * a way to recover their account. Bouncing someone off /login to /dashboard is a
 * courtesy; bouncing them off /forgot-password is a lockout.
 */
const ALWAYS_REACHABLE_AUTH_PATHS = new Set<string>([
  "/signup",
  "/forgot-password",
  "/reset-password",
]);

const LOGIN_PATH = "/login";
const DEFAULT_SIGNED_IN_PATH = "/dashboard";
const AUTH_CACHE_CONTROL =
  "private, no-cache, no-store, max-age=0, must-revalidate";

/**
 * Auth pages and session-dependent redirects must never be retained by a
 * browser, reverse proxy or CDN. In particular, cached auth HTML can outlive
 * the hashed assets from the release that produced it.
 */
function preventAuthCaching(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", AUTH_CACHE_CONTROL);
  response.headers.set("CDN-Cache-Control", "no-store");
  response.headers.set("Surrogate-Control", "no-store");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export default auth((req) => {
  const { nextUrl } = req;
  const isSignedIn = Boolean(req.auth);

  if (nextUrl.pathname.startsWith(OWNER_PREFIX)) {
    // Only the coarse check belongs here: no session at all cannot possibly be
    // an Owner, so send it to the Owner login screen. Everything else falls
    // through to the page's own database-backed check.
    if (!isSignedIn && nextUrl.pathname !== OWNER_LOGIN_PATH) {
      return NextResponse.redirect(new URL(OWNER_LOGIN_PATH, nextUrl));
    }
    return NextResponse.next();
  }

  if (nextUrl.pathname === "/") {
    return preventAuthCaching(
      NextResponse.redirect(
        new URL(isSignedIn ? DEFAULT_SIGNED_IN_PATH : LOGIN_PATH, nextUrl),
      ),
    );
  }

  // FR-1.2 — unauthenticated users are redirected to /login.
  if (!isSignedIn && isProtectedPath(nextUrl.pathname)) {
    return preventAuthCaching(
      NextResponse.redirect(new URL(LOGIN_PATH, nextUrl)),
    );
  }

  // A signed-in user has no use for the signup/login screens — UNLESS the
  // dashboard has just refused their session and sent them here (Stage 3).
  //
  // "Signed in" here means only "a decodable JWT is present". The token can be
  // intact while the session row behind it is revoked, or the account is
  // suspended; in that case bouncing them back to /dashboard, which is what
  // refused them, is an infinite loop. `ended=1` is set by the dashboard shell
  // to break it.
  //
  // The flag is trivially forgeable and that is fine: the worst a forged one
  // can do is show a signed-in user the login form, which grants nothing.
  const isPublicAuthPath = PUBLIC_AUTH_PATHS.some(
    (path) => nextUrl.pathname === path,
  );
  const isAlwaysReachable = ALWAYS_REACHABLE_AUTH_PATHS.has(nextUrl.pathname);
  const isSessionEnded = nextUrl.searchParams.get("ended") === "1";
  if (isSignedIn && isPublicAuthPath && !isAlwaysReachable && !isSessionEnded) {
    return preventAuthCaching(
      NextResponse.redirect(new URL(DEFAULT_SIGNED_IN_PATH, nextUrl)),
    );
  }

  const response = NextResponse.next();
  return isPublicAuthPath ? preventAuthCaching(response) : response;
});

export const config = {
  /**
   * Skip Next internals and static assets. API routes are excluded too — the
   * WhatsApp BSP delivery-status webhook authenticates by request signature,
   * not by session (PRD §9), so a session redirect there would break it. Admin
   * API routes check the session and call lib/rbac.ts in the handler itself.
   */
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
