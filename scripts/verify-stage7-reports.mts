/**
 * Stage-7 verification — the revenue export gate, exercised against a LOCAL
 * database.
 *
 *     npm run verify:stage7
 *
 * The unit tests cover the CSV itself, which is pure. What only a database can
 * answer is whether the gate holds: `reports:export` is a SECOND permission on
 * top of `report:read`, resolved as the INTERSECTION of the two clinic scopes,
 * so most of what follows is written from the direction someone would push on
 * it — holding one gate but not the other, holding each in a different clinic,
 * and holding the inert `reports:view` and nothing else.
 *
 * Runs against a FIXED "now" so period boundaries are deterministic rather than
 * depending on the day the script is run.
 *
 * Refuses to run unless DATABASE_URL points at localhost: it writes and deletes
 * rows, and must never be aimed at a real clinic's data.
 */
import { PermissionError } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { seedDefaultRoles } from "@/lib/defaultRoles";
import { ALL_PERMISSIONS, findPermission } from "@/lib/permissions";
import { createRegistration } from "@/lib/registrations";
import {
  registrationCsvFilename,
  toRegistrationCsv,
} from "@/lib/registrationCsv";
import {
  listRegistrationsForExport,
  parseRegistrationFilters,
} from "@/lib/registrations";
import {
  REPORT_EXPORT_SECTIONS,
  isReportExportSection,
  reportCsvFilename,
  toReportCsv,
  type ReportExportSection,
} from "@/lib/reportCsv";
import {
  REPORT_EXPORT_PERMISSION,
  REPORT_VIEW_PERMISSION,
  getRevenueReport,
  getRevenueReportForExport,
} from "@/lib/reports";
import { CSV_BOM } from "@/lib/csv";

const databaseUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl)) {
  console.error(
    "Refusing to run: DATABASE_URL does not point at a local database.",
  );
  process.exit(1);
}

/** Mid-August 2026, so the month, week and year windows are all knowable. */
const NOW = new Date("2026-08-16T10:00:00.000Z");

let failures = 0;

