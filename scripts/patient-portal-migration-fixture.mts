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
    const f = await createPrescriptionFixture(prisma, {
      legacyTenantSchema: true,
    });
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
    const accountId = `legacy-account-${f.patient.id}`,
      revokedId = `legacy-revoked-${f.patient.id}`;
    const linkId = `legacy-link-${f.patient.id}`,
      activationId = `legacy-activation-${f.patient.id}`;
    await prisma.$executeRaw`INSERT INTO patient_portal_accounts (id,mobile_e164,status,verified_at,updated_at) VALUES (${accountId}, '+919999999991','ACTIVE',NOW(3),NOW(3)), (${revokedId}, '+919999999992','DISABLED',NOW(3),NOW(3))`;
    await prisma.$executeRaw`INSERT INTO patient_portal_links (id,portal_account_id,patient_id,tenant_id,active_patient_id,active_account_id,verified_at,identity_verified_at,updated_at) VALUES (${linkId},${accountId},${f.patient.id},${f.tenant.id},${f.patient.id},${accountId},NOW(3),NOW(3),NOW(3))`;
    await prisma.$executeRaw`INSERT INTO patient_portal_links (id,portal_account_id,patient_id,tenant_id,verified_at,identity_verified_at,revoked_at,updated_at) VALUES (${`revoked-link-${f.patient.id}`},${revokedId},${f.patientB.id},${f.tenant.id},NOW(3),NOW(3),NOW(3),NOW(3))`;
    await prisma.$executeRaw`INSERT INTO patient_portal_sessions (id,portal_account_id,link_id,token_hash,expires_at) VALUES (${`legacy-session-${f.patient.id}`},${accountId},${linkId},${"a".repeat(64)},DATE_ADD(NOW(3),INTERVAL 12 HOUR))`;
    await prisma.$executeRaw`INSERT INTO patient_portal_activations (id,patient_id,tenant_id,active_patient_id,mobile_e164,token_hash,expires_at,identity_verified_at) VALUES (${activationId},${f.patientB.id},${f.tenant.id},${f.patientB.id},'+919999999992',${"b".repeat(64)},DATE_ADD(NOW(3),INTERVAL 24 HOUR),NOW(3))`;
    await prisma.$executeRaw`INSERT INTO patient_portal_challenges (id,activation_id,mobile_e164,purpose,code_digest,expires_at) VALUES (${`legacy-challenge-${f.patient.id}`},${activationId},'+919999999992','ACTIVATION',${"c".repeat(64)},DATE_ADD(NOW(3),INTERVAL 10 MINUTE))`;
    await prisma.$executeRaw`INSERT INTO patient_portal_audit_events (id,portal_account_id,tenant_id,event) VALUES (${`legacy-audit-${f.patient.id}`},${accountId},${f.tenant.id},'PORTAL_ACTIVATED')`;
    const legacy = {
      accounts:
        await prisma.$queryRaw`SELECT * FROM patient_portal_accounts ORDER BY id`,
      links:
        await prisma.$queryRaw`SELECT * FROM patient_portal_links ORDER BY id`,
      sessions:
        await prisma.$queryRaw`SELECT * FROM patient_portal_sessions ORDER BY id`,
      activations:
        await prisma.$queryRaw`SELECT * FROM patient_portal_activations ORDER BY id`,
      challenges:
        await prisma.$queryRaw`SELECT * FROM patient_portal_challenges ORDER BY id`,
      audits:
        await prisma.$queryRaw`SELECT * FROM patient_portal_audit_events ORDER BY id`,
    };
    writeFileSync(
      path,
      JSON.stringify({
        legacy,
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
  const after = {
    accounts:
      await prisma.$queryRaw`SELECT id,mobile_e164,status,verified_at,last_login_at,created_at,updated_at FROM patient_portal_accounts ORDER BY id`,
    links:
      await prisma.$queryRaw`SELECT * FROM patient_portal_links ORDER BY id`,
    sessions:
      await prisma.$queryRaw`SELECT * FROM patient_portal_sessions ORDER BY id`,
    activations:
      await prisma.$queryRaw`SELECT id,patient_id,tenant_id,active_patient_id,mobile_e164,token_hash,expires_at,consumed_at,revoked_at,created_by_user_id,identity_verified_at,created_at FROM patient_portal_activations ORDER BY id`,
    challenges:
      await prisma.$queryRaw`SELECT * FROM patient_portal_challenges ORDER BY id`,
    audits:
      await prisma.$queryRaw`SELECT * FROM patient_portal_audit_events ORDER BY id`,
  };
  assert.deepEqual(JSON.parse(JSON.stringify(after)), before.legacy);
  assert.equal(
    await prisma.patientPortalAccount.count({
      where: { passwordHash: { not: null } },
    }),
    0,
  );
  assert.equal(
    await prisma.patientPortalAccount.count({
      where: { recoveryEmail: { not: null } },
    }),
    0,
  );
  assert.equal(
    await prisma.patientPortalActivation.count({
      where: { purpose: "LEGACY_SMS", revokedAt: null },
    }),
    1,
  );
  assert.equal(await prisma.patientPortalSecurityToken.count(), 0);
}
main()
  .catch(() => {
    console.error(
      "Disposable clinical preservation check failed; payload withheld.",
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
