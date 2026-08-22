/**
 * AP-3 verification — appointment types, booking and the board, against a LOCAL
 * database.
 *
 *     npm run verify:ap3-appointment-booking
 *
 * tests/unit/appointmentTypeRules.test.ts and
 * tests/unit/appointmentBookingRules.test.ts already pin every rule that can be
 * decided without rows. This script exists for the three things they cannot
 * reach:
 *
 *   1. AUTHORISATION over real roles — that the front desk can book and cannot
 *      re-price, that a doctor can look and not book, and that neither reaches
 *      another organisation's diary.
 *   2. The DUPLICATE CHECK, which only means anything against a real unique
 *      index and the NULL-distinct quirk it does not cover.
 *   3. CONCURRENCY. Two bookings racing for one slot is the failure this whole
 *      stage is built around, and it cannot be simulated in a unit test — it
 *      needs two transactions, a real InnoDB lock, and a genuine loser.
 *
 * Everything it creates lives under tenants named `verify-ap3-booking` and is
 * torn down at the end. Row counts on every pre-existing table are asserted
 * before and after, so a bug here that touched real data would be visible.
 *
 * Refuses to run unless DATABASE_URL points at localhost.
 */

import { prisma } from "@/lib/prisma";
import { ConflictError, BadRequestError } from "@/lib/apiHandler";
import {
  activeSlotStartForStatus,
  type AppointmentStatus,
} from "@/lib/appointmentRules";
import {
  createAppointment,
  getAppointmentSlots,
  listAppointments,
} from "@/lib/appointments";
import {
  createAppointmentType,
  listAppointmentTypes,
  updateAppointmentType,
} from "@/lib/appointmentTypes";
import { AUDIT_ACTIONS } from "@/lib/audit";
import { DEFAULT_PLAN_KEY, seedFeatureCatalogue } from "@/lib/defaultFeatures";
import { ROLE_KEYS, seedDefaultRoles } from "@/lib/defaultRoles";
import { FeatureError } from "@/lib/featureResolution";
import { PermissionError, ScopeError, type ActorContext } from "@/lib/rbac";

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
  is: (error: unknown) => boolean,
  fn: () => Promise<unknown>,
): Promise<void> {
  try {
    await fn();
    check(label, false, "did not throw");
  } catch (error: unknown) {
    check(label, is(error), error);
  }
}

const isScopeError = (error: unknown): boolean => error instanceof ScopeError;
const isPermissionError = (error: unknown): boolean =>
  error instanceof PermissionError;
const isConflictError = (error: unknown): boolean =>
  error instanceof ConflictError;
const isBadRequestError = (error: unknown): boolean =>
  error instanceof BadRequestError;

const TEST_TENANT_NAME = "verify-ap3-booking";

/** The working day every booking assertion is built on. */
const DAY = "2026-12-07";
/** A second day, used where a test must not disturb DAY. */
const OTHER_DAY = "2026-12-08";
/** A day nothing is ever configured on. */
const CLOSED_DAY = "2026-12-09";
/** A day the doctor is on leave. */
const LEAVE_DAY = "2026-12-10";

const iso = (day: string, time: string): string => `${day}T${time}:00.000Z`;
const at = (day: string, time: string): Date => new Date(iso(day, time));
const dayOnly = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

/** Distinctive enough that finding it in a response is unambiguous. */
const PII = {
  name: "Zzyzx Ap3 Patient",
  mobileNumber: "9876500099",
  address: "42 Disclosure Drive",
  city: "Leakstown",
  gender: "female",
  age: 918273,
};

// ---------------------------------------------------------------------------
// Row-count guard
// ---------------------------------------------------------------------------