function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL  ${label}`, detail === undefined ? "" : detail);
}

async function expectRefusal(
  label: string,
  permission: string,
  fn: () => Promise<unknown>,
): Promise<void> {
  try {
    await fn();
    check(label, false, "did not throw");
  } catch (error: unknown) {
    check(
      label,
      error instanceof PermissionError &&
        error.message === `Missing permission: ${permission}`,
      error,
    );
  }
}

/** Data rows of a CSV, BOM and header stripped. */
function dataRows(csv: string): string[] {
  return csv.slice(CSV_BOM.length).trimEnd().split("\r\n").slice(1);
}

function headerOf(csv: string): string {
  return csv.slice(CSV_BOM.length).split("\r\n")[0];
}

/** Totals a money column out of a CSV the way a spreadsheet would. */
function sumColumn(csv: string, index: number): number {
  return dataRows(csv).reduce(
    (total, row) => total + Number(row.split(",")[index]),
    0,
  );
}

const TEST_TENANT_NAME = "verify-stage7";

async function customRole(
  tenantId: string,
  name: string,
  permissions: readonly string[],
): Promise<string> {
  const role = await prisma.role.create({
    data: { tenantId, name, permissions: [...permissions] },
    select: { id: true },
  });
  return role.id;
}

async function build() {
  const stamp = Date.now();

  const tenant = await prisma.tenant.create({
    data: {
      businessName: TEST_TENANT_NAME,
      email: `${TEST_TENANT_NAME}-${stamp}@example.test`,
      slug: `${TEST_TENANT_NAME}-${stamp}`,
      emailVerifiedAt: new Date(),
    },
    select: { id: true },
  });

  // A second tenant with revenue of its own, so every isolation check below has
  // something real to leak if the scoping is wrong.
  const rival = await prisma.tenant.create({
    data: {
      businessName: TEST_TENANT_NAME,
      email: `${TEST_TENANT_NAME}-rival-${stamp}@example.test`,
      slug: `${TEST_TENANT_NAME}-rival-${stamp}`,
      emailVerifiedAt: new Date(),
    },
    select: { id: true },
  });

  await seedDefaultRoles(prisma, tenant.id);
  await seedDefaultRoles(prisma, rival.id);

  const clinicA = await prisma.clinic.create({
    data: { tenantId: tenant.id, name: "Alpha Clinic" },
    select: { id: true },
  });
  const clinicB = await prisma.clinic.create({
    data: { tenantId: tenant.id, name: "Beta Clinic" },
    select: { id: true },
  });
  const rivalClinic = await prisma.clinic.create({
    data: { tenantId: rival.id, name: "Rival Clinic" },
    select: { id: true },
  });

  const rao = await prisma.doctor.create({
    data: { clinicId: clinicA.id, name: "Dr Rao", department: "Cardiology" },
    select: { id: true },
  });
  const iyer = await prisma.doctor.create({
    data: { clinicId: clinicB.id, name: "Dr Iyer", department: "Dermatology" },
    select: { id: true },
  });
  const rivalDoctor = await prisma.doctor.create({
    data: { clinicId: rivalClinic.id, name: "Dr Rival", department: "ENT" },
    select: { id: true },
  });

  const roles = await prisma.role.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, name: true },
  });
  const roleId = (name: string) => roles.find((role) => role.name === name)!.id;

  const rivalRoles = await prisma.role.findMany({
    where: { tenantId: rival.id, name: "Owner" },
    select: { id: true },
  });

  // The permission sets that make this stage's guard interesting: each holds
  // exactly one side of the pair, or the inert key alone.
  const viewOnlyRole = await customRole(tenant.id, "Analyst (view only)", [
    REPORT_VIEW_PERMISSION,
  ]);
  const exportOnlyRole = await customRole(tenant.id, "Exporter (no view)", [
    REPORT_EXPORT_PERMISSION,
  ]);
  const bothRole = await customRole(tenant.id, "Analyst (full)", [
    REPORT_VIEW_PERMISSION,
    REPORT_EXPORT_PERMISSION,
  ]);
  const inertRole = await customRole(tenant.id, "Ticked the inert box", [
    "reports:view",
  ]);

  async function user(
    name: string,
    assignments: { roleId: string; clinicId?: string }[],
    tenantId = tenant.id,
  ) {
    const created = await prisma.user.create({
      data: {
        tenantId,
        name,
        email: `${name.toLowerCase().replace(/[^a-z]+/g, "-")}-${tenantId}@example.test`,
        passwordHash: "x",
        userRoles: { create: assignments },
      },
      select: { id: true },
    });
    return { userId: created.id, tenantId };
  }

  return {
    tenantId: tenant.id,
    clinicA: clinicA.id,
    clinicB: clinicB.id,
    rivalClinic: rivalClinic.id,
    rao: rao.id,
    iyer: iyer.id,
    rivalDoctor: rivalDoctor.id,
    ownerActor: await user("Owner", [{ roleId: roleId("Owner") }]),
    adminActor: await user("Admin", [{ roleId: roleId("Admin") }]),
    staffActor: await user("Front Desk", [
      { roleId: roleId("Staff"), clinicId: clinicA.id },
    ]),
    doctorActor: await user("Clinician", [{ roleId: roleId("Doctor") }]),
    viewOnlyActor: await user("View Only", [{ roleId: viewOnlyRole }]),
    exportOnlyActor: await user("Export Only", [{ roleId: exportOnlyRole }]),
    bothActor: await user("Both Gates", [{ roleId: bothRole }]),
    inertActor: await user("Inert Key", [{ roleId: inertRole }]),
    // Holds the view gate everywhere but may only export Alpha's figures.
    splitActor: await user("Split Scope", [
      { roleId: viewOnlyRole },
      { roleId: exportOnlyRole, clinicId: clinicA.id },
    ]),
    // The two gates in DIFFERENT clinics: the intersection is empty.
    disjointActor: await user("Disjoint Scope", [
      { roleId: viewOnlyRole, clinicId: clinicA.id },
      { roleId: exportOnlyRole, clinicId: clinicB.id },
    ]),
    rivalOwnerActor: await user(
      "Rival Owner",
      [{ roleId: rivalRoles[0].id }],
      rival.id,
    ),
  };
}

async function main(): Promise<void> {
  const t = await build();

  // ---- Known visits -------------------------------------------------------
  // Alpha, August: 500.00 + 250.50 = 750.50 across 2 patients, both Dr Rao.
  // Beta,  August: 1000.00 across 1 patient, Dr Iyer.
  // Tenant total for August: 1750.50.
  await createRegistration(t.ownerActor, {
    clinicId: t.clinicA,
    name: "Ramesh Kumar",
    mobileNumber: "9800000001",
    age: 40,
    gender: "Male",
    city: "Bengaluru",
    address: "10 Main Road",
    doctorId: t.rao,
    department: "Cardiology",
    amount: 500,
    visitDate: "2026-08-10",
    visitTime: "14:30",
  });

  await createRegistration(t.ownerActor, {
    clinicId: t.clinicA,
    name: "Sunita Desai",
    mobileNumber: "9800000002",
    age: 35,
    gender: "Female",
    city: "Bengaluru",
    address: "12 Cross Road",
    doctorId: t.rao,
    department: "Cardiology",
    amount: 250.5,
    visitDate: "2026-08-12",
    visitTime: "09:05",
  });

  await createRegistration(t.ownerActor, {
    clinicId: t.clinicB,
    name: "Priya Nair",
    mobileNumber: "9800000003",
    age: 28,
    gender: "Female",
    city: "Bengaluru",
    address: "44 Palm Grove",
    doctorId: t.iyer,
    department: "Dermatology",
    amount: 1000,
    visitDate: "2026-08-11",
    visitTime: "12:00",
  });

  // The other tenant's money. Nothing below may ever see it.
  await createRegistration(t.rivalOwnerActor, {
    clinicId: t.rivalClinic,
    name: "Rival Patient",
    mobileNumber: "9800000009",
    age: 50,
    gender: "Other",
    city: "Bengaluru",
    address: "99 Ring Road",
    doctorId: t.rivalDoctor,
    department: "ENT",
    amount: 99999,
    visitDate: "2026-08-13",
    visitTime: "10:00",
  });

  const monthly = { period: "monthly" as const };

  console.log("\nThe catalogue records what is now enforced");
  check(
    "reports:export is no longer marked pending",
    findPermission(REPORT_EXPORT_PERMISSION)?.pending === undefined,
  );
  check(
    "reports:view is still marked as covered elsewhere",
    findPermission("reports:view")?.pending === "covered-elsewhere",
  );
  check(
    "both keys are still in the catalogue",
    ALL_PERMISSIONS.includes(REPORT_EXPORT_PERMISSION) &&
      ALL_PERMISSIONS.includes("reports:view"),
  );
  check(
    "the section list is closed",
    REPORT_EXPORT_SECTIONS.length === 3 &&
      !isReportExportSection("kpis") &&
      !isReportExportSection(""),
  );

  console.log("\nThe export gate");
  const owner = await getRevenueReportForExport(t.ownerActor, monthly, NOW);
  check(
    "the wildcard exports",
    owner.kpis.totalRevenue === "1750.50",
    owner.kpis.totalRevenue,
  );

  const admin = await getRevenueReportForExport(t.adminActor, monthly, NOW);
  check(
    "the seeded Admin exports, because ALL_PERMISSIONS now carries the key",
    admin.kpis.totalRevenue === "1750.50",
    admin.kpis.totalRevenue,
  );

  const both = await getRevenueReportForExport(t.bothActor, monthly, NOW);
  check(
    "a custom role holding both gates exports",
    both.kpis.totalRevenue === "1750.50",
    both.kpis.totalRevenue,
  );

  await expectRefusal(
    "view without export is refused, naming the export gate",
    REPORT_EXPORT_PERMISSION,
    () => getRevenueReportForExport(t.viewOnlyActor, monthly, NOW),
  );

  await expectRefusal(
    "export without view is refused, naming the view gate",
    REPORT_VIEW_PERMISSION,
    () => getRevenueReportForExport(t.exportOnlyActor, monthly, NOW),
  );

  await expectRefusal(
    "Staff, who hold neither, are refused",
    REPORT_VIEW_PERMISSION,
    () => getRevenueReportForExport(t.staffActor, monthly, NOW),
  );

  await expectRefusal(
    "the seeded Doctor role cannot export revenue either",
    REPORT_VIEW_PERMISSION,
    () => getRevenueReportForExport(t.doctorActor, monthly, NOW),
  );

  console.log("\nreports:view is still inert, exactly as the catalogue says");
  await expectRefusal(
    "holding reports:view alone does not open the report",
    REPORT_VIEW_PERMISSION,
    () => getRevenueReport(t.inertActor, monthly, NOW),
  );
  await expectRefusal(
    "holding reports:view alone does not open the export",
    REPORT_VIEW_PERMISSION,
    () => getRevenueReportForExport(t.inertActor, monthly, NOW),
  );

  console.log("\nThe view gate is untouched by this stage");
  const viewOnly = await getRevenueReport(t.viewOnlyActor, monthly, NOW);
  check(
    "report:read alone still opens the report on screen",
    viewOnly.kpis.totalRevenue === "1750.50",
    viewOnly.kpis.totalRevenue,
  );
  await expectRefusal(
    "Staff are still refused the report itself",
    REPORT_VIEW_PERMISSION,
    () => getRevenueReport(t.staffActor, monthly, NOW),
  );

  console.log("\nThe two scopes intersect, rather than either one winning");
  const splitView = await getRevenueReport(t.splitActor, monthly, NOW);
  const splitExport = await getRevenueReportForExport(t.splitActor, monthly, NOW);
  check(
    "on screen they see both clinics",
    splitView.kpis.totalRevenue === "1750.50",
    splitView.kpis.totalRevenue,
  );
  check(
    "the export narrows to the clinic they may export",
    splitExport.kpis.totalRevenue === "750.50",
    splitExport.kpis.totalRevenue,
  );
  check(
    "and the export's breakdown names only that clinic",
    splitExport.byClinic.length === 1 &&
      splitExport.byClinic[0].name === "Alpha Clinic",
    splitExport.byClinic.map((row) => row.name),
  );
  check(
    "Beta's doctor is absent from the narrowed export",
    !splitExport.byDoctor.some((row) => row.name === "Dr Iyer"),
    splitExport.byDoctor.map((row) => row.name),
  );

  const disjoint = await getRevenueReportForExport(t.disjointActor, monthly, NOW);
  check(
    "gates held in different clinics export nothing, rather than either clinic",
    disjoint.kpis.totalRevenue === "0.00" && disjoint.hasClinics === false,
    disjoint.kpis.totalRevenue,
  );

  console.log("\nThe file says what the screen says");
  const onScreen = await getRevenueReport(t.ownerActor, monthly, NOW);
  const clinicsCsv = toReportCsv(owner, "clinics");
  const doctorsCsv = toReportCsv(owner, "doctors");
  const trendCsv = toReportCsv(owner, "trend");

  check(
    "the export path returns the same figures as the view path",
    JSON.stringify(onScreen) === JSON.stringify(owner),
  );
  check(
    "the clinic column totals the KPI",
    sumColumn(clinicsCsv, 2).toFixed(2) === owner.kpis.totalRevenue,
    sumColumn(clinicsCsv, 2),
  );
  check(
    "the doctor column totals the same KPI",
    sumColumn(doctorsCsv, 2).toFixed(2) === owner.kpis.totalRevenue,
    sumColumn(doctorsCsv, 2),
  );
  check(
    "the registration counts total too",
    sumColumn(clinicsCsv, 1) === owner.kpis.registrationCount,
    sumColumn(clinicsCsv, 1),
  );
  check(
    "shares total 100",
    Math.abs(sumColumn(clinicsCsv, 3) - 100) < 0.01,
    sumColumn(clinicsCsv, 3),
  );
  check(
    "one row per clinic with revenue in the window",
    dataRows(clinicsCsv).length === 2,
    dataRows(clinicsCsv),
  );
  check(
    "the trend is the graph's whole window, zero-filled",
    dataRows(trendCsv).length === owner.series.length &&
      owner.series.length === 12,
    dataRows(trendCsv).length,
  );
  check(
    "the trend's August bucket carries the month's revenue",
    dataRows(trendCsv).some((row) => row.endsWith(",1750.50")),
    dataRows(trendCsv).slice(-2),
  );

  console.log("\nNo other tenant's money reaches the file");
  for (const [name, csv] of [
    ["clinics", clinicsCsv],
    ["doctors", doctorsCsv],
    ["trend", trendCsv],
  ] as const) {
    check(`the ${name} export names no rival clinic`, !csv.includes("Rival"));
    check(`the ${name} export carries no rival revenue`, !csv.includes("99999"));
  }

  const rivalReport = await getRevenueReportForExport(
    t.rivalOwnerActor,
    monthly,
    NOW,
  );
  check(
    "the other tenant sees only its own total",
    rivalReport.kpis.totalRevenue === "99999.00",
    rivalReport.kpis.totalRevenue,
  );

  console.log("\nNaming a clinic is a filter, never an authorisation");
  const namedOther = await getRevenueReportForExport(
    t.ownerActor,
    { period: "monthly", clinicId: t.rivalClinic },
    NOW,
  );
  check(
    "naming another tenant's clinic yields zeros",
    namedOther.kpis.totalRevenue === "0.00" && namedOther.hasClinics === false,
    namedOther.kpis.totalRevenue,
  );
  check(
    "and its CSV is a header with nothing under it",
    dataRows(toReportCsv(namedOther, "clinics")).length === 0 &&
      headerOf(toReportCsv(namedOther, "clinics")).startsWith("Clinic"),
  );

  const namedOwn = await getRevenueReportForExport(
    t.ownerActor,
    { period: "monthly", clinicId: t.clinicB },
    NOW,
  );
  check(
    "naming their own clinic narrows the file to it",
    namedOwn.kpis.totalRevenue === "1000.00" &&
      dataRows(toReportCsv(namedOwn, "clinics")).length === 1,
    namedOwn.kpis.totalRevenue,
  );

  console.log("\nFilenames");
  for (const section of REPORT_EXPORT_SECTIONS) {
    const name = reportCsvFilename(owner, section as ReportExportSection);
    check(
      `${section}: safe in a Content-Disposition header`,
      /^[a-z0-9-]+\.csv$/.test(name),
      name,
    );
    check(`${section}: names the period`, name.includes("monthly"), name);
  }
  check(
    "the breakdown filename dates the window, not today",
    reportCsvFilename(owner, "clinics") ===
      "revenue-by-clinic-monthly-2026-08-01.csv",
    reportCsvFilename(owner, "clinics"),
  );
  check(
    "the trend filename spans its own twelve buckets",
    reportCsvFilename(owner, "trend") ===
      "revenue-trend-monthly-2025-09-01-to-2026-08-01.csv",
    reportCsvFilename(owner, "trend"),
  );

  console.log("\nThe registration export is unchanged by the extraction");
  const records = await listRegistrationsForExport(
    t.ownerActor,
    parseRegistrationFilters({}),
  );
  const registrationsCsv = toRegistrationCsv(records);
  check(
    "still opens with a BOM",
    registrationsCsv.startsWith(CSV_BOM),
  );
  check(
    "still carries the same fourteen columns",
    headerOf(registrationsCsv) ===
      "Patient ID,Patient Name,Age,Gender,Mobile Number,Address,City,Clinic,Doctor,Department,Visit Type,Amount (INR),Visit Date,Visit Time",
    headerOf(registrationsCsv),
  );
  check(
    "still writes money unformatted",
    registrationsCsv.includes("500.00") && !registrationsCsv.includes("₹"),
  );
  check(
    "still exports one row per visit in this tenant",
    dataRows(registrationsCsv).length === 3,
    dataRows(registrationsCsv).length,
  );
  check(
    "still names itself by the download date",
    registrationCsvFilename("2026-08-16") === "registrations-2026-08-16.csv",
  );
  check(
    "and is still gated by registration:read, not the new export key",
    // Staff hold registration:read and NOT reports:export, so the registration
    // export must keep working for them — Stage 7 gated the revenue report, not
    // the list.
    (await listRegistrationsForExport(t.staffActor, parseRegistrationFilters({})))
      .length > 0,
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

    const residue = await prisma.tenant.count({
      where: { businessName: TEST_TENANT_NAME },
    });
    if (residue > 0) {
      failures += 1;
      console.error(`\nCleanup left ${residue} tenant(s) behind.`);
    }

    await prisma.$disconnect();
    console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
    process.exitCode = failures === 0 ? 0 : 1;
  });
