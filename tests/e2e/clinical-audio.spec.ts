import { test, expect, type Page } from "@playwright/test";
import { prisma } from "../../src/lib/prisma";
import { createClinicalAudioFixture } from "../../scripts/clinical-audio-test-fixture";
import { PRESCRIPTION_TEST_PASSWORD } from "../../scripts/prescription-test-fixture";
let f: Awaited<ReturnType<typeof createClinicalAudioFixture>>;
const disabled = process.env.CLINICAL_AUDIO_E2E_DISABLED === "true";
test.beforeAll(async () => {
  f = await createClinicalAudioFixture();
});
test.afterAll(async () => {
  await prisma.$disconnect();
});
async function open(page: Page) {
  const visit = await f.visit();
  const csrf = await (await page.request.get("/api/auth/csrf")).json();
  const login = await page.request.post("/api/auth/callback/credentials", {
    form: {
      csrfToken: csrf.csrfToken,
      email: f.doctorUser.email,
      password: PRESCRIPTION_TEST_PASSWORD,
      callbackUrl: "http://127.0.0.1:33342/dashboard",
    },
    headers: { "X-Auth-Return-Redirect": "1" },
  });
  expect((await login.json()).url).not.toContain("error=");
  const response = await page.goto("/registration/" + visit.id + "/consultation");
  expect(response?.status(), "Authorized synthetic consultation must load").toBe(200);
  return visit;
}
async function capture(page: Page) {
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Record patient consent", exact: true })
    .click();
  await expect(
    page.getByText("Consent recorded", { exact: false }).first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Check microphone", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Start recording", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Start recording", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Pause recording", exact: true }),
  ).toBeVisible();
}
async function waitChunks(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<number>((resolve, reject) => {
              const req = indexedDB.open("medcare-clinical-audio", 1);
              req.onsuccess = () => {
                const db = req.result;
                const r = db
                  .transaction("chunks")
                  .objectStore("chunks")
                  .getAll();
                r.onsuccess = () => {
                  resolve(r.result.reduce((n, c) => n + c.size, 0));
                  db.close();
                };
                r.onerror = reject;
              };
              req.onerror = reject;
            }),
        ),
      { timeout: 20000 },
    )
    .toBeGreaterThan(1024);
}
async function stopUpload(page: Page) {
  await page
    .getByRole("button", { name: "Stop recording", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Upload / Resume upload", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Upload / Resume upload", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Play recording", exact: true }),
  ).toBeVisible();
}
test("consent, microphone, pause/resume, final chunk, upload and private playback", async ({
  page,
}) => {
  test.skip(disabled);
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    let count = 0;
    Object.defineProperty(window, "__micRequests", { get: () => count });
    navigator.mediaDevices.getUserMedia = (options) => {
      count++;
      return original(options);
    };
  });
  const visit = await open(page);
  expect(
    await page.evaluate(
      () => (window as unknown as { __micRequests: number }).__micRequests,
    ),
  ).toBe(0);
  await expect(
    page.getByRole("button", { name: "Start recording", exact: true }),
  ).toBeDisabled();
  await capture(page);
  await waitChunks(page);
  await page
    .getByRole("button", { name: "Pause recording", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Resume recording", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Resume recording", exact: true })
    .click();
  await stopUpload(page);
  const r = await prisma.consultationRecording.findFirstOrThrow({
    where: { registrationId: visit.id, status: "READY" },
  });
  expect(r.byteSize! > BigInt(1024)).toBeTruthy();
  expect(r.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(
    await prisma.transcriptionRun.count({ where: { recordingId: r.id } }),
  ).toBe(0);
  await page
    .getByRole("button", { name: "Play recording", exact: true })
    .click();
  const player = page.getByLabel("Consultation recording playback");
  await expect(player).toBeVisible();
  await expect
    .poll(() => player.evaluate((e) => (e as HTMLAudioElement).readyState))
    .toBeGreaterThan(0);
  const url = await player.getAttribute("src");
  const bytes = await page.request.get(url!, {
    headers: { Range: "bytes=0-511" },
  });
  expect(bytes.status()).toBe(206);
  expect(bytes.headers()["cache-control"]).toContain("no-store");
  const denied = await page.request.post(
    "/api/clinical-ai/recordings/" + r.id + "/transcription",
  );
  expect(denied.status()).toBe(403);
});
test("reload recovery explicitly uploads captured chunks", async ({ page }) => {
  test.skip(disabled);
  page.on("dialog", (d) => d.accept());
  const visit = await open(page);
  await capture(page);
  await waitChunks(page);
  await page.reload();
  await expect(
    page.getByText("An unfinished consultation recording was found.", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Recover recording", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Play recording", exact: true }),
  ).toBeVisible();
  expect(
    (
      await prisma.consultationRecording.findFirstOrThrow({
        where: { registrationId: visit.id },
      })
    ).status,
  ).toBe("READY");
});
test("discard recovery clears local chunks and aborts server recording", async ({
  page,
}) => {
  test.skip(disabled);
  page.on("dialog", (d) => d.accept());
  const visit = await open(page);
  await capture(page);
  await waitChunks(page);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Discard recording", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Discard recording", exact: true })
    .click();
  await expect(
    page.getByText("An unfinished consultation recording was found.", {
      exact: true,
    }),
  ).toHaveCount(0);
  expect(
    (
      await prisma.consultationRecording.findFirstOrThrow({
        where: { registrationId: visit.id },
      })
    ).status,
  ).toBe("ABORTED");
});
test("withdrawal discards local audio and prevents processing", async ({
  page,
}) => {
  test.skip(disabled);
  page.on("dialog", (d) => d.accept());
  const visit = await open(page);
  await capture(page);
  await waitChunks(page);
  await page
    .getByRole("button", {
      name: "Stop — patient withdrew consent",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Start recording", exact: true }),
  ).toBeVisible();
  const r = await prisma.consultationRecording.findFirstOrThrow({
    where: { registrationId: visit.id },
    include: { consent: true },
  });
  expect(r.status).toBe("ABORTED");
  expect(r.consent.withdrawnAt).not.toBeNull();
  expect(r.storageKey).toBeNull();
  const request = await page.request.post(
    "/api/clinical-ai/recordings/" + r.id + "/upload/init",
    {
      data: {
        mimeType: "audio/webm;codecs=opus",
        byteSize: 2048,
        durationMs: 0,
      },
    },
  );
  expect(request.ok()).toBe(false);
});
test("upload interruption retains local audio and retry succeeds", async ({
  page,
}) => {
  test.skip(disabled);
  await open(page);
  await capture(page);
  await waitChunks(page);
  await page
    .getByRole("button", { name: "Stop recording", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Upload / Resume upload", exact: true }),
  ).toBeVisible();
  await page.route("**/api/clinical-ai/local-storage?*", (route) =>
    route.abort(),
  );
  await page
    .getByRole("button", { name: "Upload / Resume upload", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Recording & Transcript" })
      .getByRole("alert"),
  ).toContainText("Upload paused");
  await page.unroute("**/api/clinical-ai/local-storage?*");
  await page
    .getByRole("button", { name: "Upload / Resume upload", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Play recording", exact: true }),
  ).toBeVisible();
});
test("revoked recording permission hides panel and denies direct request", async ({
  page,
}) => {
  test.skip(disabled);
  const visit = await open(page);
  const role = await prisma.role.findUniqueOrThrow({ where: { id: f.roleId } });
  const p = role.permissions as string[];
  try {
    await prisma.role.update({
      where: { id: f.roleId },
      data: { permissions: p.filter((s) => s !== "clinical-ai:recording") },
    });
    await page.reload();
    await expect(
      page.getByRole("heading", {
        name: "Recording & Transcript",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByText("Clinical Writing Assistant", { exact: false }).first(),
    ).toBeVisible();
    expect(
      (
        await page.request.post("/api/clinical-ai/recordings", {
          data: {
            registrationId: visit.id,
            attested: true,
            method: "VERBAL",
            consenterType: "PATIENT",
          },
        })
      ).status(),
    ).toBe(403);
  } finally {
    await prisma.role.update({
      where: { id: f.roleId },
      data: { permissions: p },
    });
  }
});
for (const viewport of [
  { width: 1366, height: 768 },
  { width: 768, height: 800 },
  { width: 390, height: 844 },
])
  test(
    "recording layout at " + viewport.width + "px",
    async ({ page }, info) => {
      test.skip(disabled);
      await page.setViewportSize(viewport);
      await open(page);
      await expect(
        page.getByRole("heading", {
          name: "Recording & Transcript",
          exact: true,
        }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
      await page.screenshot({
        path: info.outputPath("recording-" + viewport.width + ".png"),
        fullPage: true,
      });
    },
  );
test("microphone denial is controlled and cannot start capture", async ({
  page,
}) => {
  test.skip(disabled);
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("synthetic denial", "NotAllowedError");
    };
  });
  await open(page);
  await page
    .getByRole("button", { name: "Check microphone", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Recording & Transcript" })
      .getByRole("alert"),
  ).toContainText("Microphone access is blocked");
  await expect(
    page.getByRole("button", { name: "Start recording", exact: true }),
  ).toBeDisabled();
});

test("maximum duration auto-stops the same recording", async ({ page }) => {
  test.skip(disabled);
  const visit = await open(page);
  await capture(page);
  await waitChunks(page);
  await page.evaluate(() => {
    const original = performance.now.bind(performance);
    Object.defineProperty(performance, "now", {
      value: () => original() + 7_200_100,
      configurable: true,
    });
  });
  await expect(
    page.getByRole("button", { name: "Upload / Resume upload", exact: true }),
  ).toBeVisible();
  const recording = await prisma.consultationRecording.findFirstOrThrow({
    where: { registrationId: visit.id },
  });
  expect(recording.status).toBe("STOPPED");
  expect(recording.durationMs).toBe(7_200_000);
});

test("failed withdrawal stays non-uploadable after reload", async ({
  page,
}) => {
  test.skip(disabled);
  page.on("dialog", (dialog) => dialog.accept());
  const visit = await open(page);
  await capture(page);
  await waitChunks(page);
  await page.route("**/withdraw-consent", (route) => route.abort());
  await page
    .getByRole("button", {
      name: "Stop — patient withdrew consent",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry consent withdrawal", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Recover recording", exact: true }),
  ).toBeDisabled();
  await page.unroute("**/withdraw-consent");
  await page
    .getByRole("button", { name: "Discard recording", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Recover recording", exact: true }),
  ).toHaveCount(0);
  const recording = await prisma.consultationRecording.findFirstOrThrow({
    where: { registrationId: visit.id },
    include: { consent: true },
  });
  expect(recording.status).toBe("ABORTED");
  expect(recording.consent.withdrawnAt).not.toBeNull();
});

test("unsupported browser leaves consultation notes usable", async ({
  page,
}) => {
  test.skip(disabled);
  await page.addInitScript(() => {
    Object.defineProperty(window, "MediaRecorder", { value: undefined });
  });
  await open(page);
  await expect(
    page
      .getByRole("region", { name: "Recording & Transcript" })
      .getByRole("alert"),
  ).toContainText("does not support consultation recording");
  await expect(
    page.getByLabel("History of present illness", { exact: true }),
  ).toBeVisible();
});

test("microphone device loss stops capture safely", async ({ page }) => {
  test.skip(disabled);
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (options) => {
      const stream = await original(options);
      Object.defineProperty(window, "__testAudioTrack", {
        value: stream.getAudioTracks()[0],
        configurable: true,
      });
      return stream;
    };
  });
  await open(page);
  await capture(page);
  await waitChunks(page);
  await page.evaluate(() => {
    (
      window as unknown as { __testAudioTrack: MediaStreamTrack }
    ).__testAudioTrack.dispatchEvent(new Event("ended"));
  });
  await expect(
    page.getByRole("button", { name: "Upload / Resume upload", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pause recording", exact: true }),
  ).toHaveCount(0);
});

test("audio kill switch preserves writing assistant and prescription notes", async ({
  page,
}) => {
  test.skip(!disabled);
  const visit = await open(page);
  await expect(
    page.getByRole("heading", { name: "Recording & Transcript", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Clinical Writing Assistant", { exact: false }).first(),
  ).toBeVisible();
  await expect(
    page.getByLabel("History of present illness", { exact: true }),
  ).toBeVisible();
  expect(
    (
      await page.request.post("/api/clinical-ai/recordings", {
        data: {
          registrationId: visit.id,
          attested: true,
          method: "VERBAL",
          consenterType: "PATIENT",
        },
      })
    ).status(),
  ).toBe(403);
});
