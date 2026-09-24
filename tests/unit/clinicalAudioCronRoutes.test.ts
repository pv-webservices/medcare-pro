import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  authenticateClinicalAudioCron,
  cronSecretFileCandidates,
  DEFAULT_CRON_SECRET_FILE,
  resolveClinicalAudioCronSecret,
} from "@/lib/clinical-audio/cronAuth";

const mocks = vi.hoisted(() => ({
  worker: vi.fn(),
  romanization: vi.fn(),
  cleanupAudio: vi.fn(),
  cleanupProvider: vi.fn(),
  health: vi.fn(),
  facts: vi.fn(),
}));

vi.mock("@/lib/clinical-facts/service", () => ({
  workFactExtractionOnce: mocks.facts,
}));
vi.mock("@/lib/transcription/worker", () => ({
  workTranscriptionOnce: mocks.worker,
}));
vi.mock("@/lib/transcription/romanization", () => ({
  workRomanizationOnce: mocks.romanization,
}));
vi.mock("@/lib/clinical-audio/cleanup", () => ({
  cleanupAudioOnce: mocks.cleanupAudio,
  cleanupProviderArtifactOnce: mocks.cleanupProvider,
}));
vi.mock("@/lib/clinical-audio/health", () => ({
  getClinicalAudioHealth: mocks.health,
}));

import { POST as workerPost } from "@/app/api/internal/clinical-audio/worker/route";
import { POST as cleanupPost } from "@/app/api/internal/clinical-audio/cleanup/route";
import { GET as healthGet } from "@/app/api/internal/clinical-audio/health/route";

const secret = "synthetic-cron-secret-at-least-32-characters";
const request = (path: string, value = secret, method = "POST") =>
  new Request(`https://example.test${path}`, {
    method,
    headers: value ? { Authorization: `Bearer ${value}` } : undefined,
  });

