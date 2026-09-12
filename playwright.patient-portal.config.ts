import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
const db = new URL(process.env.DATABASE_URL ?? "mysql://invalid");
if (
  !["localhost", "127.0.0.1"].includes(db.hostname) ||
  !db.pathname.startsWith("/medcare_ep_portal_")
)
  throw new Error(
    "Patient Portal E2E requires disposable local medcare_ep_portal_ database.",
  );
export default defineConfig({
  expect: { timeout: 30000 },
  testDir: "./tests/e2e",
  testMatch: /patient-portal\.spec\.ts/,
  workers: 1,
  timeout: 120000,
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
  ],
  use: {
    baseURL: "http://127.0.0.1:33322",
    headless: true,
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npx next dev --hostname 127.0.0.1 --port 33322",
    url: "http://127.0.0.1:33322/patient/login",
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      DATABASE_URL: process.env.DATABASE_URL!,
      NODE_ENV: "development",
      AUTH_SECRET: "disposable-patient-portal-staff-auth-secret",
      NEXTAUTH_SECRET: "disposable-patient-portal-staff-auth-secret",
      AUTH_URL: "http://127.0.0.1:33322",
      NEXTAUTH_URL: "http://127.0.0.1:33322",
      PATIENT_PORTAL_OTP_SECRET: "disposable-patient-portal-test-pepper-2026",
      PATIENT_PORTAL_TEST_TRANSPORT: "local-file",
      PATIENT_PORTAL_TEST_OUTBOX: resolve(
        process.env.PATIENT_PORTAL_TEST_OUTBOX ??
          "C:/Users/hp/.codex/visualizations/2026/09/12/01a096d9-a9e5-7331-a731-25e4a20362e1/portal-outbox",
      ),
      TZ: "Asia/Kolkata",
    },
  },
});
