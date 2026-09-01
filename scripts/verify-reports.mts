/**
 * Stage-5 verification — revenue reporting, exercised against a LOCAL database.
 *
 *     npm run verify:reports
 *
 * Builds a throwaway tenant with a known set of visits, then asserts the
 * numbers PRD §6.6 asks for against a FIXED "now", so period boundaries are
 * deterministic rather than depending on the day the script is run.
 *
 * Refuses to run unless DATABASE_URL points at localhost: it writes and deletes
 * rows, and must never be aimed at a real clinic's data.
 */
import { PermissionError } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { seedDefaultRoles } from "@/lib/defaultRoles";
import { formatRupees, formatRupeesCompact } from "@/lib/money";
import { createRegistration } from "@/lib/registrations";
import { getRevenueReport } from "@/lib/reports";
import {
  bucketKeysIn,
  currentRange,
  previousRange,
  seriesRange,
} from "@/lib/reportPeriods";

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

const TEST_TENANT_NAME = "verify-reports";

async function build() {
  const tenant = await prisma.tenant.create({
    data: {
      businessName: TEST_TENANT_NAME,
      email: `${TEST_TENANT_NAME}-${Date.now()}@example.test`,
      // Stage 3 made tenants.slug NOT NULL. Mirrors the email's uniqueness.
      slug: `${TEST_TENANT_NAME}-${Date.now()}`,
      emailVerifiedAt: new Date(),
    },
    select: { id: true },
  });

  await seedDefaultRoles(prisma, tenant.id);

  const clinicA = await prisma.clinic.create({
    data: { tenantId: tenant.id, name: "Alpha Clinic" },
    select: { id: true },
  });
  const clinicB = await prisma.clinic.create({
    data: { tenantId: tenant.id, name: "Beta Clinic" },
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

  const roles = await prisma.role.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, name: true },
  });
  const roleId = (name: string) => roles.find((role) => role.name === name)!.id;

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

  // Admin holds report:read, but only inside Clinic A.
  const clinicAdmin = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      name: "Clinic Admin",
      email: `admin-${tenant.id}@example.test`,
      passwordHash: "x",
      userRoles: { create: [{ roleId: roleId("Admin"), clinicId: clinicA.id }] },
    },
    select: { id: true },
  });

  // Staff deliberately lack report:read.
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
    rao: rao.id,
    iyer: iyer.id,
    ownerActor: { userId: owner.id, tenantId: tenant.id },
    adminActor: { userId: clinicAdmin.id, tenantId: tenant.id },
    staffActor: { userId: staff.id, tenantId: tenant.id },
  };
}