beforeEach(() => {
  vi.stubEnv("AI_ENABLED", "true");
  vi.stubEnv("CLINICAL_AUDIO_ENABLED", "true");
  vi.stubEnv("CLINICAL_AUDIO_CRON_SECRET", secret);
  mocks.worker.mockResolvedValue(1);
  mocks.romanization.mockResolvedValue(0);
  mocks.facts.mockResolvedValue(1);
  mocks.cleanupAudio.mockResolvedValue(1);
  mocks.cleanupProvider.mockResolvedValue(0);
  mocks.health.mockResolvedValue({
    oldestQueuedAt: null,
    staleLeases: 0,
    processingPastDeadline: 0,
    providerCleanupBacklog: 0,
    retentionOverdue: 0,
    romanizationBacklog: 0,
    factExtractionBacklog: 0,
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("clinical-audio cron machine authentication", () => {
  it("rejects missing and incorrect bearer credentials", async () => {
    expect((await workerPost(request("/worker", ""))).status).toBe(401);
    expect((await workerPost(request("/worker", "wrong-secret-value"))).status).toBe(401);
    expect(mocks.worker).not.toHaveBeenCalled();
  });

  it("fails closed when the server secret is absent or invalid", async () => {
    vi.stubEnv("CLINICAL_AUDIO_CRON_SECRET", "");
    vi.stubEnv("CLINICAL_AUDIO_CRON_SECRET_FILE", join(tmpdir(), "missing-clinical-audio-secret"));
    expect((await workerPost(request("/worker"))).status).toBe(503);
    expect(mocks.worker).not.toHaveBeenCalled();
  });

  it("reads the secret from a private server file when no env value is set", () => {
    const dir = mkdtempSync(join(tmpdir(), "cron-secret-"));
    const file = join(dir, "secret");
    writeFileSync(file, `${secret}\n`);
    try {
      const env = { CLINICAL_AUDIO_CRON_SECRET_FILE: file };
      expect(authenticateClinicalAudioCron(request("/worker"), env)).toBe("authorized");
      expect(authenticateClinicalAudioCron(request("/worker", "wrong-secret-value"), env)).toBe("unauthorized");
      expect(resolveClinicalAudioCronSecret(env)).toBe(secret);
      // An explicit env value always wins over the file.
      expect(authenticateClinicalAudioCron(request("/worker"), { ...env, CLINICAL_AUDIO_CRON_SECRET: "x".repeat(40) })).toBe("unauthorized");
      writeFileSync(file, "too-short");
      expect(authenticateClinicalAudioCron(request("/worker"), env)).toBe("unconfigured");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("finds the account secret file even when the process HOME points elsewhere", () => {
    // Hosting runs the app from <home>/domains/<site>/.../nodejs with its own HOME.
    const account = mkdtempSync(join(tmpdir(), "cron-account-"));
    const app = join(account, "domains", "site", "hbuilds", "versions", "b1", "nodejs");
    mkdirSync(app, { recursive: true });
    writeFileSync(join(account, DEFAULT_CRON_SECRET_FILE), `${secret}\n`);
    try {
      const locations = { cwd: app, home: join(tmpdir(), "not-the-account"), userHome: undefined };
      expect(cronSecretFileCandidates({}, locations)).toContain(join(account, DEFAULT_CRON_SECRET_FILE));
      expect(resolveClinicalAudioCronSecret({}, locations)).toBe(secret);
      // An explicit file path is authoritative: no fallback search.
      expect(cronSecretFileCandidates({ CLINICAL_AUDIO_CRON_SECRET_FILE: "/explicit" }, locations)).toEqual(["/explicit"]);
    } finally {
      rmSync(account, { recursive: true, force: true });
    }
  });

  it("prefers the account home over directories above the app", () => {
    const locations = { cwd: join(tmpdir(), "a", "b"), home: join(tmpdir(), "h"), userHome: join(tmpdir(), "u") };
    const candidates = cronSecretFileCandidates({}, locations);
    expect(candidates.slice(0, 2)).toEqual([
      join(tmpdir(), "u", DEFAULT_CRON_SECRET_FILE),
      join(tmpdir(), "h", DEFAULT_CRON_SECRET_FILE),
    ]);
    expect(new Set(candidates).size).toBe(candidates.length);
  });

  it("accepts only the Authorization header, using fixed-length digests", () => {
    const bodyAndQuery = new Request(
      `https://example.test/worker?secret=${encodeURIComponent(secret)}`,
      { method: "POST", body: JSON.stringify({ secret }) },
    );
    expect(authenticateClinicalAudioCron(bodyAndQuery)).toBe("unauthorized");
    expect(authenticateClinicalAudioCron(request("/worker"))).toBe("authorized");
  });
});

describe("bounded clinical-audio cron routes", () => {
  it("runs one worker pass and returns operational metadata only", async () => {
    const response = await workerPost(request("/worker"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, processed: 1, romanized: 0, facts: 1 });
    expect(mocks.worker).toHaveBeenCalledOnce();
    expect(mocks.worker.mock.calls[0][2]).toBe(1);
    // One fact extraction pass per trigger, under the same worker identity.
    expect(mocks.facts).toHaveBeenCalledOnce();
    expect(mocks.facts.mock.calls[0][0]).toBe(mocks.worker.mock.calls[0][0]);
    const secondResponse = await workerPost(request("/worker"));
    const serialized = JSON.stringify(await secondResponse.json()).toLowerCase();
    for (const forbidden of ["transcript", "patient", "audio", "storage", "provider", "secret"])
      expect(serialized).not.toContain(forbidden);
  });

  it("uses unique worker IDs and preserves bounded domain fencing under concurrent triggers", async () => {
    mocks.worker.mockResolvedValue(0);
    const responses = await Promise.all([
      workerPost(request("/worker")),
      workerPost(request("/worker")),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(mocks.worker).toHaveBeenCalledTimes(2);
    const [first, second] = mocks.worker.mock.calls.map((call) => call[0]);
    expect(first).not.toBe(second);
    expect(mocks.worker.mock.calls.every((call) => call[2] === 1)).toBe(true);
  });

  it("does no work while clinical audio is disabled, but confirms authentication", async () => {
    vi.stubEnv("CLINICAL_AUDIO_ENABLED", "false");
    for (const response of [
      await workerPost(request("/worker")),
      await cleanupPost(request("/cleanup")),
      await healthGet(request("/health", secret, "GET")),
    ]) {
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, enabled: false });
    }
    expect(mocks.worker).not.toHaveBeenCalled();
    expect(mocks.cleanupAudio).not.toHaveBeenCalled();
    expect(mocks.health).not.toHaveBeenCalled();
    // Disabled state is only revealed to an authenticated caller.
    expect((await workerPost(request("/worker", "wrong-secret-value"))).status).toBe(401);
  });

  it("drains the overdue backlog and exposes no object or storage identifiers", async () => {
    mocks.cleanupAudio.mockResolvedValueOnce(1).mockResolvedValueOnce(1).mockResolvedValue(0);
    mocks.cleanupProvider.mockResolvedValueOnce(1).mockResolvedValue(0);
    const response = await cleanupPost(request("/cleanup"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true, recordings: 2, providerArtifacts: 1 });
    expect(JSON.stringify(body).toLowerCase()).not.toMatch(/object|storage|audio.?key|url/);
    expect(mocks.cleanupAudio).toHaveBeenCalledTimes(3);
    expect(mocks.cleanupProvider).toHaveBeenCalledTimes(2);
  });

  it("bounds one cleanup call so a large backlog cannot run unbounded", async () => {
    const response = await cleanupPost(request("/cleanup"));
    expect(await response.json()).toEqual({ ok: true, recordings: 25, providerArtifacts: 0 });
    expect(mocks.cleanupAudio).toHaveBeenCalledTimes(25);
  });

  it("logs a failed pass by category only, never the error message", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failure = Object.assign(new Error("Patient Asha: private transcript text"), { code: "SOURCE_MISSING" });
    mocks.worker.mockRejectedValueOnce(failure);
    mocks.cleanupAudio.mockRejectedValueOnce(new TypeError("s3://bucket/private-object-key"));
    expect((await workerPost(request("/worker"))).status).toBe(503);
    expect((await cleanupPost(request("/cleanup"))).status).toBe(503);
    expect(log.mock.calls).toEqual([
      ["Clinical audio cron pass failed.", { route: "worker", failure: "SOURCE_MISSING" }],
      ["Clinical audio cron pass failed.", { route: "cleanup", failure: "TypeError" }],
    ]);
    log.mockRestore();
  });

  it("returns only the approved health counters", async () => {
    const response = await healthGet(request("/health", secret, "GET"));
    expect(response.status).toBe(200);
    expect(Object.keys(await response.json()).sort()).toEqual([
      "factExtractionBacklog",
      "ok",
      "oldestQueuedAt",
      "processingPastDeadline",
      "providerCleanupBacklog",
      "retentionOverdue",
      "romanizationBacklog",
      "staleLeases",
    ]);
  });
});
