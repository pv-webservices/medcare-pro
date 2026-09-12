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

test.describe("Electronic Prescription — Viewports, Form Interactivity & Regressions", () => {
  test("mobile viewport (390x844): no horizontal overflow, complete interactive consultation and issuance", async ({
    page,
  }, testInfo) => {
    const visit = await f.visit();
    await signIn(page, f.doctorUser.email);

    // Set mobile viewport (iPhone 12/13/14 size)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/registration/${visit.id}/consultation`);

    // Verify header and auto-populated elements are visible
    await expect(page.getByRole("heading", { name: f.patient.name })).toBeVisible();

    // Verify no horizontal overflow on mobile
    let fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(fits).toBe(true);

    // Fill clinical details on mobile
    await page.getByLabel("Chief complaint / symptoms").fill("Mobile test fever and cough");
    await page.getByLabel("Diagnosis / provisional diagnosis").fill("Mobile test Viral Upper Respiratory Infection");

    // Add medication
    await page.getByRole("button", { name: "+ Add medicine", exact: true }).click();
    await page.locator("#medicine-0-medicineGenericName").fill("Mobile Paracetamol");
    await page.locator("#medicine-0-dosageForm").fill("Tablet");
    await page.locator("#medicine-0-strength").fill("500 mg");
    await page.locator("#medicine-0-dose").fill("1 tab");
    await page.locator("#medicine-0-route").fill("Oral");
    await page.locator("#medicine-0-frequency").fill("Twice daily");
    await page.locator("#medicine-0-timing").fill("After food");
    await page.locator("#medicine-0-duration").fill("3");
    await page.locator("#medicine-0-durationUnit").fill("days");

    // Verify still fits horizontally with medicine form
    fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(fits).toBe(true);

    // Save draft
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Draft saved.");

    await page.screenshot({
      path: testInfo.outputPath("consultation-mobile.png"),
      fullPage: true,
    });

    // Review prescription
    await page.getByRole("button", { name: "Review prescription", exact: true }).click();
    await expect(page.getByText("DRAFT — NOT VALID AS ISSUED PRESCRIPTION")).toBeVisible();

    // Verify table doesn't cause page-level horizontal overflow
    fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(fits).toBe(true);

    // Issue prescription on mobile
    await page.getByRole("button", { name: "Issue prescription", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "Confirm clinical issuance" });
    await expect(modal).toBeVisible();
    await modal.getByRole("button", { name: "Confirm and issue", exact: true }).click();

    // Successfully navigates to issued prescription on mobile
    await expect(page).toHaveURL(/\/prescriptions\/[^/]+$/);
    await expect(page.getByRole("heading", { name: /^RX-/ })).toBeVisible();

    fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(fits).toBe(true);
  });

  test("tablet and standard desktop viewports (768, 1366, 1440, 1920) render cleanly without overflow", async ({
    page,
  }) => {
    const visit = await f.visit();
    await signIn(page, f.doctorUser.email);

    const viewports = [
      { width: 768, height: 1024 },  // iPad portrait
      { width: 1366, height: 768 },  // Common laptop
      { width: 1440, height: 900 },  // Standard desktop
      { width: 1920, height: 1080 }, // Full HD
    ];

    for (const vp of viewports) {
      await page.setViewportSize(vp);
      await page.goto(`/registration/${visit.id}/consultation`);
      await expect(page.getByRole("heading", { name: f.patient.name })).toBeVisible();

      const fits = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      );
      expect(fits).toBe(true);
    }
  });

  test("form interactivity: unsaved changes (beforeunload) tracking and failed-save input retention", async ({
    page,
  }) => {
    const visit = await f.visit();
    await signIn(page, f.doctorUser.email);
    await page.goto(`/registration/${visit.id}/consultation`);

    // 1. Test beforeunload listener is active when dirty
    await page.getByLabel("Chief complaint / symptoms").fill("Unsaved changes testing");
    const isDirtyPrevented = await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(isDirtyPrevented).toBe(true);

    // Save draft and verify dirty state clears
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Draft saved.");
    const isCleanPrevented = await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(isCleanPrevented).toBe(false);

    // 2. Test failed-save input retention
    await page.getByLabel("History of present illness").fill("Detailed present illness notes");
    await page.getByLabel("Past medical / relevant history").fill("Detailed past medical history");

    // Click "Review prescription" without diagnosis or medications
    // This triggers validation error
    await page.getByRole("button", { name: "Review prescription", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("diagnosis");

    // Verify previously typed values are strictly retained
    await expect(page.getByLabel("Chief complaint / symptoms")).toHaveValue("Unsaved changes testing");
    await expect(page.getByLabel("History of present illness")).toHaveValue("Detailed present illness notes");
    await expect(page.getByLabel("Past medical / relevant history")).toHaveValue("Detailed past medical history");
  });

  test("walk-in registration to consultation to issuance regression flow", async ({
    page,
  }) => {
    // 1. Create a walk-in patient and visit in DB (as would happen via registration desk)
    const walkInPatient = await db.patient.create({
      data: {
        tenantId: f.tenant.id,
        clinicId: f.clinic.id,
        patientCode: `PT-WALKIN-${Date.now()}`,
        name: "Walk-in Registered Patient",
        age: 38,
        gender: "Female",
        mobileNumber: "9876543210",
      },
    });

    const walkInVisit = await db.registration.create({
      data: {
        clinicId: f.clinic.id,
        patientId: walkInPatient.id,
        doctorId: f.doctor.id,
        department: f.doctor.department,
        amount: 200,
        visitDate: new Date(),
        createdBy: f.admin.id,
      },
    });

    // 2. Doctor opens Registration detail page
    await signIn(page, f.doctorUser.email);
    await page.goto(`/registration/${walkInVisit.id}`);

    // Verify "Start Consultation" link exists and click it
    const startLink = page.getByRole("link", { name: "Start Consultation", exact: true });
    await expect(startLink).toBeVisible();
    await startLink.click();

    await expect(page).toHaveURL(`/registration/${walkInVisit.id}/consultation`);
    await expect(page.getByRole("heading", { name: "Walk-in Registered Patient" })).toBeVisible();

    // Fill and issue
    await page.getByLabel("Diagnosis / provisional diagnosis").fill("Walk-in acute gastroenteritis");
    await page.getByRole("button", { name: "+ Add medicine", exact: true }).click();
    await page.locator("#medicine-0-medicineGenericName").fill("Oral Rehydration Salts");
    await page.locator("#medicine-0-dosageForm").fill("Powder");
    await page.locator("#medicine-0-dose").fill("1 sachet in 1 liter water");
    await page.locator("#medicine-0-route").fill("Oral");
    await page.locator("#medicine-0-frequency").fill("As needed");
    await page.locator("#medicine-0-duration").fill("2");
    await page.locator("#medicine-0-durationUnit").fill("days");

    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Draft saved.");

    await page.getByRole("button", { name: "Review prescription", exact: true }).click();
    await page.getByRole("button", { name: "Issue prescription", exact: true }).click();
    await page.getByRole("button", { name: "Confirm and issue", exact: true }).click();

    await expect(page).toHaveURL(/\/prescriptions\/[^/]+$/);

    // Return to Registration detail page and verify "View Prescription" and history table
    await page.goto(`/registration/${walkInVisit.id}`);
    await expect(page.getByRole("link", { name: "View Prescription", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Patient prescription history" })).toBeVisible();
    await expect(page.getByRole("table")).toContainText("Walk-in Registered Patient");
    await expect(page.getByRole("table")).toContainText("ISSUED");
  });
});
