import { test, expect, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { prisma } from "../../src/lib/prisma";
import { createClinicalAudioFixture } from "../../scripts/clinical-audio-test-fixture";
import { PRESCRIPTION_TEST_PASSWORD } from "../../scripts/prescription-test-fixture";
const runWorker = (recordingId: string, fail = false) => promisify(execFile)(process.execPath, ["--import", "tsx", resolve("tests/e2e/run-transcription-worker.mts"), recordingId, ...(fail ? ["--fail"] : [])], { env: process.env, timeout: 30_000 });
let fixture: Awaited<ReturnType<typeof createClinicalAudioFixture>>;
test.beforeAll(async ({ request }) => {
  fixture = await createClinicalAudioFixture();
  for (const path of ["/api/clinical-ai/recordings", "/api/clinical-ai/recordings/synthetic/start", "/api/clinical-ai/recordings/synthetic/upload/init", "/api/clinical-ai/recordings/synthetic/transcriptions", "/api/clinical-ai/recordings/synthetic/transcriptions/fallback", "/api/clinical-ai/transcripts/synthetic/romanized", "/api/settings/clinical-ai", "/api/clinical-ai/transcripts/synthetic/speakers/synthetic/confirm", "/api/clinical-ai/transcript-segments/synthetic/corrections", "/api/clinical-ai/transcripts/synthetic/review"]) expect((await request.post(path, { data: {} })).status()).toBe(401);
  for (const path of ["/api/clinical-ai/local-storage", "/api/clinical-ai/recordings/synthetic/audio-url", "/api/clinical-ai/recordings/synthetic/transcriptions/latest", "/api/clinical-ai/transcripts/synthetic", "/api/clinical-ai/transcripts/synthetic/romanized", "/api/clinical-ai/recordings/synthetic/transcriptions/fallback", "/api/settings/clinical-ai"]) expect((await request.get(path)).status()).toBe(401);
});
test.afterAll(async () => { await prisma.$disconnect(); });
test("HTTP cron authentication fences duplicate claims without provider IO", async ({ page }) => {
  test.skip(process.env.CLINICAL_AUDIO_E2E_DISABLED === "true");
  const visit = await open(page);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Record patient consent", exact: true }).click();
  await expect(page.getByText("Consent recorded", { exact: false }).first()).toBeVisible();
  await page.getByRole("button", { name: "Check microphone", exact: true }).click();
  const startRecording = page.getByRole("button", { name: "Start recording", exact: true });
  await expect(startRecording).toBeEnabled();
  await startRecording.click();
  await expect(page.getByLabel("Recording elapsed time")).toHaveText("0:04", { timeout: 15000 });
  await page.getByRole("button", { name: "Stop recording", exact: true }).click();
  await page.getByRole("button", { name: "Upload / Resume upload", exact: true }).click();
  await prisma.transcriptionRun.updateMany({
    where: { status: { in: ["QUEUED", "PREPARING", "SUBMITTED", "PROCESSING"] } },
    data: {
      status: "CANCELLED",
      activeKey: null,
      completedAt: new Date(),
      leaseToken: null,
      leaseExpiresAt: null,
      lockedBy: null,
      lockedAt: null,
    },
  });
  await page.getByRole("button", { name: "Generate transcript", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /QUEUED|PREPARING/ })).toBeVisible();
  const recording = await prisma.consultationRecording.findFirstOrThrow({ where: { registrationId: visit.id, status: "READY" } });
  const initial = await prisma.transcriptionRun.findUniqueOrThrow({ where: { activeKey: recording.id } });
  expect(initial.status).toBe("QUEUED");
  await prisma.consultationRecordingConsent.update({
    where: { id: recording.consentId },
    data: { withdrawnAt: new Date(), withdrawnByUserId: recording.createdByUserId },
  });

  const path = "/api/internal/clinical-audio/worker";
  expect((await page.request.get(path)).status()).toBe(405);
  expect((await page.request.post(path)).status()).toBe(401);
  expect((await page.request.post(path, { headers: { Authorization: "Bearer incorrect-synthetic-secret" } })).status()).toBe(401);
  expect((await prisma.transcriptionRun.findUniqueOrThrow({ where: { id: initial.id } })).status).toBe("QUEUED");

  const authorization = { Authorization: "Bearer synthetic-http-cron-secret-at-least-32-characters" };
  const triggered = await Promise.all([
    page.request.post(path, { headers: authorization }),
    page.request.post(path, { headers: authorization }),
  ]);
  expect(triggered.every(response => response.ok())).toBe(true);
  const bodies = await Promise.all(triggered.map(response => response.json()));
  expect(bodies.map(body => body.processed).sort()).toEqual([0, 1]);
  expect(bodies.every(body => Object.keys(body).every((key: string) => ["ok", "processed", "romanized"].includes(key)))).toBe(true);
  const failed = await prisma.transcriptionRun.findUniqueOrThrow({ where: { id: initial.id } });
  expect(failed.status).toBe("FAILED");
  expect(failed.failureCode).toBe("CONSENT_INVALID");
  expect(failed.providerJobId).toBeNull();
  expect(await prisma.transcriptionRun.count({ where: { recordingId: recording.id } })).toBe(1);

  const cleanup = await page.request.post("/api/internal/clinical-audio/cleanup", { headers: authorization });
  expect(cleanup.ok()).toBe(true);
  expect(Object.keys(await cleanup.json()).sort()).toEqual(["ok", "providerArtifacts", "recordings"]);
});
test("tenant opt-in, explicit Gemini fallback, duration limit, partial Romanization and audio expiry", async ({ page, playwright }) => {
  test.setTimeout(180000);
  test.skip(process.env.CLINICAL_AUDIO_E2E_DISABLED === "true");
  const visit = await open(page);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Record patient consent", exact: true }).click();
  await expect(page.getByText("Consent recorded", { exact: false }).first()).toBeVisible();
  await page.getByRole("button", { name: "Check microphone", exact: true }).click();
  await page.getByRole("button", { name: "Start recording", exact: true }).click();
  await expect(page.getByLabel("Recording elapsed time")).toHaveText("0:04", { timeout: 15000 });
  await page.getByRole("button", { name: "Stop recording", exact: true }).click();
  await page.getByRole("button", { name: "Upload / Resume upload", exact: true }).click();
  await expect(page.getByRole("button", { name: "Generate transcript", exact: true })).toBeVisible();
  const recording = await prisma.consultationRecording.findFirstOrThrow({ where: { registrationId: visit.id, status: "READY" } });
  await page.getByRole("button", { name: "Generate transcript", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /QUEUED|PREPARING/ })).toBeVisible({ timeout: 60000 });
  await runWorker(recording.id, true);
  await page.reload();
  await expect(page.getByRole("button", { name: "Retry with Sarvam", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try Gemini", exact: true })).toHaveCount(0);
  expect((await page.request.post(`/api/clinical-ai/recordings/${recording.id}/transcriptions/fallback`, { data: { confirmed: true } })).status()).toBe(409);
  const admin = await playwright.request.newContext({ baseURL: "http://127.0.0.1:33342" });
  try {
    const csrf = await (await admin.get("/api/auth/csrf")).json();
    await admin.post("/api/auth/callback/credentials", { form: { csrfToken: csrf.csrfToken, email: fixture.owner.email, password: PRESCRIPTION_TEST_PASSWORD, callbackUrl: "http://127.0.0.1:33342/dashboard" }, headers: { "X-Auth-Return-Redirect": "1" } });
    expect((await admin.post("/api/settings/clinical-ai", { data: { allowed: true } })).status()).toBe(200);
  } finally { await admin.dispose(); }
  await prisma.consultationRecording.update({ where: { id: recording.id }, data: { durationMs: 31 * 60_000 } });
  await page.reload(); await expect(page.getByText("Gemini fallback is unavailable for this recording length. Retry transcription with Sarvam.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try Gemini", exact: true })).toHaveCount(0);
  expect((await page.request.post(`/api/clinical-ai/recordings/${recording.id}/transcriptions/fallback`, { data: { confirmed: true } })).status()).toBe(409);
  await prisma.consultationRecording.update({ where: { id: recording.id }, data: { durationMs: 29 * 60_000 } });
  await page.reload(); await page.getByRole("button", { name: "Try Gemini", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Confirm Gemini fallback" })).toBeVisible();
  await page.getByRole("button", { name: "Continue with Gemini", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /QUEUED|PREPARING/ })).toBeVisible();
  const completingWorker = runWorker(recording.id);
  await expect(page.getByRole("status").filter({ hasText: /^PROCESSING$/ })).toBeVisible({ timeout: 20000 });
  await completingWorker; await page.reload();
  await expect(page.getByText("Transcript · Gemini 3.5 Transcribe", { exact: true })).toBeVisible();
  const romanizationRequested = page.waitForResponse(r => r.url().endsWith("/romanized") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Romanized", exact: true }).click();
  expect((await romanizationRequested).ok()).toBe(true);
  await promisify(execFile)(process.execPath, ["--import", "tsx", resolve("tests/e2e/run-transcription-worker.mts"), recording.id, "--romanized"], { env: process.env, timeout: 30000 });
  await expect(page.getByText("Romanized view is partially available.", { exact: false })).toBeVisible({ timeout: 20000 });
  await expect(page.getByText("mujhe teen din se bukhar hai", { exact: true })).toBeVisible();
  await expect(page.getByText("آپ میٹفارمین", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Original", exact: true }).click();
  await expect(page.getByText("मुझे तीन दिन से बुखार है", { exact: true }).first()).toBeVisible();
  await prisma.consultationRecording.update({ where: { id: recording.id }, data: { audioDeletedAt: new Date() } });
  await page.reload(); await expect(page.getByText("Audio no longer retained", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Listen at 0.0s/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Audio no longer retained" })).toBeVisible();
  await expect(page.getByLabel("Correction for segment 1")).toBeVisible();
  await expect(page.getByRole("button", { name: "I have reviewed this transcript for clinical documentation" })).toBeVisible();
  expect((await page.request.post(`/api/clinical-ai/recordings/${recording.id}/transcriptions/fallback`, { data: { confirmed: true } })).status()).toBe(409);
  await page.getByRole("button", { name: "Romanized", exact: true }).click(); await expect(page.getByText("mujhe teen din se bukhar hai", { exact: true })).toBeVisible();
});
async function open(page: Page) {
  const visit = await fixture.visit();
  const csrf = await (await page.request.get("/api/auth/csrf")).json();
  const login = await page.request.post("/api/auth/callback/credentials", { form: { csrfToken: csrf.csrfToken, email: fixture.doctorUser.email, password: PRESCRIPTION_TEST_PASSWORD, callbackUrl: "http://127.0.0.1:33342/dashboard" }, headers: { "X-Auth-Return-Redirect": "1" } });
  expect((await login.json()).url).not.toContain("error=");
  expect((await page.goto(`/registration/${visit.id}/consultation`))?.status()).toBe(200);
  return visit;
}
test("native recording to durable transcript, speaker mapping, corrections, review and 17s seek", async ({ page }) => {
  test.skip(process.env.CLINICAL_AUDIO_E2E_DISABLED === "true");
  await page.setViewportSize({ width: 1366, height: 900 });
  const visit = await open(page);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Record patient consent", exact: true }).click();
  await expect(page.getByText("Consent recorded", { exact: false }).first()).toBeVisible();
  await page.getByRole("button", { name: "Check microphone", exact: true }).click();
  await page.getByRole("button", { name: "Start recording", exact: true }).click();
  await expect(page.getByLabel("Recording elapsed time")).toHaveText("0:21", { timeout: 30000 });
  await page.getByRole("button", { name: "Stop recording", exact: true }).click();
  await page.getByRole("button", { name: "Upload / Resume upload", exact: true }).click();
  await expect(page.getByRole("button", { name: "Generate transcript", exact: true })).toBeVisible();
  const recording = await prisma.consultationRecording.findFirstOrThrow({ where: { registrationId: visit.id, status: "READY" } });
  expect(await prisma.transcriptionRun.count({ where: { recordingId: recording.id } })).toBe(0);
  const spoofed = await page.request.post(`/api/clinical-ai/recordings/${recording.id}/transcriptions`, { data: { provider: "GEMINI", audioUrl: "https://example.test/audio" } });
  expect(spoofed.status()).toBe(400);
  await page.getByRole("button", { name: "Generate transcript", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /QUEUED|PREPARING/ })).toBeVisible();
  await runWorker(recording.id, true);
  await page.reload();
  await expect(page.getByRole("button", { name: "Retry with Sarvam", exact: true })).toBeVisible();
  expect(await prisma.clinicalTranscript.count({ where: { recordingId: recording.id } })).toBe(0);
  await page.getByRole("button", { name: "Retry with Sarvam", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /QUEUED|PREPARING/ })).toBeVisible();
  await runWorker(recording.id);
  const run = await prisma.transcriptionRun.findUniqueOrThrow({ where: { activeKey: recording.id } });
  expect(run.status).toBe("PROCESSING");
  await prisma.transcriptionRun.update({ where: { id: run.id }, data: { nextAttemptAt: new Date(0) } });
  await runWorker(recording.id);
  await page.reload();
  await expect(page.getByText("Awaiting clinician review", { exact: false })).toBeVisible();
  await page.getByLabel("Role for speaker_0").selectOption("DOCTOR");
  await expect(page.getByLabel("Role for speaker_1")).toBeEnabled();
  await page.getByLabel("Role for speaker_1").selectOption("PATIENT");
  const review = page.getByRole("button", { name: "I have reviewed this transcript for clinical documentation" });
  await expect(review).toBeEnabled(); await review.click();
  await expect(page.getByText("Clinician reviewed", { exact: false })).toBeVisible();
  await page.getByLabel("Correction for segment 2").fill("No chest pain for three days. Left knee pain.");
  await page.getByRole("button", { name: "Save correction", exact: true }).nth(1).click();
  await expect(page.getByText("Awaiting clinician review", { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Correction for segment 2")).toHaveValue("No chest pain for three days. Left knee pain.");
  await page.getByRole("button", { name: /Listen at 17.0s/ }).click();
  const player = page.getByLabel("Consultation recording playback");
  await expect.poll(() => player.evaluate((element) => (element as HTMLAudioElement).currentTime)).toBeCloseTo(17, 0);
  const firstUrl = await player.getAttribute("src");
  await page.getByRole("button", { name: /Listen at 0.0s/ }).click();
  expect(await player.getAttribute("src")).toBe(firstUrl);
  await page.screenshot({ path: "playwright-report/transcription-screenshots/transcript-1366.png", fullPage: true, caret: "initial" });
  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByRole("region", { name: "Consultation transcript", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `playwright-report/transcription-screenshots/transcript-${width}.png`, fullPage: true, caret: "initial" });
  }
  expect(await page.locator("[data-nextjs-dialog]").count()).toBe(0);
});