async function main(): Promise<void> {
  const t = await build();

  // ---- Known visits -------------------------------------------------------
  // Clinic A, August: 500.00 + 250.50 + 300.00 = 1050.50 across 2 patients.
  // Clinic B, August: 1000.00 across 1 patient.
  // Clinic A, July:   400.00 (the previous-month comparison).
  const first = await createRegistration(t.ownerActor, {
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

  // A follow-up by the SAME patient — must not inflate the patient count.
  await createRegistration(t.ownerActor, {
    clinicId: t.clinicA,
    patientId: first.patientId,
    name: "Ramesh Kumar",
    mobileNumber: "9800000001",
    age: 40,
    gender: "Male",
    city: "Bengaluru",
    address: "10 Main Road",
    doctorId: t.rao,
    department: "Cardiology",
    amount: 300,
    visitDate: "2026-08-15",
    visitTime: "11:00",
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

  await createRegistration(t.ownerActor, {
    clinicId: t.clinicA,
    patientId: first.patientId,
    name: "Ramesh Kumar",
    mobileNumber: "9800000001",
    age: 40,
    gender: "Male",
    city: "Bengaluru",
    address: "10 Main Road",
    doctorId: t.rao,
    department: "Cardiology",
    amount: 400,
    visitDate: "2026-07-20",
    visitTime: "10:00",
  });

  console.log("\nFR-6.1 period windows (pure date maths, UTC)");
  const month = currentRange("monthly", NOW);
  check("month starts on the 1st", month.start.toISOString() === "2026-08-01T00:00:00.000Z", month.start.toISOString());
  check("month end is exclusive", month.end.toISOString() === "2026-09-01T00:00:00.000Z", month.end.toISOString());
  check(
    "previous month is July",
    previousRange("monthly", month).start.toISOString() === "2026-07-01T00:00:00.000Z",
  );
  const year = currentRange("yearly", NOW);
  check("year starts 1 Jan", year.start.toISOString() === "2026-01-01T00:00:00.000Z");
  const week = currentRange("weekly", NOW);
  check("week starts on a Monday", week.start.getUTCDay() === 1, week.start.toISOString());
  check(
    "week is 7 days",
    week.end.getTime() - week.start.getTime() === 7 * 86400000,
  );
  check("daily series is 14 buckets", bucketKeysIn("daily", seriesRange("daily", NOW)).length === 14);
  check("weekly series is 12 buckets", bucketKeysIn("weekly", seriesRange("weekly", NOW)).length === 12);
  check("monthly series is 12 buckets", bucketKeysIn("monthly", seriesRange("monthly", NOW)).length === 12);
  check("yearly series is 5 buckets", bucketKeysIn("yearly", seriesRange("yearly", NOW)).length === 5);

  console.log("\nFR-6.2 KPIs, all clinics, monthly");
  const report = await getRevenueReport(t.ownerActor, { period: "monthly" }, NOW);
  check("total revenue", report.kpis.totalRevenue === "2050.50", report.kpis.totalRevenue);
  check("registration count", report.kpis.registrationCount === 4, report.kpis.registrationCount);
  check(
    "a follow-up is not a second patient",
    report.kpis.patientCount === 3,
    report.kpis.patientCount,
  );
  check(
    "avg revenue per patient",
    report.kpis.averageRevenuePerPatient === "683.50",
    report.kpis.averageRevenuePerPatient,
  );
  check("previous month revenue", report.kpis.previousRevenue === "400.00", report.kpis.previousRevenue);
  check(
    "growth vs previous month",
    Math.abs((report.kpis.revenueChangePercent ?? 0) - 412.625) < 0.001,
    report.kpis.revenueChangePercent,
  );
  check("range is named", report.rangeLabel === "August 2026", report.rangeLabel);

  console.log("\nFR-6.3 growth series");
  check("series length matches period", report.series.length === 12, report.series.length);
  const keys = report.series.map((point) => point.bucket);
  check("buckets ascend and are unique", keys.join() === [...new Set(keys)].sort().join());
  check("monthly buckets are month starts", keys.every((key) => key.endsWith("-01")));
  check("last bucket is the current month", keys[11] === "2026-08-01", keys[11]);
  check(
    "current bucket equals the KPI total",
    report.series[11].revenue === report.kpis.totalRevenue,
    report.series[11].revenue,
  );
  check("previous bucket holds July", report.series[10].revenue === "400.00", report.series[10].revenue);
  check(
    "empty months are zero-filled, not dropped",
    report.series.filter((point) => point.revenue === "0.00").length === 10,
  );
  check("registrations per bucket", report.series[11].registrations === 4, report.series[11].registrations);

  const daily = await getRevenueReport(t.ownerActor, { period: "daily" }, NOW);
  check("daily series is 14 long", daily.series.length === 14, daily.series.length);
  check("today has no visits yet", daily.series[13].revenue === "0.00", daily.series[13].revenue);
  const aug10 = daily.series.find((point) => point.bucket === "2026-08-10");
  check("an afternoon visit lands on its own day", aug10?.revenue === "500.00", aug10?.revenue);

  const weekly = await getRevenueReport(t.ownerActor, { period: "weekly" }, NOW);
  check(
    "weekly buckets are all Mondays",
    weekly.series.every((point) => new Date(`${point.bucket}T00:00:00Z`).getUTCDay() === 1),
  );
  const weekTotal = weekly.series.reduce((sum, point) => sum + Number(point.revenue), 0);
  check(
    "weekly series covers every visit in its window",
    Math.abs(weekTotal - 2450.5) < 0.001,
    weekTotal,
  );

  console.log("\nFR-6.4 breakdowns");
  check("both clinics listed", report.byClinic.length === 2, report.byClinic.length);
  check("clinics sort by revenue", report.byClinic[0].name === "Alpha Clinic", report.byClinic[0].name);
  check("clinic A revenue", report.byClinic[0].revenue === "1050.50", report.byClinic[0].revenue);
  check("clinic B revenue", report.byClinic[1].revenue === "1000.00", report.byClinic[1].revenue);
  check(
    "clinic shares sum to 100%",
    Math.abs(report.byClinic.reduce((sum, row) => sum + row.sharePercent, 0) - 100) < 0.001,
  );
  check(
    "clinic revenue sums to the total",
    Math.abs(report.byClinic.reduce((sum, row) => sum + Number(row.revenue), 0) - 2050.5) < 0.001,
  );

  check("three doctor rows", report.byDoctor.length === 3, report.byDoctor.length);
  check("doctors sort by revenue", report.byDoctor[0].name === "Dr Iyer", report.byDoctor[0].name);
  const rao = report.byDoctor.find((row) => row.name === "Dr Rao");
  check("a doctor's visits are summed", rao?.revenue === "800.00", rao?.revenue);
  const unassigned = report.byDoctor.find((row) => row.id === null);
  check("unassigned revenue is not dropped", unassigned?.revenue === "250.50", unassigned?.revenue);
  check("unassigned row is named", unassigned?.name === "Not assigned", unassigned?.name);
  check(
    "doctor revenue sums to the total",
    Math.abs(report.byDoctor.reduce((sum, row) => sum + Number(row.revenue), 0) - 2050.5) < 0.001,
  );

  console.log("\nPRD §9 scoping");
  await expectThrows(
    "staff cannot read reports at all",
    () => getRevenueReport(t.staffActor, { period: "monthly" }, NOW),
    (error) => error instanceof PermissionError,
  );

  const adminReport = await getRevenueReport(t.adminActor, { period: "monthly" }, NOW);
  check(
    "clinic-scoped admin sees only their clinic",
    adminReport.kpis.totalRevenue === "1050.50",
    adminReport.kpis.totalRevenue,
  );
  check("...and only their clinic in the breakdown", adminReport.byClinic.length === 1, adminReport.byClinic.length);
  check(
    "...and no sibling-clinic doctor",
    adminReport.byDoctor.every((row) => row.name !== "Dr Iyer"),
  );

  const filtered = await getRevenueReport(
    t.ownerActor,
    { period: "monthly", clinicId: t.clinicB },
    NOW,
  );
  check("clinic filter narrows the total", filtered.kpis.totalRevenue === "1000.00", filtered.kpis.totalRevenue);
  check("clinic filter names the clinic", filtered.clinicName === "Beta Clinic", filtered.clinicName);

  const outOfScope = await getRevenueReport(
    t.adminActor,
    { period: "monthly", clinicId: t.clinicB },
    NOW,
  );
  check(
    "out-of-scope clinic yields zeros, not another clinic's revenue",
    outOfScope.kpis.totalRevenue === "0.00",
    outOfScope.kpis.totalRevenue,
  );
  check("out-of-scope clinic reports no clinics", outOfScope.hasClinics === false);
  check("out-of-scope series is still zero-filled", outOfScope.series.length === 12);

  console.log("\nEmpty-period behaviour");
  const quiet = await getRevenueReport(
    t.ownerActor,
    { period: "monthly" },
    new Date("2027-03-10T10:00:00.000Z"),
  );
  check("quiet month totals zero", quiet.kpis.totalRevenue === "0.00", quiet.kpis.totalRevenue);
  check(
    "no divide-by-zero on the average",
    quiet.kpis.averageRevenuePerPatient === "0.00",
    quiet.kpis.averageRevenuePerPatient,
  );
  check(
    "growth from zero is null, not Infinity",
    quiet.kpis.revenueChangePercent === null,
    quiet.kpis.revenueChangePercent,
  );

  console.log("\nRupee display");
  check("full figure", formatRupees("2050.50") === "₹2,050.50", formatRupees("2050.50"));
  check("lakh grouping", formatRupees("150000") === "₹1,50,000.00", formatRupees("150000"));
  check("compact thousands", formatRupeesCompact(12900) === "₹12.9K", formatRupeesCompact(12900));
  check("compact lakh", formatRupeesCompact(150000) === "₹1.5L", formatRupeesCompact(150000));
  check("compact crore", formatRupeesCompact(12000000) === "₹1.2Cr", formatRupeesCompact(12000000));
  check("compact small", formatRupeesCompact(500) === "₹500", formatRupeesCompact(500));
  check("compact zero", formatRupeesCompact(0) === "₹0", formatRupeesCompact(0));
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
