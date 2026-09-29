import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { seedFeatureCatalogue, DEFAULT_PLAN_KEY } from "@/lib/defaultFeatures";
import { seedDefaultRoles } from "@/lib/defaultRoles";

/** Synthetic PB-5 E2E fixture. Disposable localhost database only; no real people or clinics. */
export const BILLING_TEST_PASSWORD = "Disposable-billing-test-only-2026!";

export function assertBillingTestDatabase() {
  const url = new URL(process.env.DATABASE_URL ?? "mysql://invalid");
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || !url.pathname.startsWith("/medcare_pb"))
    throw new Error("Billing E2E fixture writes require a disposable localhost medcare_pb database.");
}

export async function createBillingFixture(db: PrismaClient) {
  assertBillingTestDatabase();
  await seedFeatureCatalogue(db);
  const plan = await db.plan.findUniqueOrThrow({ where: { key: DEFAULT_PLAN_KEY } });
  const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const tenant = await db.tenant.create({ data: { businessName: "Billing synthetic account", email: `pb5-tenant-${stamp}@example.test`,
    slug: `pb5-tenant-${stamp}`, status: "ACTIVE", emailVerifiedAt: new Date(), planId: plan.id } });
  await seedDefaultRoles(db, tenant.id);
  const clinic = await db.clinic.create({ data: { tenantId: tenant.id, name: `Billing Test Clinic ${stamp}`, address: "1 Synthetic Road", city: "Test city" } });
  const doctor = await db.doctor.create({ data: { clinicId: clinic.id, name: "Dr. Synthetic Billing", department: "General Medicine" } });
  const service = await db.serviceItem.create({ data: { tenantId: tenant.id, clinicId: clinic.id, name: "Synthetic X-ray", category: "TEST", price: "500.00" } });
  await db.clinicBillingSettings.create({ data: { tenantId: tenant.id, clinicId: clinic.id, footerNote: "Synthetic footer note for E2E." } });
  const hash = await bcrypt.hash(BILLING_TEST_PASSWORD, 4);
  const role = await db.role.create({ data: { tenantId: tenant.id, name: "Synthetic billing owner", permissions: ["*"] } });
  const owner = await db.user.create({ data: { tenantId: tenant.id, name: "Synthetic billing owner", email: `pb5-owner-${stamp}@example.test`,
    passwordHash: hash, accountStatus: "ACTIVE", membershipStatus: "ACTIVE", emailVerifiedAt: new Date(),
    userRoles: { create: { roleId: role.id, clinicId: null } } } });
  let visits = 0;
  async function visit() {
    visits += 1;
    const patient = await db.patient.create({ data: { tenantId: tenant.id, clinicId: clinic.id, patientCode: `PB5-${stamp}-${visits}`,
      name: `Synthetic Billing Patient ${visits}`, mobileNumber: "9333333333", city: "Test city" } });
    return db.registration.create({ data: { clinicId: clinic.id, patientId: patient.id, doctorId: doctor.id, department: "General Medicine",
      amount: "300.00", visitDate: new Date(), createdBy: owner.id } });
  }
  return { tenant, clinic, doctor, service, owner, visit };
}
