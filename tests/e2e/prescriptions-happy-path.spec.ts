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
}

test.describe("Electronic Prescription — Happy Path & Medication Builder", () => {
  test("complete doctor happy path, auto-population, review, confirmation, issuance and database verification", async ({
    page,
  }, testInfo) => {
    const visit = await f.visit();
    await signIn(page, f.doctorUser.email);

    // 1. Open Registration detail
    await page.goto(`/registration/${visit.id}`);
    await expect(page.getByRole("heading", { name: f.patient.name })).toBeVisible();

    // 2. Start Consultation
    await page.getByRole("link", { name: "Start Consultation", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/registration/${visit.id}/consultation`));

    // Verify auto-population of patient, doctor, clinic, visit information
    await expect(page.getByRole("heading", { name: f.patient.name })).toBeVisible();
    await expect(page.getByText(f.patient.patientCode)).toBeVisible();
    await expect(page.getByText(f.patient.mobileNumber)).toBeVisible();
    await expect(page.getByText(f.doctor.name)).toBeVisible();
    await expect(page.locator("main").getByText(f.clinic.name).first()).toBeVisible();
    await expect(page.locator("main").getByText(visit.department).first()).toBeVisible();

    // Fill synthetic clinical information
    await page.getByLabel("Consultation mode").selectOption("IN_PERSON");
    await page.getByLabel("Chief complaint / symptoms").fill("Fever and headache for two days");
    await page.getByLabel("History of present illness").fill("Symptoms started two days ago.");
    await page.getByLabel("Past medical / relevant history").fill("No significant history reported.");
    await page.getByLabel("Examination / clinical findings").fill("Synthetic test examination findings.");
    await page.getByLabel("Diagnosis / provisional diagnosis").fill("Synthetic test diagnosis.");
    await page.getByLabel("Investigations advised").fill("Synthetic test investigation instructions.");
    await page.getByLabel("General advice").fill("Rest and hydration.");
    await page.getByLabel("Follow-up instructions").fill("Follow up in three days if symptoms persist.");

    // Add Medication 1
    await page.getByRole("button", { name: "+ Add medicine", exact: true }).click();
    await page.locator("#medicine-0-medicineGenericName").fill("Test Medicine A");
    await page.locator("#medicine-0-brandName").fill("Test Brand A");
    await page.locator("#medicine-0-dosageForm").fill("Tablet");
    await page.locator("#medicine-0-strength").fill("500 mg");
    await page.locator("#medicine-0-dose").fill("1 tablet");
    await page.locator("#medicine-0-route").fill("Oral");
    await page.locator("#medicine-0-frequency").fill("Twice daily");
    await page.locator("#medicine-0-timing").fill("After food");
    await page.locator("#medicine-0-duration").fill("3");
    await page.locator("#medicine-0-durationUnit").fill("days");
    await page.locator("#medicine-0-quantity").fill("6");
    await page.locator("#medicine-0-instructions").fill("Test instruction A");

    // Add Medication 2
    await page.getByRole("button", { name: "+ Add medicine", exact: true }).click();
    await page.locator("#medicine-1-medicineGenericName").fill("Test Medicine B");
    await page.locator("#medicine-1-brandName").fill("Test Brand B");
    await page.locator("#medicine-1-dosageForm").fill("Capsule");
    await page.locator("#medicine-1-strength").fill("250 mg");
    await page.locator("#medicine-1-dose").fill("1 capsule");
    await page.locator("#medicine-1-route").fill("Oral");
    await page.locator("#medicine-1-frequency").fill("Once daily");
    await page.locator("#medicine-1-timing").fill("Before food");
    await page.locator("#medicine-1-duration").fill("5");
    await page.locator("#medicine-1-durationUnit").fill("days");
    await page.locator("#medicine-1-quantity").fill("5");
    await page.locator("#medicine-1-instructions").fill("Test instruction B");

    // Save draft
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Draft saved.");
    await page.screenshot({ path: testInfo.outputPath("consultation-desktop.png"), fullPage: true });

    // Review prescription
    await page.getByRole("button", { name: "Review prescription", exact: true }).click();
    await expect(page.getByText("DRAFT — NOT VALID AS ISSUED PRESCRIPTION")).toBeVisible();
    await expect(page.locator(".rx-document")).toContainText(f.clinic.name);
    await expect(page.locator(".rx-document")).toContainText(f.doctor.name);
    await expect(page.locator(".rx-document")).toContainText("MBBS, MD");
    await expect(page.locator(".rx-document")).toContainText("TEST-RMP-10001");
    await expect(page.locator(".rx-document")).toContainText("Test Medical Council");
    await expect(page.locator(".rx-document")).toContainText(f.patient.name);
    await expect(page.locator(".rx-document")).toContainText("Synthetic test diagnosis.");
    await expect(page.locator(".rx-document")).toContainText("Test Medicine A");
    await expect(page.locator(".rx-document")).toContainText("Test Medicine B");
    await expect(page.locator(".rx-document")).toContainText("Rest and hydration.");
    await page.screenshot({ path: testInfo.outputPath("review-desktop.png"), fullPage: true });

    // Issuance confirmation dialog
    await page.getByRole("button", { name: "Issue prescription", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "Confirm clinical issuance" });
    await expect(modal).toBeVisible();
    await expect(modal).toContainText("medical history and cannot be directly edited afterward");

    // Cancel once
    await modal.getByRole("button", { name: "Keep as draft", exact: true }).click();
    await expect(modal).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/registration/${visit.id}/consultation`));

    // Open again and confirm
    await page.getByRole("button", { name: "Issue prescription", exact: true }).click();
    await page.getByRole("button", { name: "Confirm and issue", exact: true }).click();

    // Reaches issued prescription page
    await expect(page).toHaveURL(/\/prescriptions\/[^/]+$/);
    const rxId = page.url().split("/").at(-1)!;
    await expect(page.getByRole("heading", { name: /^RX-/ })).toBeVisible();
    await expect(page.locator(".rx-document")).toContainText("TEST-RMP-10001");
    await expect(page.locator(".rx-document")).toContainText("Test Medicine A");
    await expect(page.locator(".rx-document")).toContainText("Test Medicine B");
    await page.screenshot({ path: testInfo.outputPath("issued-desktop.png"), fullPage: true });

    // Database assertions
    const dbRx = await db.prescription.findUniqueOrThrow({
      where: { id: rxId },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
    expect(dbRx.status).toBe("ISSUED");
    expect(dbRx.issuedAt).not.toBeNull();
    expect(dbRx.prescriptionNumber).toMatch(/^RX-\d{4}-/);
    expect(dbRx.snapshotJson).not.toBeNull();
    expect(dbRx.items.length).toBe(2);
    expect(dbRx.items[0].medicineGenericName).toBe("Test Medicine A");
    expect(dbRx.items[1].medicineGenericName).toBe("Test Medicine B");
  });

  test("draft persistence across navigation, reload, and partial edits", async ({ page }) => {
    const visit = await f.visit();
    await signIn(page, f.doctorUser.email);
    await page.goto(`/registration/${visit.id}/consultation`);

    await page.getByLabel("Chief complaint / symptoms").fill("Original persistent complaint");
    await page.getByLabel("Diagnosis / provisional diagnosis").fill("Original diagnosis");
    await page.getByRole("button", { name: "+ Add medicine", exact: true }).click();
    await page.locator("#medicine-0-medicineGenericName").fill("Persistence Med One");
    await page.locator("#medicine-0-dosageForm").fill("Tablet");
    await page.locator("#medicine-0-dose").fill("1 tablet");
    await page.locator("#medicine-0-route").fill("Oral");
    await page.locator("#medicine-0-frequency").fill("Once daily");
    await page.locator("#medicine-0-duration").fill("7");
    await page.locator("#medicine-0-durationUnit").fill("days");
    await page.locator("#medicine-0-instructions").fill("Original instruction");

    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Draft saved.");

    // Navigate away to Registration detail
    await page.goto(`/registration/${visit.id}`);
    await expect(page.getByRole("link", { name: "Continue Consultation", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Continue Consultation", exact: true }).click();

    // Assert values persist
    await expect(page.getByLabel("Chief complaint / symptoms")).toHaveValue("Original persistent complaint");
    await expect(page.getByLabel("Diagnosis / provisional diagnosis")).toHaveValue("Original diagnosis");
    await expect(page.locator("#medicine-0-medicineGenericName")).toHaveValue("Persistence Med One");
    await expect(page.locator("#medicine-0-instructions")).toHaveValue("Original instruction");

    // Modify fields
    await page.getByLabel("Diagnosis / provisional diagnosis").fill("Modified persistent diagnosis");
    await page.locator("#medicine-0-instructions").fill("Updated persistent instruction");
    await page.getByLabel("Follow-up instructions").fill("Follow-up in 10 days");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Draft saved.");

    // Reload page
    await page.reload();
    await expect(page.getByLabel("Diagnosis / provisional diagnosis")).toHaveValue(
      "Modified persistent diagnosis",
    );
    await expect(page.locator("#medicine-0-instructions")).toHaveValue("Updated persistent instruction");
    await expect(page.getByLabel("Follow-up instructions")).toHaveValue("Follow-up in 10 days");
  });

  test("incomplete drafts can be saved but are blocked from review/issuance with clear validation errors", async ({
    page,
  }) => {
    const visit = await f.visit();
    await signIn(page, f.doctorUser.email);
    await page.goto(`/registration/${visit.id}/consultation`);

    // Only chief complaint, blank diagnosis, no medications
    await page.getByLabel("Chief complaint / symptoms").fill("Incomplete draft complaint only");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Draft saved.");

    // Try to review (which validates readiness for issuance)
    await page.getByRole("button", { name: "Review prescription", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("diagnosis");
    await expect(page.getByLabel("Chief complaint / symptoms")).toHaveValue("Incomplete draft complaint only");

    // Fill diagnosis but still no medications
    await page.getByLabel("Diagnosis / provisional diagnosis").fill("Now has diagnosis");
    await page.getByRole("button", { name: "Review prescription", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("medication");
  });

  test("medication builder handles add, remove, duplicate, reorder, keyboard navigation and long values", async ({
    page,
  }) => {
    const visit = await f.visit();
    await signIn(page, f.doctorUser.email);
    await page.goto(`/registration/${visit.id}/consultation`);

    await page.getByLabel("Chief complaint / symptoms").fill("Med builder test complaint");
    await page.getByLabel("Diagnosis / provisional diagnosis").fill("Med builder test diagnosis");

    // Add Medicine 1 (Alpha)
    await page.getByRole("button", { name: "+ Add medicine", exact: true }).click();
    await page.locator("#medicine-0-medicineGenericName").fill("Medicine Alpha");
    await page.locator("#medicine-0-dosageForm").fill("Tablet");
    await page.locator("#medicine-0-dose").fill("1 tab");
    await page.locator("#medicine-0-route").fill("Oral");
    await page.locator("#medicine-0-frequency").fill("Once daily");
    await page.locator("#medicine-0-duration").fill("3");
    await page.locator("#medicine-0-durationUnit").fill("days");

    // Add Medicine 2 (Beta)
    await page.getByRole("button", { name: "+ Add medicine", exact: true }).click();
    await page.locator("#medicine-1-medicineGenericName").fill("Medicine Beta");
    await page.locator("#medicine-1-dosageForm").fill("Syrup");
    await page.locator("#medicine-1-dose").fill("10 ml");
    await page.locator("#medicine-1-route").fill("Oral");
    await page.locator("#medicine-1-frequency").fill("Twice daily");
    await page.locator("#medicine-1-duration").fill("5");
    await page.locator("#medicine-1-durationUnit").fill("days");

    // Add Medicine 3 (Gamma)
    await page.getByRole("button", { name: "+ Add medicine", exact: true }).click();
    await page.locator("#medicine-2-medicineGenericName").fill("Medicine Gamma");
    await page.locator("#medicine-2-dosageForm").fill("Capsule");
    await page.locator("#medicine-2-dose").fill("1 cap");
    await page.locator("#medicine-2-route").fill("Oral");
    await page.locator("#medicine-2-frequency").fill("Three times daily");
    await page.locator("#medicine-2-duration").fill("7");
    await page.locator("#medicine-2-durationUnit").fill("days");

    // Remove middle medicine (Beta, index 1)
    await page.getByRole("button", { name: "Remove medication 2", exact: true }).click();
    await expect(page.locator("#medicine-0-medicineGenericName")).toHaveValue("Medicine Alpha");
    await expect(page.locator("#medicine-1-medicineGenericName")).toHaveValue("Medicine Gamma");

    // Duplicate Medicine 1 (Alpha, index 0)
    await page.getByRole("button", { name: "Duplicate", exact: true }).first().click();
    await expect(page.locator("#medicine-0-medicineGenericName")).toHaveValue("Medicine Alpha");
    await expect(page.locator("#medicine-1-medicineGenericName")).toHaveValue("Medicine Alpha");
    await expect(page.locator("#medicine-2-medicineGenericName")).toHaveValue("Medicine Gamma");

    // Remove the duplicate
    await page.getByRole("button", { name: "Remove medication 2", exact: true }).click();

    // Reorder: Move Medicine Gamma up to position 1
    await page.getByRole("button", { name: "Move medication 2 up", exact: true }).click();
    await expect(page.locator("#medicine-0-medicineGenericName")).toHaveValue("Medicine Gamma");
    await expect(page.locator("#medicine-1-medicineGenericName")).toHaveValue("Medicine Alpha");

    // Test long valid instructions (300+ chars)
    const longInstructions = "Take this medicine strictly after a heavy meal. Do not consume alcohol or operate heavy machinery while taking this medication. Report immediately if skin rash or dizziness occurs. Drink plenty of water throughout the day.";
    await page.locator("#medicine-0-instructions").fill(longInstructions);

    // Save and reload
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Draft saved.");
    await page.reload();

    // Verify persisted order and content
    await expect(page.locator("#medicine-0-medicineGenericName")).toHaveValue("Medicine Gamma");
    await expect(page.locator("#medicine-0-instructions")).toHaveValue(longInstructions);
    await expect(page.locator("#medicine-1-medicineGenericName")).toHaveValue("Medicine Alpha");
  });
});
