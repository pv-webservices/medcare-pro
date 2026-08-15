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
  "/patients",
  "/appointments",
  "/messages",
  "/receptionist",
] as const;

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

  // FR-1.2 — unauthenticated users are redirected to /login.
  if (!isSignedIn && isProtectedPath(nextUrl.pathname)) {
    return NextResponse.redirect(new URL(LOGIN_PATH, nextUrl));
  }

  // A signed-in admin has no use for the login screen.
  if (isSignedIn && nextUrl.pathname === LOGIN_PATH) {
    return NextResponse.redirect(new URL(DEFAULT_SIGNED_IN_PATH, nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  /**
   * Skip Next internals and static assets. API routes are excluded too — the
   * Twilio and WhatsApp webhooks authenticate by request signature, not by
   * session (PRD §10), so a session redirect there would break them. Admin API
   * routes check the session in the handler itself.
   */
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
