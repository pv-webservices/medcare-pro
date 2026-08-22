/**
 * Stage-4 verification — patient registration, return visits and the audit
 * trail, exercised against a LOCAL database.
 *
 *     npm run verify:registrations
 *
 * Creates two throwaway tenants, asserts the behaviour PRD §6.3 and §9 require,
 * then deletes them. Refuses to run unless DATABASE_URL points at localhost:
 * it writes and deletes rows, and must never be aimed at a real clinic's data.
 *
 * This is a smoke check, not a test suite — there is no test runner in the
 * project yet. It goes through the same src/lib functions the API routes call,
 * so it covers the scoping and audit rules rather than just the happy path.
 */
import { PermissionError, ScopeError } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { seedDefaultRoles } from "@/lib/defaultRoles";
import { formatRupees } from "@/lib/money";
import { toRegistrationCsv } from "@/lib/registrationCsv";
import {
  createRegistration,
  findPatientsForActor,
  getRegistrationForActor,
  listDepartmentsForActor,
  listEditHistoryForActor,
  listPatientVisitsForActor,
  listRegistrationsForActor,
  listRegistrationsForExport,
  updateRegistration,
} from "@/lib/registrations";

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

const TEST_TENANT_NAMES = ["verify-alpha", "verify-beta"];
const tenantIds: string[] = [];

async function makeTenant(name: string) {
  const tenant = await prisma.tenant.create({
    data: {
      businessName: name,
      email: `${name}-${Date.now()}@example.test`,
      // Stage 3 made tenants.slug NOT NULL. Mirrors the email's uniqueness.
      slug: `${name}-${Date.now()}`,
      emailVerifiedAt: new Date(),
    },
    select: { id: true },
  });
  tenantIds.push(tenant.id);

  await seedDefaultRoles(prisma, tenant.id);

  const clinic = await prisma.clinic.create({
    data: { tenantId: tenant.id, name: `${name} Clinic`, city: "Pune" },
    select: { id: true },
  });
  const otherClinic = await prisma.clinic.create({
    data: { tenantId: tenant.id, name: `${name} Clinic Two`, city: "Nashik" },
    select: { id: true },
  });

  const doctor = await prisma.doctor.create({
    data: { clinicId: clinic.id, name: "Dr Rao", department: "Cardiology" },
    select: { id: true },
  });
  const otherDoctor = await prisma.doctor.create({
    data: { clinicId: otherClinic.id, name: "Dr Iyer", department: "Dermatology" },
    select: { id: true },
  });

  const roles = await prisma.role.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, name: true },
  });
  const roleId = (roleName: string) =>
    roles.find((role) => role.name === roleName)!.id;

  const owner = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      name: "Owner",
      email: `owner-${tenant.id}@example.test`,
      passwordHash: "x",
      userRoles: { create: [{ roleId: roleId("Owner") }] },
    },
    select: { id: true },
  });

  const staff = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      name: "Front Desk",
      email: `staff-${tenant.id}@example.test`,
      passwordHash: "x",
      // Clinic-scoped: reaches `clinic`, must never reach `otherClinic`.
      userRoles: { create: [{ roleId: roleId("Staff"), clinicId: clinic.id }] },
    },
    select: { id: true },
  });

  return {
    clinicId: clinic.id,
    otherClinicId: otherClinic.id,
    doctorId: doctor.id,
    otherDoctorId: otherDoctor.id,
    ownerActor: { userId: owner.id, tenantId: tenant.id },
    staffActor: { userId: staff.id, tenantId: tenant.id },
  };
}

