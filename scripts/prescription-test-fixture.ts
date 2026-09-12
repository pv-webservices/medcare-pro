import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { seedFeatureCatalogue, DEFAULT_PLAN_KEY } from "@/lib/defaultFeatures";
import { seedDefaultRoles } from "@/lib/defaultRoles";

export const PRESCRIPTION_TEST_PASSWORD =
  "Disposable-prescription-test-only-2026!";
export function assertPrescriptionTestDatabase() {
  const url = new URL(process.env.DATABASE_URL ?? "mysql://invalid");
  if (
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    !url.pathname.startsWith("/medcare_ep")
  )
    throw new Error(
      "Fixture writes require a disposable localhost medcare_ep database.",
    );
}
export async function createPrescriptionFixture(db: PrismaClient) {
  assertPrescriptionTestDatabase();
  await seedFeatureCatalogue(db);
  const plan = await db.plan.findUniqueOrThrow({
    where: { key: DEFAULT_PLAN_KEY },
  });
  const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const tenant = await db.tenant.create({
    data: {
      businessName: "Prescription synthetic clinic",
      email: `rx-tenant-${stamp}@example.test`,
      slug: `rx-${stamp}`,
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
      planId: plan.id,
    },
  });
  const foreignTenant = await db.tenant.create({
    data: {
      businessName: "Foreign synthetic clinic",
      email: `rx-foreign-${stamp}@example.test`,
      slug: `rx-foreign-${stamp}`,
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
      planId: plan.id,
    },
  });
  await seedDefaultRoles(db, tenant.id);
  await seedDefaultRoles(db, foreignTenant.id);
  const clinic = await db.clinic.create({
    data: {
      tenantId: tenant.id,
      name: "Prescription Test Clinic",
      address: "Original clinic address",
      city: "Test city",
    },
  });
  const otherClinic = await db.clinic.create({
    data: { tenantId: tenant.id, name: "Other Clinic" },
  });
  const foreignClinic = await db.clinic.create({
    data: { tenantId: foreignTenant.id, name: "Foreign Clinic" },
  });
  const hash = await bcrypt.hash(PRESCRIPTION_TEST_PASSWORD, 4);
  async function user(
    kind: string,
    permissions: string[],
    tenantId = tenant.id,
    clinicId: string | null = clinic.id,
  ) {
    const role = await db.role.create({
      data: { tenantId, name: `Synthetic ${kind}`, permissions },
    });
    const account = await db.user.create({
      data: {
        tenantId,
        name: `Synthetic ${kind}`,
        email: `rx-${kind}-${stamp}@example.test`,
        passwordHash: hash,
        accountStatus: "ACTIVE",
        membershipStatus: "ACTIVE",
        emailVerifiedAt: new Date(),
        userRoles: { create: { roleId: role.id, clinicId } },
      },
    });
    return { ...account, actor: { userId: account.id, tenantId } };
  }
  const clinical = [
    "clinic:read",
    "doctor:read",
    "patient:read",
    "registration:read",
    "prescription:read",
    "prescription:draft",
    "prescription:issue",
  ];
  const doctorUser = await user("doctor", clinical);
  const otherDoctorUser = await user("other-doctor", clinical);
  const scopedUser = await user("scoped", clinical, tenant.id, otherClinic.id);
  const admin = await user("admin", ["*"]);
  const preparer = await user("preparer", [
    "prescription:read",
    "prescription:draft",
  ]);
  const reader = await user("reader", ["prescription:read"]);
  const canceller = await user("canceller", [
    "prescription:read",
    "prescription:cancel",
  ]);
  const receptionist = await user("receptionist", [
    "registration:read",
    "clinic:read",
    "doctor:read",
    "patient:read",
  ]);
  const foreign = await user(
    "foreign",
    ["*"],
    foreignTenant.id,
    foreignClinic.id,
  );
  const doctor = await db.doctor.create({
    data: {
      clinicId: clinic.id,
      userId: doctorUser.id,
      name: "Dr. Synthetic Original",
      department: "General Medicine",
      qualification: "Synthetic qualification",
      medicalRegistrationNumber: "SYNTHETIC-REG-1",
      registrationCouncil: "Synthetic Council",
      phone: "9000000000",
    },
  });
  await db.doctor.create({
    data: {
      clinicId: clinic.id,
      userId: otherDoctorUser.id,
      name: "Dr. Synthetic Other",
      department: "General Medicine",
    },
  });
  const patient = await db.patient.create({
    data: {
      tenantId: tenant.id,
      clinicId: clinic.id,
      patientCode: `PT-SYNTHETIC-${stamp}`,
      name: "Synthetic Patient Original",
      age: 42,
      gender: "Other",
      mobileNumber: "9000000001",
      address: "Original patient address",
      city: "Test city",
    },
  });
  async function visit(doctorId: string | null = doctor.id) {
    return db.registration.create({
      data: {
        clinicId: clinic.id,
        patientId: patient.id,
        doctorId,
        department: doctor.department,
        amount: 100,
        visitDate: new Date("2026-09-12T10:30:00Z"),
        createdBy: admin.id,
      },
    });
  }
  return {
    tenant,
    foreignTenant,
    clinic,
    otherClinic,
    doctor,
    patient,
    doctorUser,
    otherDoctorUser,
    scopedUser,
    admin,
    preparer,
    reader,
    canceller,
    receptionist,
    foreign,
    visit,
  };
}
