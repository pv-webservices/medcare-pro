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
  "/registration",
  "/doctors",
  "/clinics",
  "/reports",
  "/notifications",
  "/messages",
  "/settings",
] as const;

/**
 * Reachable without a session. `/signup` and `/verify-email` are part of the
 * FR-1.1/FR-1.2 flow, which by definition runs before one exists.
 */
const PUBLIC_AUTH_PATHS = ["/login", "/signup", "/verify-email"] as const;

const LOGIN_PATH = "/login";
const DEFAULT_SIGNED_IN_PATH = "/dashboard";

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export default auth((req) => {
  const { nextUrl } = req;
  const isSignedIn = Boolean(req.auth);

  if (nextUrl.pathname === "/") {
    return NextResponse.redirect(new URL(isSignedIn ? DEFAULT_SIGNED_IN_PATH : LOGIN_PATH, nextUrl));
  }

  // FR-1.2 — unauthenticated users are redirected to /login.
  if (!isSignedIn && isProtectedPath(nextUrl.pathname)) {
    return NextResponse.redirect(new URL(LOGIN_PATH, nextUrl));
  }

  // A signed-in user has no use for the signup/login screens.
  const isPublicAuthPath = PUBLIC_AUTH_PATHS.some(
    (path) => nextUrl.pathname === path,
  );
  if (isSignedIn && isPublicAuthPath) {
    return NextResponse.redirect(new URL(DEFAULT_SIGNED_IN_PATH, nextUrl));
  }

  return NextResponse.next();
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
