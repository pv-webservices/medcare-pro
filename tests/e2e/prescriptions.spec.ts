import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import {
  createPrescriptionFixture,
  PRESCRIPTION_TEST_PASSWORD,
  assertPrescriptionTestDatabase,
} from "../../scripts/prescription-test-fixture";
assertPrescriptionTestDatabase();
const db = new PrismaClient();
let f: Awaited<ReturnType<typeof createPrescriptionFixture>>;
test.beforeAll(async () => {
  f = await createPrescriptionFixture(db);
});
test.afterAll(async () => {
  await db.$disconnect();
});
async function signIn(page: Page, email: string) {
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
async function addMedicine(page: Page, index: number, name: string) {
  await page
    .getByRole("button", { name: "+ Add medicine", exact: true })
    .click();
  await page.locator(`#medicine-${index}-medicineGenericName`).fill(name);
  await page.locator(`#medicine-${index}-dosageForm`).fill("Tablet");
  await page.locator(`#medicine-${index}-strength`).fill("Synthetic strength");
  await page.locator(`#medicine-${index}-dose`).fill("1 tablet");
  await page.locator(`#medicine-${index}-route`).fill("Oral");
  await page.locator(`#medicine-${index}-frequency`).fill("Twice daily");
  await page.locator(`#medicine-${index}-timing`).fill("After food");
  await page.locator(`#medicine-${index}-duration`).fill("5");
  await page.locator(`#medicine-${index}-durationUnit`).fill("days");
}
test("visit consultation saves, reopens, reviews, issues, prints and corrects immutable history", async ({
  page,
}, testInfo) => {
  const visit = await f.visit();
  await signIn(page, f.doctorUser.email);
  await page.goto(`/registration/${visit.id}`);
  await page
    .getByRole("link", { name: "Start Consultation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: f.patient.name, exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Chief complaint / symptoms")
    .fill("Synthetic E2E complaint");
  await page
    .getByLabel("Diagnosis / provisional diagnosis")
    .fill("Synthetic E2E diagnosis");
  await addMedicine(page, 0, "Synthetic E2E medication one");
  await addMedicine(page, 1, "Synthetic E2E medication two");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved.");
  await page.goto(`/registration/${visit.id}`);
  await page
    .getByRole("link", { name: "Continue Consultation", exact: true })
    .click();
  await expect(
    page.getByLabel("Diagnosis / provisional diagnosis"),
  ).toHaveValue("Synthetic E2E diagnosis");
  await expect(page.locator("#medicine-1-medicineGenericName")).toHaveValue(
    "Synthetic E2E medication two",
  );
  await page.screenshot({
    path: testInfo.outputPath("workspace-desktop.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Review prescription", exact: true })
    .click();
  await expect(
    page.getByText("DRAFT — NOT VALID AS ISSUED PRESCRIPTION"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Issue prescription", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm and issue", exact: true })
    .click();
  await expect(page).toHaveURL(/\/prescriptions\/[^/]+$/);
  const originalId = page.url().split("/").at(-1)!;
  await expect(page.getByRole("heading", { name: /^RX-/ })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save draft", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("link", { name: "Print prescription", exact: true })
    .click();
  await expect(page.locator("nav")).toHaveCount(0);
  await expect(page.locator(".rx-document")).toContainText("TEST-RMP-10001");
  await expect(page.locator(".rx-document")).toContainText(
    "Synthetic E2E medication two",
  );
  await page.screenshot({
    path: testInfo.outputPath("prescription-print.png"),
    fullPage: true,
  });
  await page.evaluate(() => {
    window.print = () => {
      document.documentElement.dataset.printInvoked = "yes";
    };
  });
  await page
    .getByRole("button", { name: "Print prescription", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-print-invoked",
    "yes",
  );
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".rx-print-controls")).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  await page.goto(`/registration/${visit.id}`);
  await expect(
    page.getByRole("heading", { name: "Patient prescription history" }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "View Prescription", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create corrected version", exact: true })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/registration/${visit.id}/consultation`),
  );
  await page
    .getByLabel("Diagnosis / provisional diagnosis")
    .fill("Synthetic E2E corrected diagnosis");
  await page
    .getByRole("button", { name: "Review prescription", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Issue prescription", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm and issue", exact: true })
    .click();
  await expect(page).toHaveURL(/\/prescriptions\/[^/]+$/);
  await expect(page.locator(".rx-document")).toContainText(
    "Synthetic E2E corrected diagnosis",
  );
  await page.goto(`/prescriptions/${originalId}`);
  await expect(page.locator(".rx-document")).toContainText("SUPERSEDED");
  await expect(page.locator(".rx-document")).toContainText(
    "Synthetic E2E diagnosis",
  );
  await expect(page.locator(".rx-document")).not.toContainText(
    "Synthetic E2E corrected diagnosis",
  );
});
test("clinical APIs refuse impersonation, tenant guessing, payload ownership and unofficial draft print", async ({
  page,
}) => {
  const visit = await f.visit();
  await signIn(page, f.doctorUser.email);
  const saved = await page.request.post(
    `/api/registrations/${visit.id}/consultation`,
    { data: { consultation: {}, medications: [], expectedRevision: 0 } },
  );
  expect(saved.status()).toBe(200);
  const draft = (await saved.json()).data as { id: string; revision: number };
  expect(
    (
      await page.request.post(`/api/prescriptions/${draft.id}/issue`, {
        data: { expectedRevision: draft.revision, doctorId: f.doctor.id },
      })
    ).status(),
  ).toBe(400);
  expect(
    (await page.request.get(`/prescriptions/${draft.id}/print`)).status(),
  ).toBe(404);
  await signIn(page, f.admin.email);
  expect(
    (
      await page.request.post(`/api/prescriptions/${draft.id}/issue`, {
        data: { expectedRevision: draft.revision },
      })
    ).status(),
  ).toBe(403);
  await signIn(page, f.receptionist.email);
  expect(
    (await page.request.get(`/api/prescriptions/${draft.id}`)).status(),
  ).toBe(404);
  expect(
    (await page.request.get(`/prescriptions/${draft.id}/print`)).status(),
  ).toBe(404);
  await signIn(page, f.foreign.email);
  expect(
    (await page.request.get(`/api/prescriptions/${draft.id}`)).status(),
  ).toBe(404);
  expect(
    (await page.request.get(`/prescriptions/${draft.id}/print`)).status(),
  ).toBe(404);
});
test("workspace remains usable on mobile without losing draft validation input", async ({
  page,
}, testInfo) => {
  const visit = await f.visit();
  await signIn(page, f.doctorUser.email);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/registration/${visit.id}/consultation`);
  await page
    .getByLabel("Chief complaint / symptoms")
    .fill("Retained unfinished complaint");
  await page
    .getByRole("button", { name: "Review prescription", exact: true })
    .click();
  await expect(page.getByLabel("Chief complaint / symptoms")).toHaveValue(
    "Retained unfinished complaint",
  );
  await expect(page.getByRole("status")).toContainText("diagnosis");
  const fits = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  expect(fits).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("workspace-mobile.png"),
    fullPage: true,
  });
});

test("Doctor credentials edit and cancellation confirmation use the established authorized UI", async ({
  page,
}) => {
  await signIn(page, f.admin.email);
  await page.goto(`/doctors/${f.doctor.id}`);
  await page.getByRole("button", { name: "Edit doctor", exact: true }).click();
  await page
    .getByLabel("Qualification", { exact: true })
    .fill("Synthetic updated qualification");
  await page
    .getByLabel("Medical registration number", { exact: true })
    .fill("SYNTHETIC-UPDATED-REG");
  await page
    .getByLabel("Registration council / state", { exact: true })
    .fill("Synthetic updated council");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByText("SYNTHETIC-UPDATED-REG", { exact: true }),
  ).toBeVisible();
  await signIn(page, f.doctorUser.email);
  const visit = await f.visit();
  const response = await page.request.post(
    `/api/registrations/${visit.id}/consultation`,
    {
      data: {
        consultation: { diagnosis: "Synthetic cancellation test diagnosis" },
        medications: [
          {
            medicineGenericName: "Synthetic cancellation test medicine",
            dosageForm: "Tablet",
            dose: "1 tablet",
            route: "Oral",
            frequency: "Once daily",
            durationValue: 1,
            durationUnit: "days",
          },
        ],
        expectedRevision: 0,
      },
    },
  );
  expect(response.status()).toBe(200);
  const draft = (await response.json()).data as {
    id: string;
    revision: number;
  };
  expect(
    (
      await page.request.post(`/api/prescriptions/${draft.id}/issue`, {
        data: { expectedRevision: draft.revision },
      })
    ).status(),
  ).toBe(200);
  const original = (
    await page.request.get(`/api/prescriptions/${draft.id}`)
  ).json();
  await signIn(page, f.admin.email);
  await page.goto(`/prescriptions/${draft.id}`);
  await page
    .getByRole("button", { name: "Cancel prescription", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Cancel prescription",
    exact: true,
  });
  await expect(
    dialog.getByRole("button", { name: "Confirm cancellation", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByLabel("Cancellation reason")
    .fill("Synthetic cancellation UI reason");
  await dialog
    .getByRole("button", { name: "Confirm cancellation", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".rx-document")).toContainText("CANCELLED");
  const cancelled = await (
    await page.request.get(`/api/prescriptions/${draft.id}`)
  ).json();
  expect(cancelled.data.snapshot).toEqual((await original).data.snapshot);
  expect(cancelled.data.cancellationReason).toBe(
    "Synthetic cancellation UI reason",
  );
});