async function main(): Promise<void> {
  const a = await makeTenant(TEST_TENANT_NAMES[0]);
  const b = await makeTenant(TEST_TENANT_NAMES[1]);
  const year = new Date().getFullYear();

  console.log("\nFR-3.1 create, patient code, visit date + time");
  const first = await createRegistration(a.ownerActor, {
    clinicId: a.clinicId,
    name: "Ramesh Kumar",
    age: 44,
    gender: "Male",
    mobileNumber: "+91 98765 43210",
    address: "12 MG Road",
    city: "Pune",
    doctorId: a.doctorId,
    department: "Cardiology",
    amount: 500,
    visitDate: "2026-08-10",
    visitTime: "14:30",
  });
  check("patient code is PT-YYYY-0001", first.patientCode === `PT-${year}-0001`, first.patientCode);
  check("amount stored to 2dp", first.amount === "500.00", first.amount);
  check("visit date round-trips", first.visitDate === "2026-08-10", first.visitDate);
  check("visit time round-trips", first.visitTime === "14:30", first.visitTime);
  check("first visit is NEW", first.visitType === "NEW", first.visitType);
  check("doctor attached", first.doctorName === "Dr Rao", first.doctorName);

  const walkIn = await createRegistration(a.staffActor, {
    clinicId: a.clinicId,
    name: "Sunita Desai",
    mobileNumber: "9876500000",
    department: "Dermatology",
    amount: 250.5,
    visitDate: "2026-08-12",
    visitTime: "09:05",
  });
  check("second code is sequential", walkIn.patientCode === `PT-${year}-0002`, walkIn.patientCode);
  check("doctor optional", walkIn.doctorName === null, walkIn.doctorName);

  console.log("\nFR-3.1a return visit reuses the Patient ID");
  const matches = await findPatientsForActor(a.staffActor, a.clinicId, "43210");
  check("lookup finds by mobile fragment", matches.length === 1, matches.length);
  check("lookup reports the visit count", matches[0]?.visitCount === 1, matches[0]?.visitCount);
  check(
    "lookup reports the last visit",
    matches[0]?.lastVisitDate === "2026-08-10",
    matches[0]?.lastVisitDate,
  );

  const byCode = await findPatientsForActor(a.staffActor, a.clinicId, first.patientCode);
  check("lookup finds by Patient ID", byCode.length === 1, byCode.length);
  check("lookup ignores a 1-character term", (await findPatientsForActor(a.staffActor, a.clinicId, "R")).length === 0);

  const revisit = await createRegistration(a.staffActor, {
    clinicId: a.clinicId,
    patientId: matches[0]!.id,
    name: "Ramesh Kumar",
    age: 44,
    gender: "Male",
    // A corrected number, captured at the desk on the return visit.
    mobileNumber: "+91 98765 43211",
    address: "12 MG Road",
    city: "Pune",
    doctorId: a.doctorId,
    department: "Cardiology",
    amount: 300,
    visitDate: "2026-09-01",
    visitTime: "11:00",
  });
  check("return visit keeps the Patient ID", revisit.patientCode === first.patientCode, revisit.patientCode);
  check("return visit is the same patient row", revisit.patientId === first.patientId);
  check("return visit is FOLLOW_UP by default", revisit.visitType === "FOLLOW_UP", revisit.visitType);
  check("corrected mobile was saved", revisit.mobileNumber === "+91 98765 43211", revisit.mobileNumber);
  check(
    "no second patient was minted",
    (await prisma.patient.count({ where: { clinicId: a.clinicId } })) === 2,
  );

  const override = await createRegistration(a.ownerActor, {
    clinicId: a.clinicId,
    patientId: matches[0]!.id,
    name: "Ramesh Kumar",
    mobileNumber: "+91 98765 43211",
    department: "Cardiology",
    amount: 400,
    visitDate: "2026-09-05",
    visitTime: "10:00",
    // A returning patient with a new complaint is a new case.
    visitType: "NEW",
  });
  check("visit type is overridable", override.visitType === "NEW", override.visitType);

  const visits = await listPatientVisitsForActor(a.ownerActor, first.id);
  check("visit history lists all three", visits.length === 3, visits.length);
  check("visit history is newest first", visits[0]?.visitDate === "2026-09-05", visits[0]?.visitDate);

  await expectThrows(
    "a patient from another clinic is rejected",
    () =>
      createRegistration(a.ownerActor, {
        clinicId: a.otherClinicId,
        patientId: matches[0]!.id,
        name: "Ramesh Kumar",
        mobileNumber: "9000000001",
        department: "Dermatology",
        amount: 100,
        visitDate: "2026-09-06",
        visitTime: "10:00",
      }),
    (error) => error instanceof Error && error.name === "BadRequestError",
  );
  await expectThrows(
    "lookup in an out-of-scope clinic is refused",
    () => findPatientsForActor(a.staffActor, a.otherClinicId, "Ramesh"),
    (error) => error instanceof PermissionError,
  );

  console.log("\nFR-3.6 audit trail");
  const createdLog = await listEditHistoryForActor(a.ownerActor, first.id);
  check("one entry after create", createdLog.length === 1, createdLog.length);
  check("marked as creation", createdLog[0]?.isCreation === true);
  check("role captured", createdLog[0]?.roleAtTime === "Owner", createdLog[0]?.roleAtTime);
  check("every from is null on create", createdLog[0]?.changes.every((c) => c.from === null) === true);
  check(
    "visit date & time logged together",
    createdLog[0]?.changes.find((c) => c.field === "visitAt")?.to === "2026-08-10 14:30",
  );

  const edited = await updateRegistration(a.staffActor, first.id, {
    amount: 750,
    name: "Ramesh Kumar Sr",
    doctorId: null,
    visitTime: "15:45",
  });
  check("amount updated", edited.amount === "750.00", edited.amount);
  check("doctor detached", edited.doctorName === null, edited.doctorName);
  check("time updated", edited.visitTime === "15:45", edited.visitTime);

  const history = await listEditHistoryForActor(a.ownerActor, first.id);
  check("two entries after edit", history.length === 2, history.length);
  check("newest first", history[0]?.isCreation === false);
  check("editor's role at time", history[0]?.roleAtTime === "Staff", history[0]?.roleAtTime);
  const amountChange = history[0]?.changes.find((c) => c.field === "amount");
  check(
    "amount from/to logged",
    amountChange?.from === "500.00" && amountChange?.to === "750.00",
    amountChange,
  );
  const visitChange = history[0]?.changes.find((c) => c.field === "visitAt");
  check(
    "time change logged",
    visitChange?.from === "2026-08-10 14:30" && visitChange?.to === "2026-08-10 15:45",
    visitChange,
  );
  check("unchanged fields absent", history[0]?.changes.every((c) => c.field !== "city") === true);

  await expectThrows(
    "no-op edit is rejected (no empty log row)",
    () => updateRegistration(a.ownerActor, first.id, { amount: 750 }),
    (error) => error instanceof Error && error.name === "BadRequestError",
  );
  await expectThrows(
    "staff cannot read the trail they write to",
    () => listEditHistoryForActor(a.staffActor, first.id),
    (error) => error instanceof PermissionError,
  );

  console.log("\nPRD §9 scoping");
  await expectThrows(
    "other tenant's registration is 404",
    () => getRegistrationForActor(b.ownerActor, first.id),
    (error) => error instanceof ScopeError,
  );
  await expectThrows(
    "doctor from another clinic is rejected",
    () =>
      createRegistration(a.ownerActor, {
        clinicId: a.clinicId,
        name: "Wrong Doctor",
        mobileNumber: "9999999999",
        doctorId: a.otherDoctorId,
        department: "Dermatology",
        amount: 100,
        visitDate: "2026-08-12",
        visitTime: "10:00",
      }),
    (error) => error instanceof Error && error.name === "BadRequestError",
  );
  await expectThrows(
    "clinic-scoped staff cannot create in a sibling clinic",
    () =>
      createRegistration(a.staffActor, {
        clinicId: a.otherClinicId,
        name: "Out Of Scope",
        mobileNumber: "9999999998",
        department: "Dermatology",
        amount: 100,
        visitDate: "2026-08-12",
        visitTime: "10:00",
      }),
    (error) => error instanceof PermissionError,
  );

  const sibling = await createRegistration(a.ownerActor, {
    clinicId: a.otherClinicId,
    name: "Other Clinic Patient",
    mobileNumber: "9000000000",
    doctorId: a.otherDoctorId,
    department: "Dermatology",
    amount: 300,
    visitDate: "2026-08-11",
    visitTime: "12:00",
  });
  await expectThrows(
    "staff cannot read a sibling clinic's registration",
    () => getRegistrationForActor(a.staffActor, sibling.id),
    (error) => error instanceof ScopeError,
  );

  console.log("\nFR-3.2 / FR-3.3 search and filters");
  // 5 visits exist for tenant A at this point: four in Clinic A (Ramesh's
  // three, Sunita's one) and one in Clinic Two. The four rejected creations
  // above wrote nothing, which is half of what these two counts assert.
  const all = await listRegistrationsForActor(a.ownerActor, {});
  check("owner sees every visit", all.total === 5, all.total);
  const staffList = await listRegistrationsForActor(a.staffActor, {});
  check("staff sees only their clinic", staffList.total === 4, staffList.total);
  check("search by name", (await listRegistrationsForActor(a.ownerActor, { search: "sunita" })).total === 1);
  check("search by phone fragment", (await listRegistrationsForActor(a.ownerActor, { search: "43211" })).total === 3);
  check("filter by department", (await listRegistrationsForActor(a.ownerActor, { department: "Dermatology" })).total === 2);
  check(
    "date range is inclusive both ends",
    (await listRegistrationsForActor(a.ownerActor, { from: "2026-08-11", to: "2026-08-12" })).total === 2,
  );
  check(
    "an afternoon visit is inside its own day",
    (await listRegistrationsForActor(a.ownerActor, { from: "2026-08-10", to: "2026-08-10" })).total === 1,
  );
  check("filter by clinic", (await listRegistrationsForActor(a.ownerActor, { clinicId: a.otherClinicId })).total === 1);
  check(
    "out-of-scope clinic filter returns nothing, not everything",
    (await listRegistrationsForActor(a.staffActor, { clinicId: a.otherClinicId })).total === 0,
  );
  check(
    "departments are distinct + sorted",
    JSON.stringify(await listDepartmentsForActor(a.ownerActor)) ===
      JSON.stringify(["Cardiology", "Dermatology"]),
  );

  console.log("\nRupee formatting");
  check("symbol and 2dp", formatRupees("500.00") === "₹500.00", formatRupees("500.00"));
  check("en-IN grouping", formatRupees("150000") === "₹1,50,000.00", formatRupees("150000"));
  check("unparseable value degrades safely", formatRupees("n/a") === "₹n/a", formatRupees("n/a"));

  console.log("\nFR-3.4 CSV export");
  const csv = toRegistrationCsv(await listRegistrationsForExport(a.staffActor, {}));
  const lines = csv.split("\r\n").filter((line) => line !== "");
  // Header plus the staff user's four Clinic A rows — the Clinic Two visit is
  // outside their scope, and the injected row below does not exist yet.
  check("header + scoped rows only", lines.length === 5, lines.length);
  check("BOM present", csv.startsWith("﻿"));
  check("amount column is unformatted for summing", csv.includes("Amount (INR)"));
  check("visit time exported", csv.includes("14:30") || csv.includes("15:45"));
  check("phone not apostrophe-guarded", !csv.includes("'+91"));

  await createRegistration(a.ownerActor, {
    clinicId: a.clinicId,
    name: '=cmd|"/c calc"!A1',
    mobileNumber: "9111111111",
    department: "Cardiology",
    amount: 10,
    visitDate: "2026-08-13",
    visitTime: "10:00",
  });
  const injectedCsv = toRegistrationCsv(
    await listRegistrationsForExport(a.ownerActor, { search: "cmd" }),
  );
  check(
    "formula cell is neutralised and quoted",
    injectedCsv.includes(`"'=cmd|""/c calc""!A1"`),
    injectedCsv.split("\r\n")[1],
  );
}

main()
  .catch((error: unknown) => {
    failures += 1;
    console.error("\nScript error:", error);
  })
  .finally(async () => {
    // Tenant delete cascades to clinics and doctors, but registrations
    // reference doctors with onDelete: Restrict (deliberate — a doctor must not
    // be removable out from under the revenue history). Test data therefore has
    // to be torn down inside out. Also sweeps up leftovers from a failed run.
    const stale = await prisma.tenant.findMany({
      where: { businessName: { in: TEST_TENANT_NAMES } },
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
