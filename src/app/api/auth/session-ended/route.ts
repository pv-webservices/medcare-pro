import { NextResponse } from "next/server";

/**
 * Clears a dead session cookie and forwards the user to a screen that will
 * actually render for them.
 *
 * WHY THIS EXISTS AT ALL. The dashboard shell can discover that a session is
 * dead — revoked, expired, or the account suspended — but it is a Server
 * Component, and a Server Component cannot write a cookie. So the shell used to
 * `redirect("/login?ended=1")` and leave the dead JWT in the browser. That
 * cookie then kept lying to `src/middleware.ts`, which only ever decodes the
 * token and cannot know the row behind it is gone: every later navigation to
 * /signup, or to any public auth screen, was bounced to /dashboard, refused, and
 * bounced back. From the user's side the page simply refused to navigate.
 *
 * A Route Handler CAN write cookies, so the shell redirects here instead, this
 * deletes the cookie, and the browser continues to the destination with no
 * session at all — which is the truth.
 *
 * NOT A REPLACEMENT FOR SIGNING OUT. src/components/dashboard/SignOutButton.tsx
 * still revokes the `app_sessions` row first and then calls Auth.js `signOut`.
 * This route is only reached when the row is ALREADY dead, so there is nothing
 * left to revoke — the cookie is the only debris.
 *
 * REACHABLE BY ANYONE, AND THAT IS FINE. The worst a stranger can do by linking
 * someone here is log them out. That is a nuisance, not an escalation: it grants
 * nothing, reveals nothing, and the user signs back in. The alternative — a
 * signed, single-use logout token — would be real machinery guarding an action
 * whose entire effect is "you are now less authenticated than before".
 */

/**
 * Auth.js session cookies, across every naming this deployment can produce:
 * the plain name in development, the `__Secure-` prefix behind HTTPS, and the
 * `.0` / `.1` suffixes Auth.js adds when a token is too large for one cookie.
 * Matched by pattern rather than listed, so a chunk count we did not anticipate
 * is still cleared.
 */
const SESSION_COOKIE_PATTERN =
  /^(__Secure-)?(authjs|next-auth)\.session-token(\.\d+)?$/;

/**
 * Where this route is willing to send a browser. An exact allowlist, not a
 * prefix test and not a same-origin check: `?to=` arrives in a URL the user may
 * have been handed by anyone, and an open redirect on an auth endpoint is a
 * ready-made phishing hop. Anything unrecognised falls back to the login screen.
 */
const ALLOWED_DESTINATIONS = new Set<string>([
  "/login",
  "/owner/dashboard",
  "/pending-approval",
]);

const DEFAULT_DESTINATION = "/login?ended=1";

/**
 * Rebuilds the destination from its parts rather than passing the caller's
 * string through. Only the path is matched against the allowlist, and only the
 * two parameters the sign-out screens actually read are carried over — so a
 * crafted `?to=/login?next=https://evil.example` cannot smuggle anything past.
 */
function resolveDestination(raw: string | null): string {
  if (!raw || !raw.startsWith("/")) {
    return DEFAULT_DESTINATION;
  }

  let parsed: URL;
  try {
    // A fixed base: `raw` is path-only by the check above, so the origin here is
    // discarded and exists only to make URL parsing legal.
    parsed = new URL(raw, "http://localhost");
  } catch {
    return DEFAULT_DESTINATION;
  }

  if (!ALLOWED_DESTINATIONS.has(parsed.pathname)) {
    return DEFAULT_DESTINATION;
  }

  const forwarded = new URLSearchParams();
  const status = parsed.searchParams.get("status");
  if (status) {
    forwarded.set("status", status);
  }
  if (parsed.pathname === "/login") {
    // Load-bearing: middleware.ts lets a request with a still-decodable JWT
    // reach /login only when this flag is present. The cookie is about to be
    // deleted, so it should be moot — but the redirect and the Set-Cookie race
    // in exactly one direction, and keeping the flag costs nothing.
    forwarded.set("ended", "1");
    const reason = parsed.searchParams.get("reason");
    if (reason) {
      forwarded.set("reason", reason);
    }
  }

  const query = forwarded.toString();
  return query ? `${parsed.pathname}?${query}` : parsed.pathname;
}

export async function GET(request: Request): Promise<NextResponse> {
  const requestUrl = new URL(request.url);
  const destination = resolveDestination(requestUrl.searchParams.get("to"));

  // 303, not the default 307: the browser must issue a plain GET for the
  // destination regardless of how it arrived here.
  const response = NextResponse.redirect(
    new URL(destination, requestUrl.origin),
    303,
  );

  for (const pair of request.headers.get("cookie")?.split(";") ?? []) {
    const name = pair.split("=")[0]?.trim();
    if (!name || !SESSION_COOKIE_PATTERN.test(name)) {
      continue;
    }

    // Expired explicitly rather than via `cookies.delete`, because a browser
    // only drops a cookie when the clearing Set-Cookie matches its attributes.
    // `__Secure-` names are refused outright unless the clearing header also
    // carries Secure, so a bare delete would silently leave the cookie in place
    // in production — the one environment where this route matters most.
    response.cookies.set(name, "", {
      path: "/",
      maxAge: 0,
      httpOnly: true,
      sameSite: "lax",
      secure: name.startsWith("__Secure-"),
    });
  }

  return response;
}
