import { defineConfig } from "@playwright/test";
const databaseHost = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "").hostname;
  } catch {
    return "";
  }
})();
if (!["localhost", "127.0.0.1"].includes(databaseHost))
  throw new Error("Prescription E2E requires disposable localhost database.");
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "prescriptions.spec.ts",
  workers: 1,
  timeout: 90_000,
  use: {
    baseURL: "http://127.0.0.1:33312",
    headless: true,
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npx next start --hostname 127.0.0.1 --port 33312",
    url: "http://127.0.0.1:33312/login",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: process.env.DATABASE_URL!,
      AUTH_SECRET: "disposable-prescription-e2e-secret",
      NEXTAUTH_SECRET: "disposable-prescription-e2e-secret",
      AUTH_URL: "http://127.0.0.1:33312",
      NEXTAUTH_URL: "http://127.0.0.1:33312",
      TZ: "Asia/Kolkata",
    },
  },
});
