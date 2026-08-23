/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * NEXTAUTH_URL in .env is http://127.0.0.1:3000, so every session cookie,
   * callback URL and email link this app issues is scoped to that origin — not
   * "localhost", which resolves to the same machine but is a DIFFERENT origin
   * as far as cookies and Next's dev-server origin check are concerned.
   *
   * Next 16's dev server treats a request for /_next/static/* and the HMR
   * websocket as cross-origin unless the requesting host is on this list, and
   * refuses it with a 403 otherwise — which breaks EVERY client component on
   * the page: no hydration, no onClick handlers, no client-side validation,
   * with nothing in the UI to say why. Both hosts are listed so the app works
   * identically whichever one a developer happens to type.
   */
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

module.exports = nextConfig;
