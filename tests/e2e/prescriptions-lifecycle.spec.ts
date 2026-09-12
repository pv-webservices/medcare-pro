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

test.describe("Electronic Prescription — Lifecycle & Integrity", () => {
  test("issued prescription is immutable in UI and API rejects further mutations", async ({
    page,
  }) => {
    const visit = await f.visit();
    await signIn(page, f.doctorUser.email);

    // Create and issue prescription via API
    const saveRes = await page.request.post(
      `/api/registrations/${visit.id}/consultation`,
      {
        data: {
          consultation: { diagnosis: "Immutable test diagnosis" },
          medications: [
            {
              medicineGenericName: "Immutable Test Medicine",
              dosageForm: "Tablet",
              dose: "1 tablet",
              route: "Oral",
              frequency: "Once daily",
              durationValue: 3,
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

    // Verify UI view of issued prescription has no draft editing controls
    await page.goto(`/prescriptions/${draft.id}`);
    await expect(page.getByRole("heading", { name: /^RX-/ })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save draft", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Review prescription", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Issue prescription", exact: true }),
    ).toHaveCount(0);

    // Direct API attempt to re-save draft on issued consultation must be rejected
    const mutateRes = await page.request.post(
      `/api/registrations/${visit.id}/consultation`,
      {
        data: {
          consultation: { diagnosis: "Attempted illegal modification" },
          medications: [],
          expectedRevision: draft.revision,
        },
      },
    );
    expect(mutateRes.status()).toBe(409);

    // Direct API attempt to re-issue already issued prescription must be rejected
    const reissueRes = await page.request.post(
      `/api/prescriptions/${draft.id}/issue`,
      {
        data: { expectedRevision: draft.revision },
      },
    );
    expect(reissueRes.status()).toBe(409);
  });

  test("snapshot integrity: live mutations to doctor, patient, and clinic do NOT alter historical issued prescription", async ({
    page,
  }) => {
    // 1. Create a dedicated doctor, patient, and visit to test snapshot isolation
    const dedicatedPatient = await db.patient.create({
      data: {
        tenantId: f.tenant.id,
        clinicId: f.clinic.id,
        patientCode: `PT-SNAP-${Date.now()}`,
        name: "Historical Patient Name",
        age: 50,
        gender: "Male",
        mobileNumber: "9111111111",
      },
    });
    const visit = await db.registration.create({
      data: {
        clinicId: f.clinic.id,
        patientId: dedicatedPatient.id,
        doctorId: f.doctor.id,
        department: f.doctor.department,
        amount: 100,
        visitDate: new Date(),
        createdBy: f.admin.id,
      },
    });

    await signIn(page, f.doctorUser.email);

    // Save and issue prescription
    const saveRes = await page.request.post(
      `/api/registrations/${visit.id}/consultation`,
      {
        data: {
          consultation: { diagnosis: "Snapshot test original diagnosis" },
          medications: [
            {
              medicineGenericName: "Snapshot Medicine A",
              dosageForm: "Tablet",
              dose: "1 tablet",
              route: "Oral",
              frequency: "Twice daily",
              durationValue: 5,
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

    // 2. Mutate live Patient, Doctor, and Clinic directly in the database
    await db.patient.update({
      where: { id: dedicatedPatient.id },
      data: { name: "MUTATED_PATIENT_SHOULD_NOT_APPEAR" },
    });
    await db.doctor.update({
      where: { id: f.doctor.id },
      data: {
        name: "MUTATED_DOCTOR_SHOULD_NOT_APPEAR",
        medicalRegistrationNumber: "MUTATED-REG-99999",
      },
    });
    await db.clinic.update({
      where: { id: f.clinic.id },
      data: { name: "MUTATED_CLINIC_SHOULD_NOT_APPEAR" },
    });

    try {
      // 3. Open prescription detail page and verify historical snapshot is frozen
      await page.goto(`/prescriptions/${draft.id}`);
      const doc = page.locator(".rx-document");
      await expect(doc).toContainText("Historical Patient Name");
      await expect(doc).toContainText("Dr. Synthetic Original");
      await expect(doc).toContainText("TEST-RMP-10001");
      await expect(doc).toContainText("Prescription Test Clinic");

      await expect(doc).not.toContainText("MUTATED_PATIENT_SHOULD_NOT_APPEAR");
      await expect(doc).not.toContainText("MUTATED_DOCTOR_SHOULD_NOT_APPEAR");
      await expect(doc).not.toContainText("MUTATED-REG-99999");
      await expect(doc).not.toContainText("MUTATED_CLINIC_SHOULD_NOT_APPEAR");

      // 4. Open print view and verify snapshot is also frozen there
      await page.goto(`/prescriptions/${draft.id}/print`);
      const printDoc = page.locator(".rx-document");
      await expect(printDoc).toContainText("Historical Patient Name");
      await expect(printDoc).toContainText("Dr. Synthetic Original");
      await expect(printDoc).toContainText("TEST-RMP-10001");
      await expect(printDoc).toContainText("Prescription Test Clinic");

      await expect(printDoc).not.toContainText(
        "MUTATED_PATIENT_SHOULD_NOT_APPEAR",
      );
      await expect(printDoc).not.toContainText(
        "MUTATED_DOCTOR_SHOULD_NOT_APPEAR",
      );
      await expect(printDoc).not.toContainText("MUTATED-REG-99999");
      await expect(printDoc).not.toContainText(
        "MUTATED_CLINIC_SHOULD_NOT_APPEAR",
      );
    } finally {
      // Restore doctor and clinic records so other tests have original names
      await db.doctor.update({
        where: { id: f.doctor.id },
        data: {
          name: "Dr. Synthetic Original",
          medicalRegistrationNumber: "TEST-RMP-10001",
        },
      });
      await db.clinic.update({
        where: { id: f.clinic.id },
        data: { name: "Prescription Test Clinic" },
      });
    }
  });

  test("correction workflow: creates linked correction draft, issues new version, supersedes original, preserves mutual links and history", async ({
    page,
  }) => {
    const visit = await f.visit();
    await signIn(page, f.doctorUser.email);

    // Create original prescription
    const saveRes = await page.request.post(
      `/api/registrations/${visit.id}/consultation`,
      {
        data: {
          consultation: { diagnosis: "Original uncorrected diagnosis" },
          medications: [
            {
              medicineGenericName: "Original Medicine 1",
              dosageForm: "Tablet",
              dose: "1 tablet",
              route: "Oral",
              frequency: "Once daily",
              durationValue: 3,
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

    // Navigate to issued prescription
    await page.goto(`/prescriptions/${originalRx.id}`);
    await expect(page.locator(".rx-document")).toContainText(
      "Original uncorrected diagnosis",
    );

    // Click "Create corrected version"
    await page
      .getByRole("button", { name: "Create corrected version", exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/registration/${visit.id}/consultation`),
    );

    // Assert that original Rx remains ISSUED while the correction draft is in progress
    const originalInDbWhileDrafting = await db.prescription.findUniqueOrThrow({
      where: { id: originalRx.id },
    });
    expect(originalInDbWhileDrafting.status).toBe("ISSUED");

    // Modify diagnosis in correction draft
    await page
      .getByLabel("Diagnosis / provisional diagnosis")
      .fill("Amended corrected diagnosis");
    await page
      .getByRole("button", { name: "Review prescription", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Issue prescription", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirm and issue", exact: true })
      .click();

    // Reaches new issued prescription page
    await expect(page).toHaveURL(/\/prescriptions\/[^/]+$/);
    const correctedRxId = page.url().split("/").at(-1)!;
    expect(correctedRxId).not.toBe(originalRx.id);

    // Verify UI on corrected prescription
    await expect(page.locator(".rx-document")).toContainText(
      "Amended corrected diagnosis",
    );
    await expect(page.getByText("Corrected version of")).toBeVisible();

    // Verify DB state: original is now SUPERSEDED, new is ISSUED, mutual linkage exists
    const originalInDb = await db.prescription.findUniqueOrThrow({
      where: { id: originalRx.id },
      include: { supersededBy: true },
    });
    const correctedInDb = await db.prescription.findUniqueOrThrow({
      where: { id: correctedRxId },
    });

    expect(originalInDb.status).toBe("SUPERSEDED");
    expect(originalInDb.supersededBy?.id).toBe(correctedRxId);
    expect(correctedInDb.status).toBe("ISSUED");
    expect(correctedInDb.supersedesPrescriptionId).toBe(originalRx.id);
    expect(correctedInDb.version).toBe(2);

    // Navigate to original prescription page
    await page.goto(`/prescriptions/${originalRx.id}`);
    await expect(page.locator(".rx-document")).toContainText("SUPERSEDED");
    await expect(page.locator(".rx-document")).toContainText(
      "Original uncorrected diagnosis",
    );
    await expect(page.getByText("Superseded by:")).toBeVisible();

    // Click link to corrected version from original page
    await page.getByRole("link", { name: correctedInDb.prescriptionNumber! }).click();
    await expect(page).toHaveURL(`/prescriptions/${correctedRxId}`);
  });

  test("cancellation: modal requires reason, updates status to CANCELLED, preserves snapshot and audit fields", async ({
    page,
  }) => {
    const visit = await f.visit();
    await signIn(page, f.doctorUser.email);

    // Create and issue prescription
    const saveRes = await page.request.post(
      `/api/registrations/${visit.id}/consultation`,
      {
        data: {
          consultation: { diagnosis: "Diagnosis for cancellation test" },
          medications: [
            {
              medicineGenericName: "Cancellation Test Medicine",
              dosageForm: "Tablet",
              dose: "1 tablet",
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

    // Sign in as admin (who has prescription:cancel permission)
    await signIn(page, f.admin.email);
    await page.goto(`/prescriptions/${draft.id}`);
    await page
      .getByRole("button", { name: "Cancel prescription", exact: true })
      .click();

    const dialog = page.getByRole("dialog", { name: "Cancel prescription" });
    await expect(dialog).toBeVisible();

    // Confirm button is disabled when reason is empty or whitespace
    const confirmBtn = dialog.getByRole("button", {
      name: "Confirm cancellation",
      exact: true,
    });
    await expect(confirmBtn).toBeDisabled();

    await dialog.getByLabel("Cancellation reason").fill("   ");
    await expect(confirmBtn).toBeDisabled();

    // Enter valid cancellation reason
    const cancellationReason =
      "Prescription cancelled due to patient drug allergy reported post-consultation.";
    await dialog.getByLabel("Cancellation reason").fill(cancellationReason);
    await expect(confirmBtn).toBeEnabled();

    // Confirm cancellation
    await confirmBtn.click();
    await expect(dialog).toHaveCount(0);

    // Assert UI shows CANCELLED status and cancellation reason
    await expect(page.locator(".rx-document")).toContainText("CANCELLED");
    await expect(page.getByText(cancellationReason)).toBeVisible();

    // Assert database retains row, snapshot, items, cancellationReason, cancelledAt, cancelledById
    const cancelledDb = await db.prescription.findUniqueOrThrow({
      where: { id: draft.id },
      include: { items: true },
    });
    expect(cancelledDb.status).toBe("CANCELLED");
    expect(cancelledDb.cancellationReason).toBe(cancellationReason);
    expect(cancelledDb.cancelledAt).not.toBeNull();
    expect(cancelledDb.cancelledById).toBe(f.admin.id);
    expect(cancelledDb.snapshotJson).not.toBeNull();
    expect(cancelledDb.items.length).toBe(1);

    // Cancelled prescription print page renders with CANCELLED watermark/badge
    await page.goto(`/prescriptions/${draft.id}/print`);
    await expect(page.locator(".rx-document")).toContainText("CANCELLED");
    await expect(page.locator(".rx-document")).toContainText(
      "Diagnosis for cancellation test",
    );
  });

  test("double-issuance concurrency: simultaneous issue requests result in exactly one success, one conflict, and one DB prescription", async ({
    page,
  }) => {
    const visit = await f.visit();
    await signIn(page, f.doctorUser.email);

    // Create consultation draft
    const saveRes = await page.request.post(
      `/api/registrations/${visit.id}/consultation`,
      {
        data: {
          consultation: { diagnosis: "Concurrency test diagnosis" },
          medications: [
            {
              medicineGenericName: "Concurrency Medicine",
              dosageForm: "Tablet",
              dose: "1 tab",
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
    expect(saveRes.status()).toBe(200);
    const draft = (await saveRes.json()).data as {
      id: string;
      revision: number;
    };

    // Fire two simultaneous issue requests with the exact same expectedRevision
    const [res1, res2] = await Promise.all([
      page.request.post(`/api/prescriptions/${draft.id}/issue`, {
        data: { expectedRevision: draft.revision },
      }),
      page.request.post(`/api/prescriptions/${draft.id}/issue`, {
        data: { expectedRevision: draft.revision },
      }),
    ]);

    const statuses = [res1.status(), res2.status()].sort();
    expect(statuses).toEqual([200, 409]);

    // Verify in database: exactly 1 prescription with status ISSUED exists for this registration
    const issuedList = await db.prescription.findMany({
      where: { registrationId: visit.id, status: "ISSUED" },
    });
    expect(issuedList.length).toBe(1);
    expect(issuedList[0].id).toBe(draft.id);
  });

  test("stale draft revision conflict: saving with an outdated revision returns 409 conflict and prevents data loss", async ({
    page,
  }) => {
    const visit = await f.visit();
    await signIn(page, f.doctorUser.email);

    // Initial save (Revision 0 -> 1)
    const initialRes = await page.request.post(
      `/api/registrations/${visit.id}/consultation`,
      {
        data: {
          consultation: { diagnosis: "Revision 1 diagnosis" },
          medications: [
            {
              medicineGenericName: "Medicine Rev 1",
              dosageForm: "Tablet",
              dose: "1 tab",
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
    expect(initialRes.status()).toBe(200);
    const initialDraft = (await initialRes.json()).data as {
      id: string;
      revision: number;
    };
    expect(initialDraft.revision).toBe(1);

    // User A updates draft (Revision 1 -> 2)
    const updateRes = await page.request.post(
      `/api/registrations/${visit.id}/consultation`,
      {
        data: {
          consultation: { diagnosis: "Revision 2 diagnosis updated by User A" },
          medications: [
            {
              medicineGenericName: "Medicine Rev 2",
              dosageForm: "Tablet",
              dose: "1 tab",
              route: "Oral",
              frequency: "Once daily",
              durationValue: 2,
              durationUnit: "days",
            },
          ],
          expectedRevision: 1,
        },
      },
    );
    expect(updateRes.status()).toBe(200);
    const updatedDraft = (await updateRes.json()).data as { revision: number };
    expect(updatedDraft.revision).toBe(2);

    // User B attempts to save with stale expectedRevision: 1
    const staleRes = await page.request.post(
      `/api/registrations/${visit.id}/consultation`,
      {
        data: {
          consultation: { diagnosis: "Stale overwrite attempt by User B" },
          medications: [],
          expectedRevision: 1,
        },
      },
    );
    expect(staleRes.status()).toBe(409);

    // Verify DB still contains Revision 2 content (no data loss or overwrite)
    const currentDraftInDb = await db.prescription.findUniqueOrThrow({
      where: { id: initialDraft.id },
      include: { consultation: true, items: true },
    });
    expect(currentDraftInDb.revision).toBe(2);
    expect(currentDraftInDb.consultation?.diagnosis).toBe(
      "Revision 2 diagnosis updated by User A",
    );
    expect(currentDraftInDb.items[0].medicineGenericName).toBe("Medicine Rev 2");
  });
});
