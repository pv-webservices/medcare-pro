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

test.describe("Electronic Prescription — Print Layout & Media Formatting", () => {
  test("print layout is isolated from dashboard shell, displays complete frozen metadata, and triggers window.print()", async ({
    page,
  }, testInfo) => {
    const visit = await f.visit();
    await signIn(page, f.doctorUser.email);

    // Save and issue prescription with 2 medications
    const saveRes = await page.request.post(
      `/api/registrations/${visit.id}/consultation`,
      {
        data: {
          consultation: {
            consultationMode: "IN_PERSON",
            chiefComplaint: "Severe throat pain and dry cough",
            diagnosis: "Acute Pharyngitis",
            advice: "Warm saline gargle thrice daily, avoid cold drinks",
            followUpInstructions: "Review after 5 days if fever persists",
          },
          medications: [
            {
              medicineGenericName: "Amoxicillin + Clavulanic Acid",
              brandName: "Augmentin",
              dosageForm: "Tablet",
              strength: "625 mg",
              dose: "1 tablet",
              route: "Oral",
              frequency: "Twice daily",
              timing: "After food",
              durationValue: 5,
              durationUnit: "days",
              quantity: 10,
              instructions: "Complete the full 5-day antibiotic course",
            },
            {
              medicineGenericName: "Paracetamol",
              brandName: "Calpol",
              dosageForm: "Tablet",
              strength: "650 mg",
              dose: "1 tablet",
              route: "Oral",
              frequency: "As needed",
              timing: "After food",
              durationValue: 3,
              durationUnit: "days",
              quantity: 6,
              instructions: "Take only if temperature exceeds 100 F",
            },
          ],
          expectedRevision: 0,
        },
      },
    );
    expect(saveRes.status()).toBe(200);
    const draft = (await saveRes.json()).data as {
      id: string;
      revision: number;
    };

    const issueRes = await page.request.post(
      `/api/prescriptions/${draft.id}/issue`,
      {
        data: { expectedRevision: draft.revision },
      },
    );
    expect(issueRes.status()).toBe(200);

    // Navigate to dedicated print page
    await page.goto(`/prescriptions/${draft.id}/print`);

    // Verify dashboard navigation and sidebar are NOT present
    await expect(page.locator("nav")).toHaveCount(0);
    await expect(page.locator("aside")).toHaveCount(0);

    // Verify print controls are present in screen mode
    const controls = page.locator(".rx-print-controls");
    await expect(controls).toBeVisible();
    await expect(controls.getByRole("button", { name: "Print prescription" })).toBeVisible();

    // Verify Document metadata and headers
    const doc = page.locator(".rx-document");
    await expect(doc).toContainText("Prescription Test Clinic");
    await expect(doc).toContainText(f.doctor.name);
    await expect(doc).toContainText("MBBS, MD");
    await expect(doc).toContainText("TEST-RMP-10001");
    await expect(doc).toContainText("Test Medical Council");
    await expect(doc).toContainText(f.patient.name);
    await expect(doc).toContainText(f.patient.patientCode);
    await expect(doc).toContainText("Acute Pharyngitis");
    await expect(doc).toContainText("Amoxicillin + Clavulanic Acid");
    await expect(doc).toContainText("Augmentin");
    await expect(doc).toContainText("Paracetamol");
    await expect(doc).toContainText("Warm saline gargle");

    // Take screenshot of desktop print layout
    await page.screenshot({
      path: testInfo.outputPath("prescription-print.png"),
      fullPage: true,
    });

    // Emulate window.print() and click button
    await page.evaluate(() => {
      document.documentElement.dataset.printInvoked = "no";
      window.print = () => {
        document.documentElement.dataset.printInvoked = "yes";
      };
    });
    await controls.getByRole("button", { name: "Print prescription" }).click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-print-invoked",
      "yes",
    );

    // Emulate print media query and assert print controls are hidden
    await page.emulateMedia({ media: "print" });
    await expect(page.locator(".rx-print-controls")).toBeHidden();
    await page.emulateMedia({ media: "screen" });
  });

  test("print view handles high-density prescriptions (12+ medications with long instructions) without layout corruption", async ({
    page,
  }, testInfo) => {
    const visit = await f.visit();
    await signIn(page, f.doctorUser.email);

    // Create 12 medications
    const medications = Array.from({ length: 12 }, (_, i) => ({
      medicineGenericName: `Synthetic Generic Medication #${i + 1}`,
      brandName: `Synthetic Brand #${i + 1}`,
      dosageForm: i % 2 === 0 ? "Tablet" : "Capsule",
      strength: `${(i + 1) * 50} mg`,
      dose: "1 unit",
      route: "Oral",
      frequency: "Twice daily",
      timing: "After food",
      durationValue: 7,
      durationUnit: "days",
      quantity: 14,
      instructions: `Specific instruction for medication #${i + 1}: Take strictly with water. Avoid dairy products within 2 hours of administration.`,
    }));

    const saveRes = await page.request.post(
      `/api/registrations/${visit.id}/consultation`,
      {
        data: {
          consultation: {
            consultationMode: "IN_PERSON",
            chiefComplaint: "Multi-morbidity complex management consultation",
            diagnosis: "Hypertension, Type 2 Diabetes, Hyperlipidemia, GERD",
            advice: "Strict adherence to diet and lifestyle modifications. Regular monitoring of BP and blood sugar.",
            followUpInstructions: "Follow up in 2 weeks with repeat lipid profile and FBS.",
          },
          medications,
          expectedRevision: 0,
        },
      },
    );
    expect(saveRes.status()).toBe(200);
    const draft = (await saveRes.json()).data as {
      id: string;
      revision: number;
    };

    const issueRes = await page.request.post(
      `/api/prescriptions/${draft.id}/issue`,
      {
        data: { expectedRevision: draft.revision },
      },
    );
    expect(issueRes.status()).toBe(200);

    // Navigate to print page
    await page.goto(`/prescriptions/${draft.id}/print`);
    const doc = page.locator(".rx-document");

    // Verify all 12 medications are rendered
    for (let i = 1; i <= 12; i++) {
      await expect(doc).toContainText(`Synthetic Generic Medication #${i}`);
    }

    // Verify no horizontal overflow in print shell
    const fits = await page.evaluate(() => {
      const shell = document.querySelector(".rx-print-shell");
      return shell ? shell.scrollWidth <= window.innerWidth : true;
    });
    expect(fits).toBe(true);

    await page.screenshot({
      path: testInfo.outputPath("prescription-print-12meds.png"),
      fullPage: true,
    });
  });

  test("superseded and cancelled prescriptions display prominent historical badges in print view", async ({
    page,
  }) => {
    const visit = await f.visit();
    await signIn(page, f.doctorUser.email);

    // 1. Create and issue original prescription
    const saveRes = await page.request.post(
      `/api/registrations/${visit.id}/consultation`,
      {
        data: {
          consultation: { diagnosis: "Status badge test original" },
          medications: [
            {
              medicineGenericName: "Badge Med",
              dosageForm: "Tablet",
              dose: "1 tab",
              route: "Oral",
              frequency: "Once daily",
              durationValue: 2,
              durationUnit: "days",
            },
          ],
          expectedRevision: 0,
        },
      },
    );
    expect(saveRes.status()).toBe(200);
    const draft = (await saveRes.json()).data as {
      id: string;
      revision: number;
    };

    const issueRes = await page.request.post(
      `/api/prescriptions/${draft.id}/issue`,
      {
        data: { expectedRevision: draft.revision },
      },
    );
    expect(issueRes.status()).toBe(200);
    const originalRx = (await issueRes.json()).data as { id: string };

    // 2. Correct it to create a second version
    const correctRes = await page.request.post(
      `/api/prescriptions/${originalRx.id}/correct`,
      { data: {} },
    );
    expect(correctRes.status()).toBe(200);

    const secondDraftRes = await page.request.get(
      `/api/registrations/${visit.id}/consultation`,
    );
    const secondDraft = (await secondDraftRes.json()).data.prescription as {
      id: string;
      revision: number;
    };

    const issueSecondRes = await page.request.post(
      `/api/prescriptions/${secondDraft.id}/issue`,
      {
        data: { expectedRevision: secondDraft.revision },
      },
    );
    expect(issueSecondRes.status()).toBe(200);
    const secondRx = (await issueSecondRes.json()).data as {
      id: string;
      prescriptionNumber: string;
    };

    // 3. Check original prescription print view: displays SUPERSEDED and version notice
    await page.goto(`/prescriptions/${originalRx.id}/print`);
    await expect(page.locator(".rx-document")).toContainText("SUPERSEDED");
    await expect(page.locator(".rx-version-note")).toContainText("Superseded by");

    // 4. Check second prescription print view: displays Corrected version notice
    await page.goto(`/prescriptions/${secondRx.id}/print`);
    await expect(page.locator(".rx-version-note")).toContainText("Corrected version of");

    // 5. Cancel the second prescription as authorized admin and check its print view
    await signIn(page, f.admin.email);
    const cancelRes = await page.request.post(`/api/prescriptions/${secondRx.id}/cancel`, {
      data: { reason: "Print badge verification cancellation reason" },
    });
    expect(cancelRes.status()).toBe(200);

    await page.goto(`/prescriptions/${secondRx.id}/print`);
    await expect(page.locator(".rx-document")).toContainText("CANCELLED");
  });
});
