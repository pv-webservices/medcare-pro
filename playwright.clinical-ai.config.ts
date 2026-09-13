import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
const database = new URL(process.env.DATABASE_URL ?? "mysql://invalid");
if (
  !["localhost", "127.0.0.1"].includes(database.hostname) ||
  !database.pathname.startsWith("/medcare_ep")
)
  throw new Error(
    "Clinical AI E2E requires disposable localhost medcare_ep database.",
  );
export default defineConfig({
  outputDir: "playwright-report/clinical-ai-artifacts",
  testDir: "./tests/e2e",
  testMatch: /clinical-ai\.spec\.ts/,
  workers: 1,
  timeout: 90000,
  use: {
    baseURL: "http://127.0.0.1:33312",
    headless: true,
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npx next start --hostname 127.0.0.1 --port 33312",
    url: "http://127.0.0.1:33312/login",
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      DATABASE_URL: process.env.DATABASE_URL!,
      AUTH_SECRET: "disposable-prescription-e2e-secret",
      NEXTAUTH_SECRET: "disposable-prescription-e2e-secret",
      AUTH_URL: "http://127.0.0.1:33312",
      NEXTAUTH_URL: "http://127.0.0.1:33312",
      TZ: "Asia/Kolkata",
      AI_ENABLED: "true",
      AI_PROVIDER: "gemini",
      GEMINI_API_KEY: "synthetic-e2e-never-sent",
      GEMINI_MODEL: "synthetic-model",
      GEMINI_TIMEOUT_MS: "15000",
      NODE_OPTIONS: `--require "${resolve("tests/e2e/clinical-ai-provider-mock.cjs").replaceAll("\\", "/")}"`,
    },
  },
});
