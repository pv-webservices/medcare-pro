/* eslint-disable @typescript-eslint/no-require-imports -- Next config is CommonJS. */
const { createHash } = require("node:crypto");
const { readdirSync, readFileSync, statSync } = require("node:fs");
const { join, relative } = require("node:path");

/**
 * Produce one stable identifier for every copy of the same release, while
 * changing it whenever application code or generated assets can change.
 *
 * Hostinger performs rolling deployments behind a CDN. Without a deployment
 * identifier a browser can receive HTML from release A and CSS/JavaScript from
 * release B, which is exactly how the login page ended up alternating between
 * unstyled markup, an old full-screen image and a blank screen.
 *
 * NEXT_DEPLOYMENT_ID remains an escape hatch for hosts that provide their own
 * release identifier. The content hash makes GitHub and ZIP deployments safe
 * without requiring a manually updated environment variable.
 */
function resolveDeploymentId() {
  const configuredId = process.env.NEXT_DEPLOYMENT_ID?.trim();
  if (configuredId) {
    return configuredId;
  }

  const hash = createHash("sha256");
  const inputs = [
    "src",
    "public",
    "prisma",
    "package.json",
    "package-lock.json",
    "postcss.config.mjs",
    "tailwind.config.ts",
  ];

  function addPath(absolutePath) {
    const stats = statSync(absolutePath);
    if (stats.isDirectory()) {
      for (const entry of readdirSync(absolutePath).sort()) {
        addPath(join(absolutePath, entry));
      }
      return;
    }

    hash.update(relative(__dirname, absolutePath).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(readFileSync(absolutePath));
    hash.update("\0");
  }

  for (const input of inputs) {
    addPath(join(__dirname, input));
  }

  return hash.digest("hex").slice(0, 20);
}

const deploymentId = resolveDeploymentId();

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enables cache busting and client recovery during rolling deployments.
  deploymentId,

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
