/**
 * Stage-6 verification — notifications, exercised against a LOCAL database.
 *
 *     npm run verify:notifications
 *
 * Builds a throwaway tenant, performs the record modifications PRD §6.7 says
 * must raise a notification, then asserts what each role can see and change.
 *
 * Refuses to run unless DATABASE_URL points at localhost: it writes and deletes
 * rows, and must never be aimed at a real clinic's data.
 */
import { PermissionError } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { seedDefaultRoles } from "@/lib/defaultRoles";
import { createClinic, updateClinic } from "@/lib/clinics";
import { createDoctor, updateDoctor, addLeave } from "@/lib/doctors";
import { createRegistration, updateRegistration } from "@/lib/registrations";
import {
  countUnreadForActor,
  listNotificationsForActor,
  markNotificationsForActor,
} from "@/lib/notifications";

const databaseUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl)) {
  console.error(
    "Refusing to run: DATABASE_URL does not point at a local database.",
  );
  process.exit(1);
}

let failures = 0;

function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL  ${label}`, detail === undefined ? "" : detail);
}

async function expectThrows(
  label: string,
  fn: () => Promise<unknown>,
  is: (error: unknown) => boolean,
): Promise<void> {
  try {
    await fn();
    check(label, false, "did not throw");
  } catch (error: unknown) {
    check(label, is(error), error);
  }
}

const TEST_TENANT_NAME = "verify-notifications";

async function build() {
  const tenant = await prisma.tenant.create({
    data: {
      businessName: TEST_TENANT_NAME,
      email: `${TEST_TENANT_NAME}-${Date.now()}@example.test`,
      emailVerifiedAt: new Date(),
    },
    select: { id: true },
  });

  await seedDefaultRoles(prisma, tenant.id);

  const roles = await prisma.role.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, name: true },
  });
  const roleId = (name: string) => roles.find((role) => role.name === name)!.id;

  const owner = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      name: "Asha Owner",
      email: `owner-${tenant.id}@example.test`,
      passwordHash: "x",
      userRoles: { create: [{ roleId: roleId("Owner") }] },
    },
    select: { id: true },
  });

  const ownerActor = { userId: owner.id, tenantId: tenant.id };

  // Created through the module under test, so clinic.created is raised too.
  const clinicA = await createClinic(ownerActor, { name: "Alpha Clinic" });
  const clinicB = await createClinic(ownerActor, { name: "Beta Clinic" });

  // Admin holds notification:read, but only inside Clinic A.
  const clinicAdmin = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      name: "Ravi Admin",
      email: `admin-${tenant.id}@example.test`,
      passwordHash: "x",
      userRoles: { create: [{ roleId: roleId("Admin"), clinicId: clinicA.id }] },
    },
    select: { id: true },
  });

  // Staff deliberately lack notification:read.
  const staff = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      name: "Front Desk",
      email: `staff-${tenant.id}@example.test`,
      passwordHash: "x",
      userRoles: { create: [{ roleId: roleId("Staff"), clinicId: clinicA.id }] },
    },
    select: { id: true },
  });

  return {
    tenantId: tenant.id,
    clinicA: clinicA.id,
    clinicB: clinicB.id,
    ownerActor,
    adminActor: { userId: clinicAdmin.id, tenantId: tenant.id },
    staffActor: { userId: staff.id, tenantId: tenant.id },
  };
}

async function main(): Promise<void> {
  const t = await build();

  console.log("\nFR-7.1 a record modification raises a notification");

  const afterClinics = await listNotificationsForActor(t.ownerActor);
  check(
    "creating two clinics raised two notifications",
    afterClinics.items.filter((item) => item.type === "clinic.created").length === 2,
    afterClinics.items.map((item) => item.type),
  );
  check(
    "the message names the clinic and who added it",
    afterClinics.items.some(
      (item) =>
        item.type === "clinic.created" &&
        item.message.includes("Alpha Clinic") &&
        item.message.includes("Asha Owner"),
    ),
    afterClinics.items.map((item) => item.message),
  );

  await updateClinic(t.ownerActor, t.clinicA, { city: "Pune" });

  const doctor = await createDoctor(t.ownerActor, {
    clinicId: t.clinicA,
    name: "Dr Rao",
    department: "Cardiology",
  });
  await updateDoctor(t.ownerActor, doctor.id, { department: "Neurology" });

  // Scheduling entries deliberately raise nothing — see the note in lib/doctors.
  await addLeave(t.ownerActor, doctor.id, {
    startDate: "2026-09-01",
    endDate: "2026-09-03",
  });

  const registration = await createRegistration(t.ownerActor, {
    clinicId: t.clinicA,
    name: "Ramesh Kumar",
    mobileNumber: "9800000001",
    doctorId: doctor.id,
    department: "Neurology",
    amount: 500,
    visitDate: "2026-08-10",
    visitTime: "14:30",
  });

  await updateRegistration(t.ownerActor, registration.id, {
    amount: 750,
    mobileNumber: "9800000009",
  });

  // A visit in the OTHER clinic, for the scoping checks below.
  await createRegistration(t.ownerActor, {
    clinicId: t.clinicB,
    name: "Priya Nair",
    mobileNumber: "9800000003",
    department: "Dermatology",
    amount: 1000,
    visitDate: "2026-08-11",
    visitTime: "12:00",
  });

  const all = await listNotificationsForActor(t.ownerActor, { limit: 200 });
  const typeCount = (type: string) =>
    all.items.filter((item) => item.type === type).length;

  check("clinic.updated raised", typeCount("clinic.updated") === 1, typeCount("clinic.updated"));
  check("doctor.created raised", typeCount("doctor.created") === 1);
  check("doctor.updated raised", typeCount("doctor.updated") === 1);
  check("registration.created raised", typeCount("registration.created") === 2);
  check("registration.updated raised", typeCount("registration.updated") === 1);
  check(
    "adding leave raises nothing",
    all.items.every((item) => !item.type.startsWith("leave")),
  );
  check(
    "a new patient reads as a new patient, not a follow-up",
    all.items.some(
      (item) =>
        item.type === "registration.created" &&
        item.message.includes("New patient Ramesh Kumar (PT-"),
    ),
    all.items.filter((i) => i.type === "registration.created").map((i) => i.message),
  );
  check(
    "an edit names the fields the audit log recorded",
    all.items.some(
      (item) =>
        item.type === "registration.updated" &&
        item.message.includes("Amount") &&
        item.message.includes("Mobile number"),
    ),
    all.items.filter((i) => i.type === "registration.updated").map((i) => i.message),
  );
  check(
    "every notification links to its record",
    all.items.every((item) => item.href !== null),
    all.items.filter((item) => item.href === null),
  );

  console.log("\nOrdering — unread first, then newest first");
  const readIndex = all.items.findIndex((item) => item.read);
  check(
    "nothing is read yet, so ordering is purely newest first",
    readIndex === -1,
    readIndex,
  );
  const timestamps = all.items.map((item) => item.createdAt.getTime());
  check(
    "newest first",
    timestamps.every((value, index) => index === 0 || timestamps[index - 1] >= value),
    timestamps,
  );

  console.log("\nPRD §9 scoping — a clinic-scoped Admin sees only their clinic");
  const adminFeed = await listNotificationsForActor(t.adminActor, { limit: 200 });
  check(
    "admin sees Clinic A rows",
    adminFeed.items.length > 0 && adminFeed.items.every((item) => item.clinicId === t.clinicA),
    adminFeed.items.map((item) => item.clinicId),
  );
  check(
    "admin never sees Beta Clinic's registration",
    adminFeed.items.every((item) => !item.message.includes("Priya Nair")),
  );
  check(
    "admin's unread count matches their own reach",
    adminFeed.unreadCount === adminFeed.items.length,
    { count: adminFeed.unreadCount, items: adminFeed.items.length },
  );
  check(
    "naming an out-of-reach clinic yields nothing, not another clinic's feed",
    (await listNotificationsForActor(t.adminActor, { clinicId: t.clinicB })).items
      .length === 0,
  );

  console.log("\nStaff hold notification:read nowhere");
  await expectThrows(
    "listing refuses Staff with 403",
    () => listNotificationsForActor(t.staffActor),
    (error) => error instanceof PermissionError,
  );
  await expectThrows(
    "marking refuses Staff with 403",
    () => markNotificationsForActor(t.staffActor, { all: true, read: true }),
    (error) => error instanceof PermissionError,
  );
  check(
    "the nav badge returns 0 for Staff rather than erroring",
    (await countUnreadForActor(t.staffActor)) === 0,
  );

  console.log("\nFR-7.2 read / unread");
  const target = all.items[0];
  const marked = await markNotificationsForActor(t.ownerActor, {
    ids: [target.id],
    read: true,
  });
  check("marking one reports one row changed", marked.updated === 1, marked.updated);
  check(
    "unread count drops by one",
    marked.unreadCount === all.unreadCount - 1,
    { before: all.unreadCount, after: marked.unreadCount },
  );

  const repeat = await markNotificationsForActor(t.ownerActor, {
    ids: [target.id],
    read: true,
  });
  check("marking the same one again changes nothing", repeat.updated === 0, repeat.updated);

  const unreadOnly = await listNotificationsForActor(t.ownerActor, {
    status: "unread",
    limit: 200,
  });
  check(
    "the unread filter excludes it",
    unreadOnly.items.every((item) => item.id !== target.id),
  );

  const reordered = await listNotificationsForActor(t.ownerActor, { limit: 200 });
  check(
    "a read item sorts below every unread one",
    reordered.items.findIndex((item) => item.id === target.id) ===
      reordered.items.length - 1,
    reordered.items.map((item) => `${item.read}`),
  );

  await markNotificationsForActor(t.ownerActor, { ids: [target.id], read: false });
  check(
    "marking unread restores the count",
    (await countUnreadForActor(t.ownerActor)) === all.unreadCount,
  );

  console.log("\nCross-tenant and cross-clinic writes");
  const beta = reordered.items.find((item) => item.clinicId === t.clinicB)!;
  const refused = await markNotificationsForActor(t.adminActor, {
    ids: [beta.id],
    read: true,
  });
  check(
    "a clinic-scoped Admin cannot flip another clinic's row",
    refused.updated === 0,
    refused.updated,
  );
  check(
    "and that row is still unread",
    (await prisma.notification.findUnique({
      where: { id: beta.id },
      select: { read: true },
    }))?.read === false,
  );

  const adminBefore = await countUnreadForActor(t.adminActor);
  const ownerBefore = await countUnreadForActor(t.ownerActor);
  const markAll = await markNotificationsForActor(t.adminActor, {
    all: true,
    read: true,
  });
  check(
    "mark-all only clears the Admin's own clinic",
    markAll.updated === adminBefore,
    { updated: markAll.updated, adminBefore },
  );
  check(
    "the Owner still has Beta Clinic's unread rows",
    (await countUnreadForActor(t.ownerActor)) === ownerBefore - adminBefore,
  );

  console.log("\nRead state is per account, not per user (PRD §7)");
  check(
    "the Owner sees the Admin's read state, since the table has one flag",
    (await listNotificationsForActor(t.ownerActor, { limit: 200 })).items
      .filter((item) => item.clinicId === t.clinicA)
      .every((item) => item.read),
  );
}

main()
  .catch((error: unknown) => {
    failures += 1;
    console.error("\nScript error:", error);
  })
  .finally(async () => {
    // Registrations reference doctors with onDelete: Restrict, so test data is
    // torn down inside out. Also sweeps up leftovers from a failed run.
    const stale = await prisma.tenant.findMany({
      where: { businessName: TEST_TENANT_NAME },
      select: { id: true },
    });

    for (const { id } of stale) {
      await prisma.registration.deleteMany({ where: { clinic: { tenantId: id } } });
      await prisma.patient.deleteMany({ where: { tenantId: id } });
      await prisma.doctor.deleteMany({ where: { clinic: { tenantId: id } } });
      await prisma.tenant.delete({ where: { id } }).catch(() => {});
    }

    await prisma.$disconnect();
    console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
    process.exitCode = failures === 0 ? 0 : 1;
  });
