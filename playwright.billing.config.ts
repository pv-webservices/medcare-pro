import { defineConfig } from "@playwright/test";
const databaseHost = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "").hostname;
  } catch {
    return "";
  }
})();
if (!["localhost", "127.0.0.1"].includes(databaseHost))
  throw new Error("Billing E2E requires disposable localhost database.");
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /billing.*\.spec\.ts/,
  workers: 1,
  timeout: 120_000,
  use: {
    baseURL: "http://127.0.0.1:33313",
    headless: true,
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 900 } } },
    { name: "mobile", use: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: "npx next start --hostname 127.0.0.1 --port 33313",
    url: "http://127.0.0.1:33313/login",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: process.env.DATABASE_URL!,
      AUTH_SECRET: "disposable-billing-e2e-secret",
      NEXTAUTH_SECRET: "disposable-billing-e2e-secret",
      AUTH_URL: "http://127.0.0.1:33313",
      NEXTAUTH_URL: "http://127.0.0.1:33313",
      TZ: "Asia/Kolkata",
      AI_ENABLED: "false",
    },
  },
});
