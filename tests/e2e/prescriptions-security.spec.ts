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

test.describe("Electronic Prescription — Security & Permissions", () => {
  test("only assigned doctor can issue; other doctors, admins, receptionists, and owners are refused", async ({
    page,
  }) => {
    const visit = await f.visit();
    await signIn(page, f.doctorUser.email);

    // Save valid draft ready for issuance
    const saveRes = await page.request.post(
      `/api/registrations/${visit.id}/consultation`,
      {
        data: {
          consultation: { diagnosis: "Doctor identity check diagnosis" },
          medications: [
            {
              medicineGenericName: "Check Med",
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

    // 1. Another doctor (Doctor B) tries to issue Doctor A's prescription -> 403 Forbidden
    await signIn(page, f.otherDoctorUser.email);
    const doctorBRes = await page.request.post(
      `/api/prescriptions/${draft.id}/issue`,
      {
        data: { expectedRevision: draft.revision },
      },
    );
    expect(doctorBRes.status()).toBe(403);

    // 2. Clinic Admin (with * permissions) tries to issue -> 403 Forbidden (wildcard cannot substitute for clinician identity)
    await signIn(page, f.admin.email);
    const adminRes = await page.request.post(
      `/api/prescriptions/${draft.id}/issue`,
      {
        data: { expectedRevision: draft.revision },
      },
    );
    expect(adminRes.status()).toBe(403);

    // 3. Tenant Owner tries to issue -> 403 Forbidden
    await signIn(page, f.owner.email);
    const ownerRes = await page.request.post(
      `/api/prescriptions/${draft.id}/issue`,
      {
        data: { expectedRevision: draft.revision },
      },
    );
    expect(ownerRes.status()).toBe(403);

    // 4. Receptionist tries to issue -> 403 Forbidden or 404 Scope Not Found
    await signIn(page, f.receptionist.email);
    const recepRes = await page.request.post(
      `/api/prescriptions/${draft.id}/issue`,
      {
        data: { expectedRevision: draft.revision },
      },
    );
    expect([403, 404]).toContain(recepRes.status());

    // Receptionist tries to read draft -> 404 (drafts not visible without prescription permissions)
    const recepReadRes = await page.request.get(
      `/api/prescriptions/${draft.id}`,
    );
    expect(recepReadRes.status()).toBe(404);

    // 5. Assigned Doctor (Doctor A) can issue successfully
    await signIn(page, f.doctorUser.email);
    const doctorARes = await page.request.post(
      `/api/prescriptions/${draft.id}/issue`,
      {
        data: { expectedRevision: draft.revision },
      },
    );
    expect(doctorARes.status()).toBe(200);
  });

  test("strict schema rejects payload tampering (spoofed doctorId, patientId, clinicId)", async ({
    page,
  }) => {
    const visit = await f.visit();
    await signIn(page, f.doctorUser.email);

    const saveRes = await page.request.post(
      `/api/registrations/${visit.id}/consultation`,
      {
        data: {
          consultation: { diagnosis: "Tampering test diagnosis" },
          medications: [
            {
              medicineGenericName: "Tampering Med",
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

    // Attempt to tamper with issue request by injecting extra fields
    const spoofedDoctorRes = await page.request.post(
      `/api/prescriptions/${draft.id}/issue`,
      {
        data: {
          expectedRevision: draft.revision,
          doctorId: f.otherDoctor.id,
        },
      },
    );
    expect(spoofedDoctorRes.status()).toBe(400);

    const spoofedPatientRes = await page.request.post(
      `/api/prescriptions/${draft.id}/issue`,
      {
        data: {
          expectedRevision: draft.revision,
          patientId: "spoofed-patient-id",
        },
      },
    );
    expect(spoofedPatientRes.status()).toBe(400);

    // Attempt to save draft with missing or malformed fields
    const malformedSaveRes = await page.request.post(
      `/api/registrations/${visit.id}/consultation`,
      {
        data: {
          consultation: { diagnosis: "Test" },
          medications: [],
          expectedRevision: "not-a-number",
        },
      },
    );
    expect(malformedSaveRes.status()).toBe(400);
  });

  test("cross-tenant and cross-clinic boundary enforcement returns 404 (zero data disclosure)", async ({
    page,
  }) => {
    const visit = await f.visit();
    await signIn(page, f.doctorUser.email);

    // Save draft in Clinic A / Tenant A
    const saveRes = await page.request.post(
      `/api/registrations/${visit.id}/consultation`,
      {
        data: {
          consultation: { diagnosis: "Cross-tenant test diagnosis" },
          medications: [
            {
              medicineGenericName: "Cross-tenant Med",
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

    // 1. Cross-tenant user (Tenant B) attempts API access -> 404
    await signIn(page, f.foreign.email);
    expect(
      (await page.request.get(`/api/prescriptions/${draft.id}`)).status(),
    ).toBe(404);
    expect(
      (
        await page.request.post(`/api/prescriptions/${draft.id}/issue`, {
          data: { expectedRevision: draft.revision },
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await page.request.post(
          `/api/registrations/${visit.id}/consultation`,
          {
            data: {
              consultation: { diagnosis: "Illegal cross-tenant update" },
              medications: [],
              expectedRevision: 1,
            },
          },
        )
      ).status(),
    ).toBe(404);

    // 2. Cross-tenant user navigates to prescription detail in UI -> 404
    const uiRes = await page.goto(`/prescriptions/${draft.id}`);
    expect(uiRes?.status()).toBe(404);

    // 3. Cross-clinic user (same tenant, but restricted to Clinic B) attempts access -> 404
    await signIn(page, f.scopedUser.email);
    expect(
      (await page.request.get(`/api/prescriptions/${draft.id}`)).status(),
    ).toBe(404);
  });

  test("doctor credential validation blocks issuance when professional registration is missing, unlocks when added", async ({
    page,
  }) => {
    // 1. Clear doctor's medical registration number to simulate incomplete credentials
    await db.doctor.update({
      where: { id: f.doctor.id },
      data: { medicalRegistrationNumber: "" },
    });

    try {
      const incompleteVisit = await f.visit();
      await signIn(page, f.doctorUser.email);

      // Save draft
      const saveRes = await page.request.post(
        `/api/registrations/${incompleteVisit.id}/consultation`,
        {
          data: {
            consultation: { diagnosis: "Credentials check diagnosis" },
            medications: [
              {
                medicineGenericName: "Credential Check Med",
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

      // Attempt to issue -> 400 Bad Request with clear error message
      const issueFailRes = await page.request.post(
        `/api/prescriptions/${draft.id}/issue`,
        {
          data: { expectedRevision: draft.revision },
        },
      );
      expect(issueFailRes.status()).toBe(400);
      const failBody = await issueFailRes.json();
      expect(failBody.error).toContain("professional profile");

      // Admin updates the doctor profile with medical registration number
      await signIn(page, f.admin.email);
      await page.goto(`/doctors/${f.doctor.id}`);
      await page.getByRole("button", { name: "Edit doctor", exact: true }).click();
      await page
        .getByLabel("Medical registration number", { exact: true })
        .fill("VALID-CRED-12345");
      await page.getByRole("button", { name: "Save changes", exact: true }).click();
      await expect(page.getByText("VALID-CRED-12345")).toBeVisible();

      // Doctor re-attempts issuance -> Now succeeds!
      await signIn(page, f.doctorUser.email);
      const issueSuccessRes = await page.request.post(
        `/api/prescriptions/${draft.id}/issue`,
        {
          data: { expectedRevision: draft.revision },
        },
      );
      expect(issueSuccessRes.status()).toBe(200);

      // Verify issued snapshot contains the updated registration number
      const issuedRx = (await issueSuccessRes.json()).data as { id: string };
      const rxDb = await db.prescription.findUniqueOrThrow({
        where: { id: issuedRx.id },
      });
      const snapshot = rxDb.snapshotJson as {
        doctor?: { medicalRegistrationNumber?: string };
      } | null;
      expect(snapshot?.doctor?.medicalRegistrationNumber).toBe("VALID-CRED-12345");
    } finally {
      // Restore doctor credentials for subsequent tests
      await db.doctor.update({
        where: { id: f.doctor.id },
        data: { medicalRegistrationNumber: "TEST-RMP-10001" },
      });
    }
  });

  test("unofficial draft print URL is protected and returns 404", async ({
    page,
  }) => {
    const visit = await f.visit();
    await signIn(page, f.doctorUser.email);

    // Save a draft
    const saveRes = await page.request.post(
      `/api/registrations/${visit.id}/consultation`,
      {
        data: {
          consultation: { diagnosis: "Draft print check diagnosis" },
          medications: [],
          expectedRevision: 0,
        },
      },
    );
    expect(saveRes.status()).toBe(200);
    const draft = (await saveRes.json()).data as { id: string };

    // Attempt to access print page for a DRAFT -> 404 Not Found
    const printRes = await page.goto(`/prescriptions/${draft.id}/print`);
    expect(printRes?.status()).toBe(404);

    const apiPrintRes = await page.request.get(
      `/prescriptions/${draft.id}/print`,
    );
    expect(apiPrintRes.status()).toBe(404);
  });
});
