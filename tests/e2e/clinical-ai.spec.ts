import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createClinicalAiFixture } from "../../scripts/clinical-ai-test-fixture";
import {
  assertPrescriptionTestDatabase,
  PRESCRIPTION_TEST_PASSWORD,
} from "../../scripts/prescription-test-fixture";
assertPrescriptionTestDatabase();
const db = new PrismaClient();
let f: Awaited<ReturnType<typeof createClinicalAiFixture>>;
test.beforeAll(async () => {
  f = await createClinicalAiFixture(db);
});
test.afterAll(async () => {
  await db.$disconnect();
});
async function signIn(page: Page, email = f.doctorUser.email) {
  const csrf = await (await page.request.get("/api/auth/csrf")).json();
  const response = await page.request.post("/api/auth/callback/credentials", {
    form: {
      csrfToken: csrf.csrfToken,
      email,
      password: PRESCRIPTION_TEST_PASSWORD,
      callbackUrl: "http://127.0.0.1:33312/dashboard",
    },
    headers: { "X-Auth-Return-Redirect": "1" },
  });
  expect(response.ok()).toBe(true);
  expect((await response.json()).url).not.toContain("error=");
}
test("doctor reviews, accepts locally, saves and reloads through existing consultation workflow", async ({
  page,
}, info) => {
  const visit = await f.visit();
  await signIn(page);
  await page.goto(`/registration/${visit.id}/consultation`);
  const note = page.getByLabel("History of present illness", { exact: true });
  const control = page.getByLabel(
    "Writing assistance for historyOfPresentIllness",
    { exact: true },
  );
  await note.fill("Patient has sever headache for 3 days.");
  await control.getByRole("button", { name: /^Improve writing for / }).click();
  await control
    .getByRole("button", { name: "Improve grammar", exact: true })
    .click();
  await expect(
    control.getByText("Clinical Writing Suggestion", { exact: true }),
  ).toBeVisible();
  await expect(note).toHaveValue("Patient has sever headache for 3 days.");
  expect(
    await db.clinicalConsultation.count({
      where: { registrationId: visit.id },
    }),
  ).toBe(0);
  await page.screenshot({
    path: info.outputPath("writing-suggestion-desktop.png"),
    fullPage: true,
  });
  await control.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(note).toHaveValue("Patient has severe headache for 3 days.");
  expect(
    await db.clinicalConsultation.count({
      where: { registrationId: visit.id },
    }),
  ).toBe(0);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(note).toHaveValue("Patient has severe headache for 3 days.");
});
test("server rejects mocked provider dose change, preserving original", async ({
  page,
}) => {
  const visit = await f.visit();
  await signIn(page);
  await page.goto(`/registration/${visit.id}/consultation`);
  const note = page.getByLabel("History of present illness", { exact: true });
  const control = page.getByLabel(
    "Writing assistance for historyOfPresentIllness",
    { exact: true },
  );
  await note.fill("Metformin 500 mg twice daily");
  const responsePromise = page.waitForResponse(
    "**/api/clinical-ai/writing-assist",
  );
  await control.getByRole("button", { name: /^Improve writing for / }).click();
  await control
    .getByRole("button", { name: "Improve grammar", exact: true })
    .click();
  const response = await responsePromise;
  expect((await response.json()).data.status).toBe("SAFETY_REJECTED");
  expect(await response.text()).not.toContain("850");
  await expect(control.getByText(/could not be verified/)).toBeVisible();
  await expect(note).toHaveValue("Metformin 500 mg twice daily");
  await expect(
    control.getByRole("button", { name: "Accept", exact: true }),
  ).toHaveCount(0);
});
test("mobile stale acceptance is blocked and dismiss preserves manual changes", async ({
  page,
}, info) => {
  const visit = await f.visit();
  await signIn(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/registration/${visit.id}/consultation`);
  const note = page.getByLabel("History of present illness", { exact: true });
  const control = page.getByLabel(
    "Writing assistance for historyOfPresentIllness",
    { exact: true },
  );
  await note.fill("Patient has sever headache");
  await control.getByRole("button", { name: /^Improve writing for / }).click();
  await control
    .getByRole("button", { name: "Fix spelling", exact: true })
    .click();
  await expect(
    control.getByText("Clinical Writing Suggestion", { exact: true }),
  ).toBeVisible();
  await note.fill("Patient has headache and vomiting");
  await control.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(control.getByRole("alert")).toContainText("The note changed");
  await expect(note).toHaveValue("Patient has headache and vomiting");
  await page.screenshot({
    path: info.outputPath("writing-stale-mobile.png"),
    fullPage: true,
  });
  await control.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(note).toHaveValue("Patient has headache and vomiting");
});
test("restricted field modes, spoofed input and unauthorized scope fail closed", async ({
  page,
}) => {
  const visit = await f.visit();
  await signIn(page);
  await page.goto(`/registration/${visit.id}/consultation`);
  await page
    .getByLabel("Diagnosis / provisional diagnosis", { exact: true })
    .fill("viral fever");
  const control = page.getByLabel("Writing assistance for diagnosis", {
    exact: true,
  });
  await control.getByRole("button", { name: /^Improve writing for / }).click();
  await expect(
    control.getByRole("button", { name: "Make concise", exact: true }),
  ).toHaveCount(0);
  const body = {
    registrationId: visit.id,
    field: "diagnosis",
    mode: "GRAMMAR",
    text: "viral fever",
  };
  expect(
    (
      await page.request.post("/api/clinical-ai/writing-assist", {
        data: { ...body, clinicId: f.clinic.id },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await page.request.post("/api/clinical-ai/writing-assist", {
        data: { ...body, registrationId: (await f.visitC()).id },
      })
    ).status(),
  ).toBe(404);
  await signIn(page, f.receptionist.email);
  expect(
    (
      await page.request.post("/api/clinical-ai/writing-assist", { data: body })
    ).status(),
  ).toBe(404);
});

test("tablet keyboard review handles long text and prevents duplicate requests", async ({
  page,
}, info) => {
  const visit = await f.visit();
  await signIn(page);
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto(`/registration/${visit.id}/consultation`);
  const note = page.getByLabel("History of present illness", { exact: true });
  const control = page.getByLabel(
    "Writing assistance for historyOfPresentIllness",
    { exact: true },
  );
  const source = `Patient has sever headache ${"a".repeat(1800)}`;
  await note.fill(source);
  let requests = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/clinical-ai/writing-assist")) requests++;
  });
  const improve = control.getByRole("button", {
    name: /^Improve writing for /,
  });
  await improve.focus();
  await page.keyboard.press("Enter");
  const spelling = control.getByRole("button", {
    name: "Fix spelling",
    exact: true,
  });
  await spelling.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(
    control.getByText("Clinical Writing Suggestion", { exact: true }),
  ).toBeVisible();
  expect(requests).toBe(1);
  expect(
    await control.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  for (const width of [390, 768, 1366]) {
    await page.setViewportSize({ width, height: 1024 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      `long suggestion fits ${width}px viewport`,
    ).toBe(true);
  }
  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(note).toHaveValue(source);
  await page.screenshot({
    path: info.outputPath("writing-long-tablet.png"),
    fullPage: true,
  });
  await control.getByRole("button", { name: "Dismiss", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(note).toHaveValue(source);
});

test("provider failure leaves the clinician text untouched", async ({
  page,
}) => {
  const visit = await f.visit();
  await signIn(page);
  await page.goto(`/registration/${visit.id}/consultation`);
  const note = page.getByLabel("History of present illness", { exact: true });
  const control = page.getByLabel(
    "Writing assistance for historyOfPresentIllness",
    { exact: true },
  );
  await note.fill("Synthetic provider failure headache");
  await control.getByRole("button", { name: /^Improve writing for / }).click();
  await control
    .getByRole("button", { name: "Improve grammar", exact: true })
    .click();
  await expect(control.getByRole("status")).toContainText(
    "temporarily unavailable",
  );
  await expect(note).toHaveValue("Synthetic provider failure headache");
  await expect(
    control.getByRole("button", { name: "Accept", exact: true }),
  ).toHaveCount(0);
});

test("every field exposes only released modes and direct deferred-mode API calls fail", async ({
  page,
}) => {
  const visit = await f.visit();
  await signIn(page);
  await page.goto(`/registration/${visit.id}/consultation`);
  const fields = [
    "chiefComplaint",
    "historyOfPresentIllness",
    "pastMedicalHistory",
    "examinationFindings",
    "investigationNotes",
    "diagnosis",
    "advice",
    "followUpInstructions",
  ];
  const before = await db.aiRun.count({ where: { registrationId: visit.id } });
  for (const field of fields) {
    await page.locator(`#consultation-${field}`).fill("Patient have headache.");
    const control = page.getByLabel(`Writing assistance for ${field}`, {
      exact: true,
    });
    await control
      .getByRole("button", { name: /^Improve writing for / })
      .click();
    await expect(
      control.getByRole("button", { name: "Fix spelling", exact: true }),
    ).toBeVisible();
    await expect(
      control.getByRole("button", { name: "Improve grammar", exact: true }),
    ).toBeVisible();
    await expect(control.getByRole("button")).toHaveCount(3);
    await expect(
      control.getByRole("button", {
        name: /Make concise|Improve clinical wording/,
      }),
    ).toHaveCount(0);
    for (const mode of ["CONCISE", "CLINICAL_WORDING"]) {
      const response = await page.request.post(
        "/api/clinical-ai/writing-assist",
        {
          data: {
            registrationId: visit.id,
            field,
            mode,
            text: "Patient have headache.",
          },
        },
      );
      expect(response.status()).toBe(400);
      expect((await response.json()).success).toBe(false);
    }
    await control
      .getByRole("button", { name: /^Improve writing for / })
      .click();
  }
  expect(await db.aiRun.count({ where: { registrationId: visit.id } })).toBe(
    before,
  );
});

test("no-change response accurately describes spelling and grammar capability", async ({
  page,
}) => {
  const visit = await f.visit();
  await signIn(page);
  await page.goto(`/registration/${visit.id}/consultation`);
  const note = page.getByLabel("History of present illness", { exact: true });
  const control = page.getByLabel(
    "Writing assistance for historyOfPresentIllness",
    { exact: true },
  );
  await note.fill("Patient has headache for 3 days.");
  await control.getByRole("button", { name: /^Improve writing for / }).click();
  await control
    .getByRole("button", { name: "Improve grammar", exact: true })
    .click();
  await expect(control.getByRole("status")).toHaveText(
    "No safe spelling or grammar changes suggested.",
  );
  await expect(note).toHaveValue("Patient has headache for 3 days.");
  await expect(
    control.getByRole("button", { name: "Accept", exact: true }),
  ).toHaveCount(0);
});
