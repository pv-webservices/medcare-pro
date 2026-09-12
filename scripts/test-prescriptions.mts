/** Database acceptance checks. Fixtures remain in the disposable database. */
import "dotenv/config";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { PRE_PRESCRIPTION_ROLE_PERMISSIONS } from "@/lib/prescriptionRoleMigration";
import { prisma } from "@/lib/prisma";
import {
  createPrescriptionFixture,
  assertPrescriptionTestDatabase,
} from "./prescription-test-fixture";
import {
  consultationSchema,
  medicationSchema,
} from "@/lib/prescriptionValidation";
import {
  getConsultationForRegistration,
  saveConsultationDraft,
  issuePrescription,
  getPrescriptionForActor,
  createCorrectedPrescription,
  cancelPrescription,
  listPrescriptionsForActor,
  listPatientPrescriptions,
} from "@/lib/prescriptions";
import { ScopeError, PermissionError } from "@/lib/rbac";
import { BadRequestError, ConflictError } from "@/lib/apiHandler";
import { FeatureError } from "@/lib/featureResolution";

assertPrescriptionTestDatabase();
let checks = 0;
function check(label: string, value: unknown) {
  assert.ok(value, label);
  checks++;
  console.log(`PASS ${label}`);
}
async function rejects(
  label: string,
  work: () => Promise<unknown>,
  kind: new (...args: never[]) => Error,
) {
  await assert.rejects(work, kind);
  checks++;
  console.log(`PASS ${label}`);
}
async function main() {
  const f = await createPrescriptionFixture(prisma);
  const visit = await f.visit();
  const blank = {
    consultation: consultationSchema.parse({}),
    medications: [],
    expectedRevision: 0,
  };
  const medication = {
    ...medicationSchema.parse({}),
    medicineGenericName: "Synthetic medicine",
    dosageForm: "Tablet",
    strength: "Example strength",
    dose: "1 tablet",
    route: "Oral",
    frequency: "Twice daily",
    durationValue: 5,
    durationUnit: "days",
    quantity: 10,
    instructions: "Synthetic instructions",
  };
  const content = {
    consultation: {
      ...blank.consultation,
      diagnosis: "Synthetic recorded diagnosis",
      chiefComplaint: "Synthetic complaint",
    },
    medications: [
      medication,
      { ...medication, medicineGenericName: "Second synthetic medicine" },
    ],
    expectedRevision: 0,
  };
  const draft = await saveConsultationDraft(f.preparer.actor, visit.id, blank);
  check(
    "Server derives visit ownership",
    (await prisma.prescription.findUniqueOrThrow({ where: { id: draft.id } }))
      .doctorId === f.doctor.id,
  );
  check(
    "Draft reopens intact",
    (await getConsultationForRegistration(f.doctorUser.actor, visit.id))
      .prescription?.revision === draft.revision,
  );
  await rejects(
    "Front desk cannot read clinical workspace",
    () => getConsultationForRegistration(f.receptionist.actor, visit.id),
    ScopeError,
  );
  await rejects(
    "Foreign tenant guesses remain not found",
    () => getPrescriptionForActor(f.foreign.actor, draft.id),
    ScopeError,
  );
  await rejects(
    "Foreign tenant cannot update draft",
    () => saveConsultationDraft(f.foreign.actor, visit.id, content),
    ScopeError,
  );
  await rejects(
    "Foreign tenant cannot issue draft",
    () =>
      issuePrescription(f.foreign.actor, draft.id, {
        expectedRevision: draft.revision,
      }),
    ScopeError,
  );
  await rejects(
    "Other clinic cannot update draft",
    () => saveConsultationDraft(f.scopedUser.actor, visit.id, content),
    ScopeError,
  );
  await rejects(
    "Other clinic cannot issue draft",
    () =>
      issuePrescription(f.scopedUser.actor, draft.id, {
        expectedRevision: draft.revision,
      }),
    ScopeError,
  );
  await rejects(
    "Other clinic is not found",
    () => getPrescriptionForActor(f.scopedUser.actor, draft.id),
    ScopeError,
  );
  await rejects(
    "Reader cannot edit",
    () =>
      saveConsultationDraft(f.reader.actor, visit.id, {
        ...content,
        expectedRevision: draft.revision,
      }),
    PermissionError,
  );
  await rejects(
    "Preparers cannot issue",
    () =>
      issuePrescription(f.preparer.actor, draft.id, {
        expectedRevision: draft.revision,
      }),
    PermissionError,
  );
  await rejects(
    "Administrative wildcard cannot impersonate Doctor",
    () =>
      issuePrescription(f.admin.actor, draft.id, {
        expectedRevision: draft.revision,
      }),
    PermissionError,
  );
  await rejects(
    "Another linked Doctor cannot issue assigned visit",
    () =>
      issuePrescription(f.otherDoctorUser.actor, draft.id, {
        expectedRevision: draft.revision,
      }),
    PermissionError,
  );
  await rejects(
    "Incomplete content cannot issue",
    () =>
      issuePrescription(f.doctorUser.actor, draft.id, {
        expectedRevision: draft.revision,
      }),
    Error,
  );
  const saved = await saveConsultationDraft(f.doctorUser.actor, visit.id, {
    ...content,
    expectedRevision: draft.revision,
  });
  await rejects(
    "Stale draft cannot overwrite saved work",
    () =>
      saveConsultationDraft(f.doctorUser.actor, visit.id, {
        ...content,
        expectedRevision: draft.revision,
      }),
    ConflictError,
  );
  const simultaneousSaves = await Promise.allSettled([
    saveConsultationDraft(f.doctorUser.actor, visit.id, {
      ...content,
      expectedRevision: saved.revision,
    }),
    saveConsultationDraft(f.doctorUser.actor, visit.id, {
      ...content,
      expectedRevision: saved.revision,
    }),
  ]);
  check(
    "Concurrent saves have exactly one winner",
    simultaneousSaves.filter((r) => r.status === "fulfilled").length === 1,
  );
  const latest = (
    await getConsultationForRegistration(f.doctorUser.actor, visit.id)
  ).prescription!;
  await prisma.doctor.update({
    where: { id: f.doctor.id },
    data: { medicalRegistrationNumber: null },
  });
  await rejects(
    "Legacy missing credentials block only issuance",
    () =>
      issuePrescription(f.doctorUser.actor, draft.id, {
        expectedRevision: latest.revision,
      }),
    BadRequestError,
  );
  await prisma.doctor.update({
    where: { id: f.doctor.id },
    data: { medicalRegistrationNumber: "TEST-RMP-10001" },
  });
  const issueAttempts = await Promise.allSettled([
    issuePrescription(f.doctorUser.actor, draft.id, {
      expectedRevision: latest.revision,
    }),
    issuePrescription(f.doctorUser.actor, draft.id, {
      expectedRevision: latest.revision,
    }),
  ]);
  check(
    "Concurrent issuance has exactly one winner",
    issueAttempts.filter((r) => r.status === "fulfilled").length === 1,
  );
  const original = await getPrescriptionForActor(f.doctorUser.actor, draft.id);
  check(
    "Issued snapshot contains structural medicines",
    original.snapshot?.medications.length === 2 && original.status === "ISSUED",
  );
  await rejects(
    "Issued draft cannot be mutated",
    () =>
      saveConsultationDraft(f.doctorUser.actor, visit.id, {
        ...content,
        expectedRevision: latest.revision,
      }),
    ConflictError,
  );
  await rejects(
    "Issued Rx cannot issue twice",
    () =>
      issuePrescription(f.doctorUser.actor, draft.id, {
        expectedRevision: latest.revision,
      }),
    ConflictError,
  );
  await prisma.patient.update({
    where: { id: f.patient.id },
    data: {
      name: "Synthetic Patient Changed",
      address: "Changed patient address",
    },
  });
  await prisma.clinic.update({
    where: { id: f.clinic.id },
    data: { address: "Changed clinic address" },
  });
  await prisma.doctor.update({
    where: { id: f.doctor.id },
    data: { qualification: "Changed qualification" },
  });
  const historic = await getPrescriptionForActor(f.reader.actor, draft.id);
  check(
    "Profile changes cannot rewrite historical snapshot",
    JSON.stringify(historic.snapshot) === JSON.stringify(original.snapshot),
  );
  const corrections = await Promise.allSettled([
    createCorrectedPrescription(f.doctorUser.actor, draft.id),
    createCorrectedPrescription(f.doctorUser.actor, draft.id),
  ]);
  check(
    "Concurrent correction creates exactly one draft",
    corrections.filter((r) => r.status === "fulfilled").length === 1,
  );
  const corrected = (
    await getConsultationForRegistration(f.doctorUser.actor, visit.id)
  ).prescription!;
  check(
    "Creating correction leaves original issued",
    (await getPrescriptionForActor(f.reader.actor, draft.id)).status ===
      "ISSUED",
  );
  check(
    "Correction starts with original frozen notes",
    corrected.consultation.diagnosis ===
      original.snapshot?.consultation.diagnosis,
  );
  const changed = await saveConsultationDraft(f.doctorUser.actor, visit.id, {
    ...content,
    consultation: {
      ...content.consultation,
      diagnosis: "Synthetic corrected diagnosis",
    },
    medications: [medication],
    expectedRevision: corrected.revision,
  });
  check(
    "Correction cannot edit finalized consultation",
    (
      await prisma.clinicalConsultation.findUniqueOrThrow({
        where: { registrationId: visit.id },
      })
    ).diagnosis === content.consultation.diagnosis,
  );
  await rejects(
    "Pending correction prevents cancellation race",
    () =>
      cancelPrescription(f.canceller.actor, draft.id, {
        reason: "Synthetic cancellation",
      }),
    ConflictError,
  );
  await issuePrescription(f.doctorUser.actor, changed.id, {
    expectedRevision: changed.revision,
  });
  const superseded = await getPrescriptionForActor(f.reader.actor, draft.id);
  check(
    "Correction issuance supersedes original atomically",
    superseded.status === "SUPERSEDED" &&
      superseded.supersededBy?.id === changed.id,
  );
  check(
    "Original snapshot and number remain unchanged",
    JSON.stringify(superseded.snapshot) === JSON.stringify(original.snapshot) &&
      superseded.prescriptionNumber === original.prescriptionNumber,
  );
  const issuedCorrection = await getPrescriptionForActor(
    f.reader.actor,
    changed.id,
  );
  check(
    "Corrected version has unique number and new notes",
    issuedCorrection.version === 2 &&
      issuedCorrection.prescriptionNumber !== original.prescriptionNumber &&
      issuedCorrection.snapshot?.consultation.diagnosis ===
        "Synthetic corrected diagnosis",
  );
  await rejects(
    "Doctor cannot cancel without permission",
    () =>
      cancelPrescription(f.doctorUser.actor, changed.id, {
        reason: "Synthetic cancellation",
      }),
    PermissionError,
  );
  await cancelPrescription(f.canceller.actor, changed.id, {
    reason: "Synthetic cancellation",
  });
  const cancelled = await getPrescriptionForActor(f.reader.actor, changed.id);
  check(
    "Cancellation retains issued snapshot/number and actor",
    cancelled.status === "CANCELLED" &&
      cancelled.prescriptionNumber === issuedCorrection.prescriptionNumber &&
      JSON.stringify(cancelled.snapshot) ===
        JSON.stringify(issuedCorrection.snapshot) &&
      Boolean(cancelled.cancelledAt),
  );
  check(
    "Cancellation records its actor and reason",
    (await prisma.prescription.findUniqueOrThrow({ where: { id: changed.id } }))
      .cancelledById === f.canceller.id &&
      cancelled.cancellationReason === "Synthetic cancellation",
  );
  check(
    "Patient history retains both versions",
    (await listPatientPrescriptions(f.reader.actor, f.patient.id)).total === 2,
  );
  check(
    "Pagination is bounded",
    (await listPrescriptionsForActor(f.reader.actor, { pageSize: 1 })).rows
      .length === 1,
  );
  check(
    "Requested clinic cannot widen scope",
    (
      await listPrescriptionsForActor(f.reader.actor, {
        clinicId: f.otherClinic.id,
      })
    ).total === 0,
  );
  check(
    "Rx number search",
    (
      await listPrescriptionsForActor(f.reader.actor, {
        q: original.prescriptionNumber!,
      })
    ).total === 1,
  );
  check(
    "Patient code search",
    (
      await listPrescriptionsForActor(f.reader.actor, {
        q: f.patient.patientCode,
      })
    ).total === 2,
  );
  check(
    "Doctor filter",
    (await listPrescriptionsForActor(f.reader.actor, { doctorId: f.doctor.id }))
      .total === 2,
  );
  check(
    "Status filter",
    (await listPrescriptionsForActor(f.reader.actor, { status: "CANCELLED" }))
      .total === 1,
  );
  check(
    "Date range excludes issued records outside range",
    (
      await listPrescriptionsForActor(f.reader.actor, {
        from: "2000-01-01",
        to: "2000-01-02",
      })
    ).total === 0,
  );
  const audit = await prisma.auditLog.findMany({
    where: { actorTenantId: f.tenant.id, targetType: "Prescription" },
  });
  check(
    "Clinical lifecycle audits exist",
    [
      "PRESCRIPTION_ISSUED",
      "PRESCRIPTION_SUPERSEDED",
      "PRESCRIPTION_CANCELLED",
      "PRESCRIPTION_CORRECTION_CREATED",
    ].every((action) => audit.some((row) => row.action === action)),
  );
  check(
    "Generic audit excludes clinical notes and medicines",
    audit.every(
      (row) =>
        !JSON.stringify(row.afterValue).includes(
          "Synthetic recorded diagnosis",
        ) && !JSON.stringify(row.afterValue).includes("Synthetic medicine"),
    ),
  );
  await rejects(
    "Registration cannot delete clinical history",
    () => prisma.registration.delete({ where: { id: visit.id } }),
    Error,
  );
  await rejects(
    "Doctor cannot delete clinical history",
    () => prisma.doctor.delete({ where: { id: f.doctor.id } }),
    Error,
  );
  await rejects(
    "Patient cannot delete clinical history",
    () => prisma.patient.delete({ where: { id: f.patient.id } }),
    Error,
  );
  await rejects(
    "Clinic cannot cascade-delete clinical history",
    () => prisma.clinic.delete({ where: { id: f.clinic.id } }),
    Error,
  );
  const noDoctor = await f.visit(null);
  await rejects(
    "Visit without assigned Doctor cannot start consultation",
    () => saveConsultationDraft(f.doctorUser.actor, noDoctor.id, blank),
    BadRequestError,
  );
  const feature = await prisma.feature.findUniqueOrThrow({
    where: { key: "prescriptions" },
  });
  await prisma.roleFeatureAccess.create({
    data: {
      roleId: (
        await prisma.userRole.findFirstOrThrow({
          where: { userId: f.doctorUser.id },
        })
      ).roleId,
      featureId: feature.id,
      enabled: false,
    },
  });
  await rejects(
    "Role entitlement denies clinical reads",
    () => getPrescriptionForActor(f.doctorUser.actor, draft.id),
    FeatureError,
  );
  await rejects(
    "Role entitlement denies draft saves",
    () => saveConsultationDraft(f.doctorUser.actor, noDoctor.id, blank),
    FeatureError,
  );
  await prisma.roleFeatureAccess.deleteMany({
    where: {
      roleId: (
        await prisma.userRole.findFirstOrThrow({
          where: { userId: f.doctorUser.id },
        })
      ).roleId,
      featureId: feature.id,
    },
  });
  const visits = await Promise.all(Array.from({ length: 6 }, () => f.visit()));
  const numbers = await Promise.all(
    visits.map(async (v) => {
      const d = await saveConsultationDraft(f.doctorUser.actor, v.id, content);
      return (
        await issuePrescription(f.doctorUser.actor, d.id, {
          expectedRevision: d.revision,
        })
      ).prescriptionNumber;
    }),
  );
  check(
    "Parallel issuance produces distinct permanent numbers without pool starvation",
    new Set(numbers).size === 6,
  );
  await prisma.tenantFeatureOverride.create({
    data: {
      tenantId: f.tenant.id,
      featureId: feature.id,
      enabled: false,
      reason: "Synthetic entitlement denial check",
    },
  });
  await rejects(
    "Tenant override denies even administrative wildcard",
    () => getPrescriptionForActor(f.admin.actor, draft.id),
    FeatureError,
  );
  await prisma.tenantFeatureOverride.deleteMany({
    where: { tenantId: f.tenant.id, featureId: feature.id },
  });
  await prisma.feature.update({
    where: { id: feature.id },
    data: { globalEnabled: false },
  });
  await rejects(
    "Global kill switch denies clinical records",
    () => getPrescriptionForActor(f.reader.actor, draft.id),
    FeatureError,
  );
  await prisma.feature.update({
    where: { id: feature.id },
    data: { globalEnabled: true },
  });
  const plan = await prisma.plan.findUniqueOrThrow({
    where: { id: f.tenant.planId! },
  });
  await prisma.planFeature.update({
    where: { planId_featureId: { planId: plan.id, featureId: feature.id } },
    data: { enabled: false },
  });
  await rejects(
    "Plan denial remains authoritative",
    () => getPrescriptionForActor(f.reader.actor, draft.id),
    FeatureError,
  );
  await prisma.planFeature.update({
    where: { planId_featureId: { planId: plan.id, featureId: feature.id } },
    data: { enabled: true },
  });
  const eligible = await prisma.role.findFirstOrThrow({
    where: { tenantId: f.tenant.id, key: "DOCTOR" },
  });
  const customized = await prisma.role.findFirstOrThrow({
    where: { tenantId: f.foreignTenant.id, key: "DOCTOR" },
  });
  const before = [...PRE_PRESCRIPTION_ROLE_PERMISSIONS.DOCTOR];
  await prisma.role.update({
    where: { id: eligible.id },
    data: { permissions: before },
  });
  await prisma.role.update({
    where: { id: customized.id },
    data: { permissions: before, isSystem: false },
  });
  execFileSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "scripts/backfill-prescriptions.mts"],
    { env: process.env },
  );
  check(
    "Backfill dry-run writes no permission changes",
    JSON.stringify(
      (await prisma.role.findUniqueOrThrow({ where: { id: eligible.id } }))
        .permissions,
    ) === JSON.stringify(before),
  );
  await prisma.feature.update({
    where: { id: feature.id },
    data: { globalEnabled: false },
  });
  await prisma.planFeature.update({
    where: { planId_featureId: { planId: plan.id, featureId: feature.id } },
    data: { enabled: false },
  });
  execFileSync(
    process.execPath,
    [
      "node_modules/tsx/dist/cli.mjs",
      "scripts/backfill-prescriptions.mts",
      "--apply",
    ],
    { env: process.env },
  );
  check(
    "Local backfill upgrades only exact untouched system role",
    JSON.stringify(
      (await prisma.role.findUniqueOrThrow({ where: { id: eligible.id } }))
        .permissions,
    ) ===
      JSON.stringify([
        ...before,
        "prescription:read",
        "prescription:draft",
        "prescription:issue",
      ]),
  );
  check(
    "Local backfill preserves customized role exactly",
    JSON.stringify(
      (await prisma.role.findUniqueOrThrow({ where: { id: customized.id } }))
        .permissions,
    ) === JSON.stringify(before),
  );
  check(
    "Backfill preserves explicit feature and plan switches",
    !(await prisma.feature.findUniqueOrThrow({ where: { id: feature.id } }))
      .globalEnabled &&
      !(
        await prisma.planFeature.findUniqueOrThrow({
          where: {
            planId_featureId: { planId: plan.id, featureId: feature.id },
          },
        })
      ).enabled,
  );
  await prisma.feature.update({
    where: { id: feature.id },
    data: { globalEnabled: true },
  });
  await prisma.planFeature.update({
    where: { planId_featureId: { planId: plan.id, featureId: feature.id } },
    data: { enabled: true },
  });
  console.log(
    `All ${checks} prescription database checks passed. Synthetic fixtures retained in disposable database.`,
  );
}
main()
  .catch((error: unknown) => {
    console.error(
      error instanceof Error
        ? error.message
        : "Prescription acceptance failed.",
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
