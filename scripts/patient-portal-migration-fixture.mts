/** Private migration subprocess: URL is fixed before Prisma construction. */
import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import { createPrescriptionFixture } from "./prescription-test-fixture";
import { assertPatientPortalTestDatabase } from "./patient-portal-test-fixture";
import { saveConsultationDraft, issuePrescription } from "@/lib/prescriptions";
import {
  consultationSchema,
  medicationSchema,
} from "@/lib/prescriptionValidation";
assertPatientPortalTestDatabase();
const path = process.argv.at(-1)!;
async function main() {
  if (process.argv.includes("--before")) {
    const f = await createPrescriptionFixture(prisma);
    const visit = await f.visit();
    const d = await saveConsultationDraft(f.doctorUser.actor, visit.id, {
      consultation: consultationSchema.parse({
        diagnosis: "Synthetic migration diagnosis",
      }),
      medications: [
        medicationSchema.parse({
          medicineGenericName: "Synthetic migration medicine",
          dosageForm: "Tablet",
          dose: "1",
          route: "Oral",
          frequency: "Daily",
          durationValue: 1,
          durationUnit: "days",
        }),
      ],
      expectedRevision: 0,
    });
    const rx = await issuePrescription(f.doctorUser.actor, d.id, {
      expectedRevision: d.revision,
    });
    writeFileSync(
      path,
      JSON.stringify({
        patient: await prisma.patient.findUniqueOrThrow({
          where: { id: f.patient.id },
        }),
        visit: await prisma.registration.findUniqueOrThrow({
          where: { id: visit.id },
        }),
        rx: await prisma.prescription.findUniqueOrThrow({
          where: { id: rx.id },
        }),
      }),
    );
    return;
  }
  const before = JSON.parse(readFileSync(path, "utf8"));
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        await prisma.patient.findUniqueOrThrow({
          where: { id: before.patient.id },
        }),
      ),
    ),
    before.patient,
  );
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        await prisma.registration.findUniqueOrThrow({
          where: { id: before.visit.id },
        }),
      ),
    ),
    before.visit,
  );
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        await prisma.prescription.findUniqueOrThrow({
          where: { id: before.rx.id },
        }),
      ),
    ),
    before.rx,
  );
  assert.equal(await prisma.patientPortalAccount.count(), 0);
  assert.equal(await prisma.patientPortalLink.count(), 0);
}
main()
  .catch(() => {
    console.error(
      "Disposable clinical preservation check failed; payload withheld.",
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