async function countEverything() {
  const [
    tenants,
    clinics,
    users,
    doctors,
    patients,
    registrations,
    availability,
    leave,
    appointments,
    appointmentTypes,
    scheduleLocks,
    roles,
    userRoles,
    features,
    auditLogs,
  ] = await Promise.all([
    prisma.tenant.count(),
    prisma.clinic.count(),
    prisma.user.count(),
    prisma.doctor.count(),
    prisma.patient.count(),
    prisma.registration.count(),
    prisma.doctorAvailability.count(),
    prisma.doctorLeave.count(),
    prisma.appointment.count(),
    prisma.appointmentType.count(),
    prisma.doctorScheduleLock.count(),
    prisma.role.count(),
    prisma.userRole.count(),
    prisma.feature.count(),
    prisma.auditLog.count(),
  ]);

  return {
    tenants,
    clinics,
    users,
    doctors,
    patients,
    registrations,
    availability,
    leave,
    appointments,
    appointmentTypes,
    scheduleLocks,
    roles,
    userRoles,
    features,
    auditLogs,
  };
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

async function build() {
  const stamp = Date.now();

  await seedFeatureCatalogue(prisma);

  const plan = await prisma.plan.findUniqueOrThrow({
    where: { key: DEFAULT_PLAN_KEY },
    select: { id: true },
  });
  const appointmentsFeature = await prisma.feature.findUniqueOrThrow({
    where: { key: "appointments" },
    select: { id: true, tier: true },
  });

  const makeTenant = (suffix: string) =>
    prisma.tenant.create({
      data: {
        businessName: TEST_TENANT_NAME,
        email: `${TEST_TENANT_NAME}-${suffix}-${stamp}@example.test`,
        slug: `${TEST_TENANT_NAME}-${suffix}-${stamp}`,
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
        planId: plan.id,
      },
      select: { id: true },
    });

  const tenant = await makeTenant("main");
  // A real neighbour, so every isolation assertion has something to leak INTO
  // rather than merely failing to find a row.
  const rival = await makeTenant("rival");

  await seedDefaultRoles(prisma, tenant.id);
  await seedDefaultRoles(prisma, rival.id);

  const makeClinic = (tenantId: string, name: string) =>
    prisma.clinic.create({ data: { tenantId, name }, select: { id: true } });

  const clinic = await makeClinic(tenant.id, "AP-3 Alpha");
  const sibling = await makeClinic(tenant.id, "AP-3 Beta");
  const rivalClinic = await makeClinic(rival.id, "AP-3 Rival");

  const makeDoctor = (clinicId: string, name: string) =>
    prisma.doctor.create({
      data: { clinicId, name, department: "General Medicine" },
      select: { id: true, clinicId: true },
    });

  const doctor = await makeDoctor(clinic.id, "AP-3 Dr Alpha");
  // A second doctor at the SAME clinic — the "two doctors, one time" subject.
  const doctorTwo = await makeDoctor(clinic.id, "AP-3 Dr Alpha Two");
  const siblingDoctor = await makeDoctor(sibling.id, "AP-3 Dr Beta");
  const rivalDoctor = await makeDoctor(rivalClinic.id, "AP-3 Dr Rival");

  // A generous window, so a test can move along the day without running out.
  for (const d of [doctor, doctorTwo, siblingDoctor]) {
    for (const day of [DAY, OTHER_DAY]) {
      await prisma.doctorAvailability.create({
        data: {
          doctorId: d.id,
          date: dayOnly(day),
          startTime: "09:00",
          endTime: "17:00",
        },
      });
    }
  }

  // Available on paper, but away — leave must beat availability.
  await prisma.doctorAvailability.create({
    data: {
      doctorId: doctor.id,
      date: dayOnly(LEAVE_DAY),
      startTime: "09:00",
      endTime: "17:00",
    },
  });
  await prisma.doctorLeave.create({
    data: {
      doctorId: doctor.id,
      startDate: dayOnly(LEAVE_DAY),
      endDate: dayOnly(LEAVE_DAY),
      reason: "AP-3 fixture leave",
    },
  });

  const roleId = async (tenantId: string, key: string) =>
    (
      await prisma.role.findFirstOrThrow({
        where: { tenantId, key },
        select: { id: true },
      })
    ).id;

  const adminRoleId = await roleId(tenant.id, ROLE_KEYS.CLINIC_ADMIN);
  const receptionRoleId = await roleId(tenant.id, ROLE_KEYS.RECEPTIONIST);
  const doctorRoleId = await roleId(tenant.id, ROLE_KEYS.DOCTOR);
  const staffRoleId = await roleId(tenant.id, ROLE_KEYS.STAFF);
  const rivalAdminRoleId = await roleId(rival.id, ROLE_KEYS.CLINIC_ADMIN);

  // `appointments` is PREMIUM, so an ABSENT RoleFeatureAccess row DENIES. Every
  // role meant to reach the module needs an explicit row.
  //
  // STAFF AND DOCTOR ARE IN THIS LIST DELIBERATELY, even though neither may
  // book. The feature gate runs BEFORE the permission gate, so without a row
  // here they would be refused at layer 3 and the layer-4 refusal would never
  // be reached — the permission check would look tested when it was not.
  // Granting them the module is what isolates the permission.
  for (const id of [
    adminRoleId,
    receptionRoleId,
    doctorRoleId,
    staffRoleId,
    rivalAdminRoleId,
  ]) {
    await prisma.roleFeatureAccess.create({
      data: { roleId: id, featureId: appointmentsFeature.id, enabled: true },
    });
  }

  const makeUser = (suffix: string, tenantId: string) =>
    prisma.user.create({
      data: {
        tenantId,
        email: `${TEST_TENANT_NAME}-${suffix}-${stamp}@example.test`,
        passwordHash: "x",
        accountStatus: "ACTIVE",
        membershipStatus: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
      select: { id: true },
    });

  const adminUser = await makeUser("admin", tenant.id);
  const receptionUser = await makeUser("reception", tenant.id);
  const doctorUser = await makeUser("doctor", tenant.id);
  const staffUser = await makeUser("staff", tenant.id);
  const siblingUser = await makeUser("sibling", tenant.id);
  const noModuleUser = await makeUser("nomodule", tenant.id);
  const rivalAdminUser = await makeUser("rivaladmin", rival.id);

  const assign = (userId: string, roleId: string, clinicId: string | null) =>
    prisma.userRole.create({ data: { userId, roleId, clinicId } });

  // Tenant-wide (null clinic) reaches every clinic in the organisation, and is
  // what a tenant-wide appointment type requires.
  await assign(adminUser.id, adminRoleId, null);
  await assign(receptionUser.id, receptionRoleId, null);
  await assign(doctorUser.id, doctorRoleId, null);
  await assign(staffUser.id, staffRoleId, null);
  await assign(rivalAdminUser.id, rivalAdminRoleId, null);
  // Clinic-scoped to the SIBLING only — the clinic-isolation subject.
  await assign(siblingUser.id, receptionRoleId, sibling.id);

  // Holds the booking permission but has NO layer-3 row, so the module denies.
  const unentitledRole = await prisma.role.create({
    data: {
      tenantId: tenant.id,
      name: "AP-3 Front desk, module off",
      // No `key`: (tenant_id, key) is unique, and this is a custom role rather
      // than a second copy of a seeded one.
      permissions: ["appointment:read", "appointment:create", "doctor:read"],
      isSystem: false,
    },
    select: { id: true },
  });
  await assign(noModuleUser.id, unentitledRole.id, null);

  const actor = (userId: string, tenantId: string): ActorContext => ({
    userId,
    tenantId,
  });

  // A patient who exists at Alpha, carrying loud PII so a leak is unmistakable.
  const patient = await prisma.patient.create({
    data: {
      tenantId: tenant.id,
      clinicId: clinic.id,
      patientCode: `PT-AP3-${stamp}`,
      ...PII,
    },
    select: { id: true },
  });

  // Another organisation's patient — the ownership subject.
  const rivalPatient = await prisma.patient.create({
    data: {
      tenantId: rival.id,
      clinicId: rivalClinic.id,
      patientCode: `PT-AP3R-${stamp}`,
      name: "AP-3 Rival Patient",
      mobileNumber: "9000000001",
    },
    select: { id: true },
  });

  return {
    stamp,
    tenant,
    rival,
    clinic,
    sibling,
    rivalClinic,
    doctor,
    doctorTwo,
    siblingDoctor,
    rivalDoctor,
    patient,
    rivalPatient,
    appointmentsFeature,
    roles: { adminRoleId, receptionRoleId, doctorRoleId, staffRoleId },
    actors: {
      admin: actor(adminUser.id, tenant.id),
      reception: actor(receptionUser.id, tenant.id),
      doctor: actor(doctorUser.id, tenant.id),
      staff: actor(staffUser.id, tenant.id),
      sibling: actor(siblingUser.id, tenant.id),
      noModule: actor(noModuleUser.id, tenant.id),
      rivalAdmin: actor(rivalAdminUser.id, rival.id),
    },
  };
}

type Fixture = Awaited<ReturnType<typeof build>>;

async function teardown(fixture: Fixture): Promise<void> {
  for (const tenantId of [fixture.tenant.id, fixture.rival.id]) {
    // RESTRICT foreign keys mean the children go first. Nothing in the APP ever
    // deletes an appointment — this is fixture teardown, not a supported
    // operation.
    await prisma.registration.deleteMany({ where: { clinic: { tenantId } } });
    await prisma.appointment.updateMany({
      where: { tenantId },
      data: { rescheduledFromId: null },
    });
    await prisma.appointment.deleteMany({ where: { tenantId } });
    await prisma.appointmentType.deleteMany({ where: { tenantId } });
    // Locks are created on demand by booking and never cleaned up in
    // production, so teardown is the only place they are removed. Appointments
    // are already gone above, so nothing depends on them.
    await prisma.doctorScheduleLock.deleteMany({
      where: { doctor: { clinic: { tenantId } } },
    });
    await prisma.auditLog.deleteMany({ where: { actorTenantId: tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
  }
}

/**
 * Removes fixture tenants an interrupted earlier run left behind, so the
 * row-count baseline below is taken against a clean database and the script is
 * genuinely idempotent.
 */
async function sweepLeftovers(): Promise<void> {
  const stale = await prisma.tenant.findMany({
    where: { businessName: TEST_TENANT_NAME },
    select: { id: true },
  });

  for (const tenant of stale) {
    await prisma.registration.deleteMany({
      where: { clinic: { tenantId: tenant.id } },
    });
    await prisma.appointment.updateMany({
      where: { tenantId: tenant.id },
      data: { rescheduledFromId: null },
    });
    await prisma.appointment.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.appointmentType.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.doctorScheduleLock.deleteMany({
      where: { doctor: { clinic: { tenantId: tenant.id } } },
    });
    await prisma.auditLog.deleteMany({ where: { actorTenantId: tenant.id } });
    await prisma.tenant.delete({ where: { id: tenant.id } });
  }

  if (stale.length > 0) {
    console.log(`  (swept ${stale.length} leftover fixture tenant(s))`);
  }
}

// ---------------------------------------------------------------------------
// Appointment types
// ---------------------------------------------------------------------------

interface TypeIds {
  tenantWide: string;
  clinicSpecific: string;
  siblingSpecific: string;
  retired: string;
  rival: string;
  quarterHour: string;
  long: string;
}

async function checkAppointmentTypes(f: Fixture): Promise<TypeIds> {
  console.log("\nAppointment types");

  const tenantWide = await createAppointmentType(f.actors.admin, {
    name: "Consultation",
    durationMinutes: 30,
    defaultAmount: 500,
  });

  check(
    "an admin creates a tenant-wide type",
    tenantWide.clinicId === null && tenantWide.name === "Consultation",
    tenantWide,
  );

  check(
    "the price is stored to two decimals",
    tenantWide.defaultAmount === "500.00",
    tenantWide.defaultAmount,
  );

  const clinicSpecific = await createAppointmentType(f.actors.admin, {
    clinicId: f.clinic.id,
    name: "Alpha Deep Clean",
    durationMinutes: 45,
    defaultAmount: 1200.5,
  });

  check(
    "an admin creates a clinic-specific type",
    clinicSpecific.clinicId === f.clinic.id,
    clinicSpecific,
  );

  const quarterHour = await createAppointmentType(f.actors.admin, {
    name: "Quick Review",
    durationMinutes: 15,
    defaultAmount: 250,
  });

  // Long enough to CONTAIN a 30-minute booking. Every duration here is chosen
  // so its grid, generated from 09:00, lands on the boundaries the overlap
  // matrix below needs: 90 minutes gives 09:00, 10:30, 12:00, 13:30…
  const long = await createAppointmentType(f.actors.admin, {
    name: "Extended Assessment",
    durationMinutes: 90,
    defaultAmount: 2000,
  });

  // --- Duplicates ---------------------------------------------------------

  await expectThrows(
    "a second tenant-wide type with the same name is refused",
    isConflictError,
    () =>
      createAppointmentType(f.actors.admin, {
        name: "Consultation",
        durationMinutes: 30,
        defaultAmount: 500,
      }),
  );

  await expectThrows(
    "...and the check is case-insensitive, which the unique index is not",
    isConflictError,
    () =>
      createAppointmentType(f.actors.admin, {
        name: "  consultation ",
        durationMinutes: 30,
        defaultAmount: 500,
      }),
  );

  await expectThrows(
    "a duplicate name at the same clinic is refused",
    isConflictError,
    () =>
      createAppointmentType(f.actors.admin, {
        clinicId: f.clinic.id,
        name: "alpha deep clean",
        durationMinutes: 45,
        defaultAmount: 1200.5,
      }),
  );

  // The same service at another site is the ordinary case, not a clash.
  const siblingSpecific = await createAppointmentType(f.actors.admin, {
    clinicId: f.sibling.id,
    name: "Alpha Deep Clean",
    durationMinutes: 45,
    defaultAmount: 1300,
  });

  check(
    "the same name is allowed at a different clinic",
    siblingSpecific.clinicId === f.sibling.id,
    siblingSpecific,
  );

  check(
    "a clinic-specific name does not collide with a tenant-wide one",
    (
      await createAppointmentType(f.actors.admin, {
        clinicId: f.clinic.id,
        name: "Consultation",
        durationMinutes: 20,
        defaultAmount: 400,
      })
    ).clinicId === f.clinic.id,
  );

  // --- Retirement ---------------------------------------------------------

  const retiredSeed = await createAppointmentType(f.actors.admin, {
    name: "Withdrawn Service",
    durationMinutes: 30,
    defaultAmount: 100,
  });

  const retired = await updateAppointmentType(f.actors.admin, retiredSeed.id, {
    isActive: false,
  });

  check("a type can be retired", retired.isActive === false, retired);

  // --- Who may manage -----------------------------------------------------

  await expectThrows(
    "a receptionist cannot create a type",
    isPermissionError,
    () =>
      createAppointmentType(f.actors.reception, {
        name: "Receptionist's own price list",
        durationMinutes: 30,
        defaultAmount: 1,
      }),
  );

  await expectThrows(
    "a doctor cannot create a type",
    isPermissionError,
    () =>
      createAppointmentType(f.actors.doctor, {
        name: "Doctor's own price list",
        durationMinutes: 30,
        defaultAmount: 1,
      }),
  );

  await expectThrows(
    "staff cannot create a type",
    isPermissionError,
    () =>
      createAppointmentType(f.actors.staff, {
        name: "Staff's own price list",
        durationMinutes: 30,
        defaultAmount: 1,
      }),
  );

  await expectThrows(
    "a receptionist cannot re-price a type either",
    isPermissionError,
    () =>
      updateAppointmentType(f.actors.reception, tenantWide.id, {
        defaultAmount: 0,
      }),
  );

  await expectThrows(
    "another organisation cannot touch this one's type",
    isScopeError,
    () =>
      updateAppointmentType(f.actors.rivalAdmin, tenantWide.id, {
        name: "Hijacked",
      }),
  );

  // A clinic-scoped receptionist has the permission nowhere tenant-wide, so a
  // tenant-wide type is beyond them even though they can reach a clinic.
  await expectThrows(
    "a clinic-scoped user cannot create a tenant-wide type",
    isPermissionError,
    () =>
      createAppointmentType(f.actors.sibling, {
        name: "Sneaked in tenant-wide",
        durationMinutes: 30,
        defaultAmount: 1,
      }),
  );

  // --- Listing ------------------------------------------------------------

  const rivalType = await createAppointmentType(f.actors.rivalAdmin, {
    name: "Rival Consultation",
    durationMinutes: 30,
    defaultAmount: 900,
  });

  const visible = await listAppointmentTypes(f.actors.reception, {
    clinicId: f.clinic.id,
  });
  const visibleIds = visible.map((row) => row.id);

  check(
    "the booking list shows the tenant-wide type",
    visibleIds.includes(tenantWide.id),
    visibleIds,
  );
  check(
    "...and this clinic's own type",
    visibleIds.includes(clinicSpecific.id),
    visibleIds,
  );
  check(
    "...but not a sibling clinic's type",
    !visibleIds.includes(siblingSpecific.id),
    visibleIds,
  );
  check(
    "...nor another organisation's type",
    !visibleIds.includes(rivalType.id),
    visibleIds,
  );
  check(
    "...nor a retired one",
    !visibleIds.includes(retired.id),
    visibleIds,
  );

  const withRetired = await listAppointmentTypes(f.actors.admin, {
    clinicId: f.clinic.id,
    includeInactive: true,
  });

  check(
    "an admin may ask to see retired types",
    withRetired.map((row) => row.id).includes(retired.id),
  );

  const receptionAsking = await listAppointmentTypes(f.actors.reception, {
    clinicId: f.clinic.id,
    includeInactive: true,
  });

  check(
    "a receptionist asking for retired types still does not get them",
    !receptionAsking.map((row) => row.id).includes(retired.id),
  );

  await expectThrows(
    "staff cannot read the price list at all",
    isPermissionError,
    () => listAppointmentTypes(f.actors.staff, { clinicId: f.clinic.id }),
  );

  return {
    tenantWide: tenantWide.id,
    clinicSpecific: clinicSpecific.id,
    siblingSpecific: siblingSpecific.id,
    retired: retired.id,
    rival: rivalType.id,
    quarterHour: quarterHour.id,
    long: long.id,
  };
}

// ---------------------------------------------------------------------------
// Booking — the happy path and what it writes
// ---------------------------------------------------------------------------

const booking = (f: Fixture, typeId: string, start: string, end: string) => ({
  clinicId: f.clinic.id,
  doctorId: f.doctor.id,
  appointmentTypeId: typeId,
  name: "Ravi Kumar",
  mobileNumber: "9876500123",
  slotStart: iso(DAY, start),
  slotEnd: iso(DAY, end),
});

async function checkBooking(f: Fixture, types: TypeIds): Promise<string> {
  console.log("\nBooking");

  const before = await countEverything();

  const created = await createAppointment(
    f.actors.reception,
    booking(f, types.tenantWide, "09:00", "09:30"),
  );

  check("a receptionist can book", Boolean(created.id), created);
  check("the booking is SCHEDULED", created.status === "SCHEDULED", created.status);
  check(
    "the amount comes from the type, not the request",
    created.amount === "500.00",
    created.amount,
  );
  check(
    "a new patient booking leaves patientId null",
    created.patientId === null,
    created.patientId,
  );

  const row = await prisma.appointment.findUniqueOrThrow({
    where: { id: created.id },
    select: {
      tenantId: true,
      clinicId: true,
      doctorId: true,
      activeSlotStart: true,
      slotStart: true,
      status: true,
      bookedById: true,
      amount: true,
    },
  });

  check(
    "activeSlotStart equals slotStart on a live booking",
    row.activeSlotStart?.getTime() === row.slotStart.getTime(),
    row,
  );
  check(
    "the tenant is derived from the clinic",
    row.tenantId === f.tenant.id,
    row.tenantId,
  );
  check(
    "bookedById is the session's user",
    row.bookedById === f.actors.reception.userId,
    row.bookedById,
  );
  check(
    "the stored amount matches the type's price",
    row.amount.toFixed(2) === "500.00",
    row.amount.toFixed(2),
  );

  const after = await countEverything();

  check(
    "booking creates no Patient",
    after.patients === before.patients,
    { before: before.patients, after: after.patients },
  );
  check(
    "booking creates no Registration",
    after.registrations === before.registrations,
    { before: before.registrations, after: after.registrations },
  );
  check(
    "booking mints no patient code",
    (await prisma.patient.count({ where: { tenantId: f.tenant.id } })) === 1,
  );
  check(
    "booking creates exactly one appointment",
    after.appointments === before.appointments + 1,
  );
  check(
    "booking creates the doctor-day lock row",
    after.scheduleLocks === before.scheduleLocks + 1,
  );

  // A second booking on the same doctor-day must REUSE the lock row rather
  // than create a second one, or the lock would be split in two.
  await createAppointment(
    f.actors.admin,
    booking(f, types.tenantWide, "10:00", "10:30"),
  );

  const afterSecond = await countEverything();
  check(
    "a second booking that day reuses the same lock row",
    afterSecond.scheduleLocks === after.scheduleLocks,
    { before: after.scheduleLocks, after: afterSecond.scheduleLocks },
  );
  check("an admin can book too", afterSecond.appointments === after.appointments + 1);

  // --- An existing patient -------------------------------------------------

  const forPatient = await createAppointment(f.actors.reception, {
    ...booking(f, types.tenantWide, "11:00", "11:30"),
    patientId: f.patient.id,
  });

  check(
    "a booking for an existing patient links to them",
    forPatient.patientId === f.patient.id,
    forPatient.patientId,
  );

  const patientRow = await prisma.patient.findUniqueOrThrow({
    where: { id: f.patient.id },
    select: { name: true, mobileNumber: true },
  });

  check(
    "booking does not rewrite the authoritative patient record",
    patientRow.name === PII.name && patientRow.mobileNumber === PII.mobileNumber,
    patientRow,
  );

  return created.id;
}

// ---------------------------------------------------------------------------
// Booking — authorisation
// ---------------------------------------------------------------------------

async function checkBookingAuthorisation(
  f: Fixture,
  types: TypeIds,
): Promise<void> {
  console.log("\nBooking authorisation");

  await expectThrows(
    "a doctor cannot book",
    isPermissionError,
    () =>
      createAppointment(
        f.actors.doctor,
        booking(f, types.tenantWide, "12:00", "12:30"),
      ),
  );

  await expectThrows(
    "staff cannot book",
    isPermissionError,
    () =>
      createAppointment(
        f.actors.staff,
        booking(f, types.tenantWide, "12:00", "12:30"),
      ),
  );

  await expectThrows(
    "a role without the module is refused even holding appointment:create",
    (error) => error instanceof FeatureError,
    () =>
      createAppointment(
        f.actors.noModule,
        booking(f, types.tenantWide, "12:00", "12:30"),
      ),
  );

  await expectThrows(
    "a user scoped to a sibling clinic cannot book here",
    isPermissionError,
    () =>
      createAppointment(
        f.actors.sibling,
        booking(f, types.tenantWide, "12:00", "12:30"),
      ),
  );

  await expectThrows(
    "another organisation cannot book into this clinic",
    isScopeError,
    () =>
      createAppointment(
        f.actors.rivalAdmin,
        booking(f, types.tenantWide, "12:00", "12:30"),
      ),
  );

  await expectThrows(
    "a doctor from another clinic is not bookable here",
    isScopeError,
    () =>
      createAppointment(f.actors.reception, {
        ...booking(f, types.tenantWide, "12:00", "12:30"),
        doctorId: f.siblingDoctor.id,
      }),
  );

  await expectThrows(
    "a doctor from another organisation is not found",
    isScopeError,
    () =>
      createAppointment(f.actors.reception, {
        ...booking(f, types.tenantWide, "12:00", "12:30"),
        doctorId: f.rivalDoctor.id,
      }),
  );

  await expectThrows(
    "a retired type cannot be booked",
    isScopeError,
    () =>
      createAppointment(
        f.actors.reception,
        booking(f, types.retired, "12:00", "12:30"),
      ),
  );

  await expectThrows(
    "another organisation's type cannot be booked",
    isScopeError,
    () =>
      createAppointment(
        f.actors.reception,
        booking(f, types.rival, "12:00", "12:30"),
      ),
  );

  await expectThrows(
    "a sibling clinic's type cannot be booked here",
    isScopeError,
    () =>
      createAppointment(
        f.actors.reception,
        booking(f, types.siblingSpecific, "12:00", "12:45"),
      ),
  );

  await expectThrows(
    "another organisation's patient cannot be attached",
    isScopeError,
    () =>
      createAppointment(f.actors.reception, {
        ...booking(f, types.tenantWide, "12:00", "12:30"),
        patientId: f.rivalPatient.id,
      }),
  );

  // --- Interval validation -------------------------------------------------

  await expectThrows(
    "a slot whose length disagrees with the type is refused",
    isBadRequestError,
    () =>
      createAppointment(
        f.actors.reception,
        booking(f, types.tenantWide, "12:00", "12:45"),
      ),
  );

  await expectThrows(
    "an end before the start is refused",
    isBadRequestError,
    () =>
      createAppointment(f.actors.reception, {
        ...booking(f, types.tenantWide, "12:00", "12:30"),
        slotStart: iso(DAY, "12:30"),
        slotEnd: iso(DAY, "12:00"),
      }),
  );

  await expectThrows(
    "a slot that is not on the doctor's grid is refused",
    isBadRequestError,
    () =>
      createAppointment(
        f.actors.reception,
        // 12:07 is inside the window but not a generated candidate.
        booking(f, types.tenantWide, "12:07", "12:37"),
      ),
  );

  await expectThrows(
    "a slot outside the availability window is refused",
    isBadRequestError,
    () =>
      createAppointment(
        f.actors.reception,
        booking(f, types.tenantWide, "18:00", "18:30"),
      ),
  );

  await expectThrows(
    "a day with no availability at all is refused",
    isConflictError,
    () =>
      createAppointment(f.actors.reception, {
        ...booking(f, types.tenantWide, "09:00", "09:30"),
        slotStart: iso(CLOSED_DAY, "09:00"),
        slotEnd: iso(CLOSED_DAY, "09:30"),
      }),
  );

  await expectThrows(
    "a day the doctor is on leave is refused, despite the window existing",
    isConflictError,
    () =>
      createAppointment(f.actors.reception, {
        ...booking(f, types.tenantWide, "09:00", "09:30"),
        slotStart: iso(LEAVE_DAY, "09:00"),
        slotEnd: iso(LEAVE_DAY, "09:30"),
      }),
  );
}

// ---------------------------------------------------------------------------
// Overlap
// ---------------------------------------------------------------------------

async function checkOverlap(f: Fixture, types: TypeIds): Promise<void> {
  console.log("\nOverlap — half-open [start, end)");

  // 14:00-14:30 is the anchor every case below is measured against.
  await createAppointment(
    f.actors.reception,
    booking(f, types.tenantWide, "14:00", "14:30"),
  );

  await expectThrows("an identical slot is refused", isConflictError, () =>
    createAppointment(
      f.actors.reception,
      booking(f, types.tenantWide, "14:00", "14:30"),
    ),
  );

  // Each case below uses whichever type's grid actually lands on the boundary
  // the case needs — a slot off its own grid is refused for a DIFFERENT reason
  // (BadRequestError), which would make the overlap assertion prove nothing.
  await expectThrows(
    "a shorter slot contained by the booking is refused",
    isConflictError,
    () =>
      // 15-minute grid: …13:45, 14:00, 14:15. Sits wholly inside 14:00-14:30.
      createAppointment(
        f.actors.reception,
        booking(f, types.quarterHour, "14:15", "14:30"),
      ),
  );

  await expectThrows(
    "a left-overlapping slot is refused",
    isConflictError,
    () =>
      // 45-minute grid: …12:45, 13:30, 14:15. 13:30-14:15 straddles the start.
      createAppointment(
        f.actors.reception,
        booking(f, types.clinicSpecific, "13:30", "14:15"),
      ),
  );

  await expectThrows(
    "a right-overlapping slot is refused",
    isConflictError,
    () =>
      // Same 45-minute grid, one step on: 14:15-15:00 straddles the end.
      createAppointment(
        f.actors.reception,
        booking(f, types.clinicSpecific, "14:15", "15:00"),
      ),
  );

  await expectThrows(
    "a longer slot containing the booking is refused",
    isConflictError,
    () =>
      // 90-minute grid: 09:00, 10:30, 12:00, 13:30. 13:30-15:00 swallows it.
      createAppointment(
        f.actors.reception,
        booking(f, types.long, "13:30", "15:00"),
      ),
  );

  // Half-open: touching end-to-start is NOT an overlap, and a clinic that could
  // not book back-to-back would be unusable.
  const before = await createAppointment(
    f.actors.reception,
    booking(f, types.quarterHour, "13:45", "14:00"),
  );
  check("an adjacent slot ending at the start is allowed", Boolean(before.id));

  const afterSlot = await createAppointment(
    f.actors.reception,
    booking(f, types.quarterHour, "14:30", "14:45"),
  );
  check("an adjacent slot starting at the end is allowed", Boolean(afterSlot.id));

  // Another doctor's diary is a different diary.
  const otherDoctor = await createAppointment(f.actors.reception, {
    ...booking(f, types.tenantWide, "14:00", "14:30"),
    doctorId: f.doctorTwo.id,
  });
  check(
    "a different doctor can take the same time",
    Boolean(otherDoctor.id),
    otherDoctor.id,
  );
}

// ---------------------------------------------------------------------------
// Which statuses hold a slot
// ---------------------------------------------------------------------------

async function checkStatusOccupancy(f: Fixture, types: TypeIds): Promise<void> {
  console.log("\nOccupancy by status");

  // AP-4 owns the endpoints that produce these statuses, so the rows are made
  // directly. `activeSlotStartForStatus` is the same helper the booking path
  // uses, so the fixture cannot disagree with production about what "busy"
  // means.
  const probe = async (status: AppointmentStatus, time: string) => {
    const slotStart = at(OTHER_DAY, time);
    const slotEnd = new Date(slotStart.getTime() + 30 * 60_000);

    const seeded = await prisma.appointment.create({
      data: {
        tenantId: f.tenant.id,
        clinicId: f.clinic.id,
        doctorId: f.doctor.id,
        appointmentTypeId: types.tenantWide,
        name: "AP-3 Status Probe",
        mobileNumber: "9000000002",
        amount: "500.00",
        slotStart,
        slotEnd,
        activeSlotStart: activeSlotStartForStatus(status, slotStart),
        status,
        bookedById: f.actors.admin.userId,
      },
      select: { id: true },
    });

    let booked = true;
    try {
      const created = await createAppointment(f.actors.reception, {
        ...booking(f, types.tenantWide, "09:00", "09:30"),
        slotStart: iso(OTHER_DAY, time),
        slotEnd: iso(
          OTHER_DAY,
          `${String(Number(time.slice(0, 2))).padStart(2, "0")}:30`,
        ),
      });
      booked = false;
      await prisma.appointment.delete({ where: { id: created.id } });
    } catch (error: unknown) {
      booked = isConflictError(error);
      if (!booked) throw error;
    }

    await prisma.appointment.delete({ where: { id: seeded.id } });
    return booked;
  };

  check("a SCHEDULED appointment blocks the slot", await probe("SCHEDULED", "09:00"));
  check("a CONFIRMED appointment blocks the slot", await probe("CONFIRMED", "09:00"));
  check("a CHECKED_IN appointment blocks the slot", await probe("CHECKED_IN", "09:00"));
  check(
    "a CONVERTED appointment blocks the slot — the visit consumed the time",
    await probe("CONVERTED", "09:00"),
  );

  check(
    "a CANCELLED appointment leaves the slot free",
    !(await probe("CANCELLED", "09:00")),
  );
  check(
    "a NO_SHOW appointment leaves the slot free",
    !(await probe("NO_SHOW", "09:00")),
  );
  check(
    "a RESCHEDULED appointment leaves the slot free",
    !(await probe("RESCHEDULED", "09:00")),
  );
}

// ---------------------------------------------------------------------------
// Concurrency — the reason this stage exists
// ---------------------------------------------------------------------------

async function checkConcurrency(f: Fixture, types: TypeIds): Promise<void> {
  console.log("\nConcurrency");

  /**
   * Both bookings are dispatched without awaiting the first, so they are in
   * flight together on separate pooled connections. The DoctorScheduleLock row
   * is what serialises them: the loser blocks on the SELECT ... FOR UPDATE until
   * the winner commits, then sees the winner's row in its own overlap query.
   */
  const race = async (a: () => Promise<unknown>, b: () => Promise<unknown>) => {
    const [first, second] = await Promise.allSettled([a(), b()]);
    return {
      wins: [first, second].filter((r) => r.status === "fulfilled").length,
      losses: [first, second].filter((r) => r.status === "rejected"),
    };
  };

  // --- Identical slots -----------------------------------------------------

  const identical = await race(
    () =>
      createAppointment(f.actors.reception, {
        ...booking(f, types.tenantWide, "15:00", "15:30"),
      }),
    () =>
      createAppointment(f.actors.admin, {
        ...booking(f, types.tenantWide, "15:00", "15:30"),
      }),
  );

  check(
    "two identical bookings racing produce exactly one appointment",
    identical.wins === 1,
    identical,
  );
  check(
    "the loser gets the safe conflict message, not a deadlock",
    identical.losses.length === 1 &&
      isConflictError((identical.losses[0] as PromiseRejectedResult).reason),
    identical.losses.map((l) => (l as PromiseRejectedResult).reason),
  );
  check(
    "the conflict message names nobody",
    identical.losses.every((l) => {
      const message = String((l as PromiseRejectedResult).reason?.message ?? "");
      return (
        message === "This time slot was just booked. Please select another slot."
      );
    }),
  );
  check(
    "exactly one row exists at that time",
    (await prisma.appointment.count({
      where: { doctorId: f.doctor.id, slotStart: at(DAY, "15:00") },
    })) === 1,
  );

  // --- Partial overlap -----------------------------------------------------

  const overlapping = await race(
    () =>
      createAppointment(f.actors.reception, {
        ...booking(f, types.tenantWide, "16:00", "16:30"),
      }),
    () =>
      createAppointment(f.actors.admin, {
        ...booking(f, types.quarterHour, "16:15", "16:30"),
      }),
  );

  check(
    "two partially overlapping bookings racing produce exactly one appointment",
    overlapping.wins === 1,
    overlapping,
  );
  check(
    "the overlapping loser is a conflict, not an error",
    overlapping.losses.every((l) =>
      isConflictError((l as PromiseRejectedResult).reason),
    ),
    overlapping.losses.map((l) => (l as PromiseRejectedResult).reason),
  );

  // --- Different doctors ---------------------------------------------------

  // The case REPEATABLE READ would deadlock on: two bookings at the same time
  // of day for different doctors, scanning the same index range. Under READ
  // COMMITTED there are no gap locks and both must simply succeed.
  const differentDoctors = await race(
    () =>
      createAppointment(f.actors.reception, {
        ...booking(f, types.tenantWide, "16:45", "17:00"),
        appointmentTypeId: types.quarterHour,
      }),
    () =>
      createAppointment(f.actors.admin, {
        ...booking(f, types.tenantWide, "16:45", "17:00"),
        appointmentTypeId: types.quarterHour,
        doctorId: f.doctorTwo.id,
      }),
  );

  check(
    "two doctors booked at the same time both succeed — no gap-lock deadlock",
    differentDoctors.wins === 2,
    differentDoctors.losses.map((l) => (l as PromiseRejectedResult).reason),
  );

  // --- Adjacent, concurrently ---------------------------------------------

  const adjacent = await race(
    () =>
      createAppointment(f.actors.reception, {
        ...booking(f, types.quarterHour, "13:00", "13:15"),
      }),
    () =>
      createAppointment(f.actors.admin, {
        ...booking(f, types.quarterHour, "13:15", "13:30"),
      }),
  );

  check(
    "two adjacent bookings racing both succeed",
    adjacent.wins === 2,
    adjacent.losses.map((l) => (l as PromiseRejectedResult).reason),
  );

  const locks = await prisma.doctorScheduleLock.findMany({
    where: { doctor: { clinic: { tenantId: f.tenant.id } } },
    select: { doctorId: true, date: true },
  });

  check(
    "there is never more than one lock row per doctor-day",
    locks.length ===
      new Set(locks.map((l) => `${l.doctorId}@${l.date.toISOString()}`)).size,
    locks.length,
  );

  // The lock INSERT happens INSIDE the transaction, so a booking that is
  // refused rolls its lock row back with it. CLOSED_DAY was attempted and
  // refused earlier and has never had a successful booking, so it must have
  // left no residue at all.
  check(
    "a refused booking leaves no lock row behind",
    !locks.some(
      (l) =>
        l.doctorId === f.doctor.id &&
        l.date.toISOString().slice(0, 10) === CLOSED_DAY,
    ),
    locks.map((l) => l.date.toISOString().slice(0, 10)),
  );
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

async function checkList(f: Fixture, types: TypeIds): Promise<void> {
  console.log("\nThe board");

  const board = await listAppointments(f.actors.reception, {
    clinicId: f.clinic.id,
    date: DAY,
  });

  check("the board returns this clinic's day", board.rows.length > 0, board.total);
  check(
    "every row is on the requested day",
    board.rows.every((row) => row.date === DAY),
    board.rows.map((row) => row.date),
  );
  check(
    "rows are ordered by start time",
    board.rows.every(
      (row, index) =>
        index === 0 || board.rows[index - 1].slotStart <= row.slotStart,
    ),
    board.rows.map((row) => row.startTime),
  );
  check(
    "the board carries the joined names",
    board.rows.every(
      (row) => row.doctorName.length > 0 && row.appointmentTypeName.length > 0,
    ),
  );

  // --- History -------------------------------------------------------------

  const cancelled = await prisma.appointment.create({
    data: {
      tenantId: f.tenant.id,
      clinicId: f.clinic.id,
      doctorId: f.doctor.id,
      appointmentTypeId: types.tenantWide,
      name: "AP-3 Cancelled Fixture",
      mobileNumber: "9000000003",
      amount: "500.00",
      slotStart: at(DAY, "08:00"),
      slotEnd: at(DAY, "08:30"),
      activeSlotStart: activeSlotStartForStatus("CANCELLED", at(DAY, "08:00")),
      status: "CANCELLED",
      bookedById: f.actors.admin.userId,
    },
    select: { id: true },
  });

  const defaultBoard = await listAppointments(f.actors.reception, {
    clinicId: f.clinic.id,
    date: DAY,
  });

  check(
    "a cancelled appointment is off the board by default",
    !defaultBoard.rows.map((row) => row.id).includes(cancelled.id),
  );

  const withHistory = await listAppointments(f.actors.reception, {
    clinicId: f.clinic.id,
    date: DAY,
    includeHistory: true,
  });

  check(
    "...and back on it when history is asked for",
    withHistory.rows.map((row) => row.id).includes(cancelled.id),
  );

  const cancelledOnly = await listAppointments(f.actors.reception, {
    clinicId: f.clinic.id,
    date: DAY,
    status: "CANCELLED",
  });

  check(
    "naming a status narrows to it",
    cancelledOnly.rows.length === 1 && cancelledOnly.rows[0].id === cancelled.id,
    cancelledOnly.rows.map((row) => row.status),
  );

  // Nothing is ever deleted — the row is still there, just hidden.
  check(
    "the hidden row still exists in storage",
    (await prisma.appointment.count({ where: { id: cancelled.id } })) === 1,
  );

  // --- Filters -------------------------------------------------------------

  const byDoctor = await listAppointments(f.actors.reception, {
    clinicId: f.clinic.id,
    date: DAY,
    doctorId: f.doctorTwo.id,
  });

  check(
    "the doctor filter narrows to that doctor",
    byDoctor.rows.every((row) => row.doctorId === f.doctorTwo.id),
    byDoctor.rows.map((row) => row.doctorId),
  );

  const otherDay = await listAppointments(f.actors.reception, {
    clinicId: f.clinic.id,
    date: CLOSED_DAY,
  });
  check("a day with nothing on it is empty", otherDay.rows.length === 0);

  const range = await listAppointments(f.actors.reception, {
    clinicId: f.clinic.id,
    dateFrom: DAY,
    dateTo: OTHER_DAY,
  });
  check(
    "a range covers both ends inclusively",
    range.rows.some((row) => row.date === DAY),
    range.rows.map((row) => row.date),
  );

  // --- Isolation -----------------------------------------------------------

  const rivalBoard = await listAppointments(f.actors.rivalAdmin, {});
  check(
    "another organisation sees none of this one's appointments",
    rivalBoard.rows.length === 0,
    rivalBoard.total,
  );

  const rivalNamingOurClinic = await listAppointments(f.actors.rivalAdmin, {
    clinicId: f.clinic.id,
  });
  check(
    "...and naming our clinic id returns nothing rather than widening",
    rivalNamingOurClinic.rows.length === 0,
  );

  const siblingScoped = await listAppointments(f.actors.sibling, {});
  check(
    "a clinic-scoped user sees only their own clinic",
    siblingScoped.rows.every((row) => row.clinicId === f.sibling.id),
    siblingScoped.rows.map((row) => row.clinicId),
  );

  const siblingNamingAlpha = await listAppointments(f.actors.sibling, {
    clinicId: f.clinic.id,
  });
  check(
    "...and naming a clinic they cannot reach returns nothing",
    siblingNamingAlpha.rows.length === 0,
  );

  // An EMPTY BOARD, not a 403 — matching lib/registrations.ts, which answers a
  // caller who reaches no clinic the same way. A list that threw would make
  // "you have no appointments today" and "you may not look" different-looking
  // outcomes on a screen where the second is not the user's business. What
  // matters is that no row reaches them, which is what is asserted.
  const staffBoard = await listAppointments(f.actors.staff, {
    clinicId: f.clinic.id,
  });
  check(
    "staff, holding no appointment:read, see an empty board",
    staffBoard.rows.length === 0 && staffBoard.total === 0,
    staffBoard.total,
  );

  check(
    "a doctor may read the board",
    (await listAppointments(f.actors.doctor, { clinicId: f.clinic.id })).rows
      .length > 0,
  );

  // --- Safety --------------------------------------------------------------

  const sample = withHistory.rows[0];
  const keys = Object.keys(sample).sort();

  check(
    "a board row carries only the approved fields",
    keys.every((key) =>
      [
        "id",
        "clinicId",
        "clinicName",
        "doctorId",
        "doctorName",
        "appointmentTypeId",
        "appointmentTypeName",
        "patientId",
        "name",
        "mobileNumber",
        "amount",
        "date",
        "startTime",
        "endTime",
        "slotStart",
        "slotEnd",
        "status",
        "createdAt",
      ].includes(key),
    ),
    keys,
  );

  const serialised = JSON.stringify(withHistory);
  for (const [field, value] of [
    ["address", PII.address],
    ["city", PII.city],
    ["patient code", `PT-AP3-${f.stamp}`],
  ] as const) {
    check(`no patient ${field} on the board`, !serialised.includes(value));
  }
  check("no age on the board", !serialised.includes(String(PII.age)));

  await prisma.appointment.delete({ where: { id: cancelled.id } });
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

async function checkAudit(f: Fixture, bookingId: string): Promise<void> {
  console.log("\nAudit");

  const bookingRows = await prisma.auditLog.findMany({
    where: {
      actorTenantId: f.tenant.id,
      action: AUDIT_ACTIONS.APPOINTMENT_CREATED,
      targetId: bookingId,
    },
    select: { targetType: true, actorUserId: true, afterValue: true },
  });

  check(
    "the booking wrote exactly one audit row",
    bookingRows.length === 1,
    bookingRows.length,
  );
  check(
    "it points at the appointment",
    bookingRows[0]?.targetType === "Appointment",
    bookingRows[0]?.targetType,
  );
  check(
    "it records who booked",
    bookingRows[0]?.actorUserId === f.actors.reception.userId,
  );

  const typeRows = await prisma.auditLog.findMany({
    where: { actorTenantId: f.tenant.id, targetType: "AppointmentType" },
    select: { action: true },
  });
  const actions = new Set(typeRows.map((row) => row.action));

  check(
    "creating a type is audited",
    actions.has(AUDIT_ACTIONS.APPOINTMENT_TYPE_CREATED),
    [...actions],
  );
  check(
    "retiring a type is audited as a deactivation, not a generic update",
    actions.has(AUDIT_ACTIONS.APPOINTMENT_TYPE_DEACTIVATED),
    [...actions],
  );

  // The whole trail for this tenant, checked for anything that should not be
  // in a table that is never deleted and is read during support work.
  const everything = JSON.stringify(
    await prisma.auditLog.findMany({
      where: { actorTenantId: f.tenant.id },
      select: { action: true, beforeValue: true, afterValue: true },
    }),
  );

  for (const [label, value] of [
    ["patient name", PII.name],
    ["patient mobile", PII.mobileNumber],
    ["patient address", PII.address],
    ["patient city", PII.city],
    ["patient code", `PT-AP3-${f.stamp}`],
    ["the booked patient's name", "Ravi Kumar"],
    ["the booked patient's number", "9876500123"],
  ] as const) {
    check(`no ${label} in the audit trail`, !everything.includes(value));
  }

  check(
    "the trail records the scheduling fact instead",
    everything.includes("durationMinutes") && everything.includes("existingPatient"),
  );
}

// ---------------------------------------------------------------------------
// AP-2 regression
// ---------------------------------------------------------------------------

async function checkSlotsUnchanged(f: Fixture, types: TypeIds): Promise<void> {
  console.log("\nAP-2 regression");

  const result = await getAppointmentSlots(f.actors.reception, {
    clinicId: f.clinic.id,
    doctorId: f.doctor.id,
    appointmentTypeId: types.tenantWide,
    date: DAY,
  });

  check("the slot read still works", result.outcome === "ok", result.outcome);

  check(
    "its result shape is unchanged",
    Object.keys(result).sort().join(",") ===
      [
        "appointmentTypeId",
        "appointmentTypeName",
        "clinicId",
        "date",
        "doctorId",
        "doctorName",
        "durationMinutes",
        "outcome",
        "slots",
      ].join(","),
    Object.keys(result).sort(),
  );

  check(
    "a slot still carries only times, status and a booking id",
    result.slots.every((slot) =>
      Object.keys(slot).every((key) =>
        ["start", "end", "status", "bookingId"].includes(key),
      ),
    ),
    result.slots[0],
  );

  // The booking made earlier must now show through as occupied — the two halves
  // of the stage agreeing about the same rows.
  check(
    "a booked slot now reads as booked",
    result.slots.some((slot) => slot.start === "09:00" && slot.status === "booked"),
    result.slots.filter((slot) => slot.status === "booked").map((s) => s.start),
  );

  check(
    "a free slot still reads as available",
    result.slots.some((slot) => slot.status === "available"),
  );

  const serialised = JSON.stringify(result);
  check(
    "no patient details leaked into the slot read",
    !serialised.includes("Ravi Kumar") && !serialised.includes(PII.name),
  );

  await expectThrows(
    "the slot read still refuses staff",
    isPermissionError,
    () =>
      getAppointmentSlots(f.actors.staff, {
        clinicId: f.clinic.id,
        doctorId: f.doctor.id,
        appointmentTypeId: types.tenantWide,
        date: DAY,
      }),
  );

  await expectThrows(
    "the slot read still refuses another organisation",
    isScopeError,
    () =>
      getAppointmentSlots(f.actors.rivalAdmin, {
        clinicId: f.clinic.id,
        doctorId: f.doctor.id,
        appointmentTypeId: types.tenantWide,
        date: DAY,
      }),
  );
}

// ---------------------------------------------------------------------------
// Scope-change safety
// ---------------------------------------------------------------------------

async function checkTypeScopeChange(f: Fixture, types: TypeIds): Promise<void> {
  console.log("\nMoving a type between scopes");

  // The tenant-wide type has appointments at Alpha. Narrowing it onto Beta
  // would strand every one of them.
  await expectThrows(
    "narrowing a type onto a clinic strands booked appointments, so it is refused",
    isConflictError,
    () =>
      updateAppointmentType(f.actors.admin, types.tenantWide, {
        clinicId: f.sibling.id,
      }),
  );

  // Widening cannot strand anything.
  const widened = await updateAppointmentType(
    f.actors.admin,
    types.siblingSpecific,
    { clinicId: null },
  );
  check(
    "widening a clinic type to tenant-wide is allowed",
    widened.clinicId === null,
    widened,
  );

  // Put it back, so later assertions see the fixture they expect.
  await updateAppointmentType(f.actors.admin, types.siblingSpecific, {
    clinicId: f.sibling.id,
  });

  const renamed = await updateAppointmentType(f.actors.admin, types.quarterHour, {
    name: "Quick Review Renamed",
    defaultAmount: 275,
  });
  check(
    "renaming and re-pricing a type works",
    renamed.name === "Quick Review Renamed" && renamed.defaultAmount === "275.00",
    renamed,
  );

  const untouched = await prisma.appointment.findFirst({
    where: { appointmentTypeId: types.quarterHour },
    select: { amount: true },
  });
  check(
    "re-pricing does not rewrite money already quoted to a patient",
    untouched === null || untouched.amount.toFixed(2) === "250.00",
    untouched?.amount.toFixed(2),
  );

  await expectThrows(
    "a rename that collides with a sibling name is refused",
    isConflictError,
    () =>
      updateAppointmentType(f.actors.admin, types.quarterHour, {
        name: "Consultation",
      }),
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("AP-3 — appointment types, booking and the board\n");

  await sweepLeftovers();

  const before = await countEverything();
  let fixture: Fixture | null = null;

  try {
    fixture = await build();

    const types = await checkAppointmentTypes(fixture);
    const bookingId = await checkBooking(fixture, types);
    await checkBookingAuthorisation(fixture, types);
    await checkOverlap(fixture, types);
    await checkStatusOccupancy(fixture, types);
    await checkConcurrency(fixture, types);
    await checkList(fixture, types);
    await checkAudit(fixture, bookingId);
    await checkSlotsUnchanged(fixture, types);
    await checkTypeScopeChange(fixture, types);
  } catch (error: unknown) {
    failures += 1;
    console.error("\n  FAIL  the script itself threw", error);
  } finally {
    if (fixture) {
      try {
        await teardown(fixture);
      } catch (error: unknown) {
        failures += 1;
        console.error("\n  FAIL  cleanup did not complete", error);
      }
    }
  }

  console.log("\nNothing outside the fixture changed");
  const after = await countEverything();

  for (const [table, count] of Object.entries(before)) {
    const now = after[table as keyof typeof after];
    check(`${table}: ${count} rows before and after`, now === count, {
      before: count,
      after: now,
    });
  }

  console.log("");
  if (failures > 0) {
    console.log(`${failures} CHECK(S) FAILED`);
    process.exitCode = 1;
  } else {
    console.log("All checks passed.");
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
