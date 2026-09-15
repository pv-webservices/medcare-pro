import "dotenv/config";
import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
const db = new URL(process.env.DATABASE_URL || "mysql://invalid");
if (
  !["127.0.0.1", "localhost"].includes(db.hostname) ||
  !db.pathname.startsWith("/medcare_ep_ai2a1")
)
  throw new Error(
    "Clinical audio E2E requires disposable localhost medcare_ep_ai2a1 database.",
  );
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /clinical-(audio|transcription)\.spec\.ts/,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 20000 },
  outputDir: "playwright-report/clinical-audio-artifacts",
  use: {
    baseURL: "http://127.0.0.1:33342",
    headless: true,
    permissions: ["microphone"],
    launchOptions: {
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
      ],
    },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npx next dev --webpack --hostname 127.0.0.1 --port 33342",
    url: "http://127.0.0.1:33342/login",
    reuseExistingServer: false,
    timeout: 240000,
    env: {
      DATABASE_URL: process.env.DATABASE_URL!,
      NODE_ENV: "development",
      AUTH_SECRET: "disposable-prescription-e2e-secret",
      NEXTAUTH_SECRET: "disposable-prescription-e2e-secret",
      AUTH_URL: "http://127.0.0.1:33342",
      NEXTAUTH_URL: "http://127.0.0.1:33342",
      TZ: "Asia/Kolkata",
      AI_ENABLED: "true",
      AI_PROVIDER: "gemini",
      GEMINI_API_KEY: "synthetic-e2e-never-sent",
      GEMINI_MODEL: "synthetic-model",
      CLINICAL_AUDIO_ENABLED:
        process.env.CLINICAL_AUDIO_E2E_DISABLED === "true" ? "false" : "true",
      RECORDING_STORAGE_PROVIDER: "local",
      TRANSCRIPTION_PRIMARY_PROVIDER: "sarvam",
      TRANSCRIPTION_FALLBACK_PROVIDER: "gemini",
      GEMINI_TRANSCRIPTION_API_KEY: "synthetic-fallback-never-sent",
      TRANSCRIPTION_AUTO_FALLBACK: "false",
      SARVAM_API_SUBSCRIPTION_KEY: "synthetic-never-sent",
      SARVAM_TRANSCRIPTION_MODEL: "saaras:v4",
      CLINICAL_TRANSCRIPTION_PUBLIC_BASE_URL: "",
      SARVAM_WEBHOOK_SECRET: "",
      RECORDING_LOCAL_ROOT: resolve(tmpdir(), "medcare-ai2a1-e2e-private"),
      RECORDING_LOCAL_SIGNING_SECRET: "disposable-local-audio-signing-secret",
      NODE_OPTIONS:
        '--require "' +
        resolve("tests/e2e/clinical-ai-provider-mock.cjs").replaceAll(
          "\\",
          "/",
        ) +
        '"',
    },
  },
});
