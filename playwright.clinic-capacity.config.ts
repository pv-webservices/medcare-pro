import { defineConfig } from "@playwright/test";

const databaseHost = (() => { try { return new URL(process.env.DATABASE_URL ?? "").hostname; } catch { return ""; } })();
if (!["localhost", "127.0.0.1"].includes(databaseHost)) {
  throw new Error("Clinic-capacity E2E tests require a disposable localhost database.");
}

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "clinicCapacity.spec.ts",
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  outputDir: "test-results/clinic-capacity",
  reporter: [["list"], ["html", { outputFolder: "playwright-report/clinic-capacity", open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:33310",
    viewport: { width: 1440, height: 1000 },
    channel: process.env.PLAYWRIGHT_CHANNEL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npx next start --hostname 127.0.0.1 --port 33310",
    url: "http://127.0.0.1:33310/login",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: process.env.DATABASE_URL!,
      NEXTAUTH_SECRET: "disposable-clinic-capacity-e2e-secret-only",
      AUTH_SECRET: "disposable-clinic-capacity-e2e-secret-only",
      NEXTAUTH_URL: "http://127.0.0.1:33310",
      AUTH_URL: "http://127.0.0.1:33310",
      TZ: "Asia/Kolkata",
    },
  },
});
