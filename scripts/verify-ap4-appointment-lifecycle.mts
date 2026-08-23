/**
 * AP-4 verification — reschedule, cancel, no-show and check-in, against a LOCAL
 * database.
 *
 *     npm run verify:ap4-appointment-lifecycle
 *
 * tests/unit/appointmentLifecycleRules.test.ts already pins every rule that can
 * be decided without rows: what a request may contain, which transitions are
 * legal, how a refusal reads, and what each outcome does to occupancy. This
 * script exists for the four things it cannot reach:
 *
 *   1. OCCUPANCY AS THE DATABASE SEES IT — that a cancelled slot really becomes
 *      bookable again, that a checked-in one really does not, and that the
 *      unique index agrees with the overlap query about both.
 *   2. THE HISTORY. A move must leave the original row intact, with its original
 *      times, linked to its replacement. That is a claim about rows.
 *   3. AUTHORISATION over real roles — that a doctor may look and not cancel,
 *      that a clinic-scoped receptionist cannot reach a sibling's diary, and
 *      that neither reaches another organisation's.
 *   4. CONCURRENCY. Two receptionists cancelling the same appointment, or moving
 *      it to two different slots at once, is the failure this stage is built
 *      around. It cannot be simulated: it needs two transactions, real InnoDB
 *      locks, and a genuine loser.
 *
 * Everything it creates lives under tenants named `verify-ap4-lifecycle` and is
 * torn down at the end. Row counts on every pre-existing table are asserted
 * before and after, so a bug here that touched real data would be visible.
 *
 * Refuses to run unless DATABASE_URL points at localhost.
 */

import { prisma } from "@/lib/prisma";
import { BadRequestError, ConflictError } from "@/lib/apiHandler";
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
  cancelAppointment,
  checkInAppointment,
  markAppointmentNoShow,
} from "@/lib/appointmentLifecycle";
import { rescheduleAppointment } from "@/lib/appointmentReschedule";
import {
  createAppointmentType,
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
const isFeatureError = (error: unknown): boolean => error instanceof FeatureError;

const TEST_TENANT_NAME = "verify-ap4-lifecycle";

/** The working day the in-place transitions are exercised on. */
const DAY = "2026-12-14";
/** A second working day, where the moves happen. */
const OTHER_DAY = "2026-12-15";
/** A day nothing is ever configured on. */
const CLOSED_DAY = "2026-12-16";
/** A day the main doctor is on leave. */
const LEAVE_DAY = "2026-12-17";

const iso = (day: string, time: string): string => `${day}T${time}:00.000Z`;
const at = (day: string, time: string): Date => new Date(iso(day, time));
const dayOnly = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

/** Distinctive enough that finding it in an audit row is unambiguous. */
const PII = {
  name: "Zzyzx Ap4 Patient",
  mobileNumber: "9876500044",
  address: "44 Disclosure Drive",
  city: "Leakstown",
  gender: "female",
  age: 918274,
};

const SLOT_TAKEN = "This time slot was just booked. Please select another slot.";

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
  // A real neighbour, so every isolation assertion has somewhere to leak INTO
  // rather than merely failing to find a row.
  const rival = await makeTenant("rival");

  await seedDefaultRoles(prisma, tenant.id);
  await seedDefaultRoles(prisma, rival.id);

  const makeClinic = (tenantId: string, name: string) =>
    prisma.clinic.create({ data: { tenantId, name }, select: { id: true } });

  const clinic = await makeClinic(tenant.id, "AP-4 Alpha");
  const sibling = await makeClinic(tenant.id, "AP-4 Beta");
  const rivalClinic = await makeClinic(rival.id, "AP-4 Rival");

  const makeDoctor = (clinicId: string, name: string) =>
    prisma.doctor.create({
      data: { clinicId, name, department: "General Medicine" },
      select: { id: true, clinicId: true },
    });

  const doctor = await makeDoctor(clinic.id, "AP-4 Dr Alpha");
  // A second doctor at the SAME clinic — a move may change doctor, and the
  // mirror-image deadlock test needs two.
  const doctorTwo = await makeDoctor(clinic.id, "AP-4 Dr Alpha Two");
  const siblingDoctor = await makeDoctor(sibling.id, "AP-4 Dr Beta");
  const rivalDoctor = await makeDoctor(rivalClinic.id, "AP-4 Dr Rival");

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
      reason: "AP-4 fixture leave",
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
  const rivalAdminRoleId = await roleId(rival.id, ROLE_KEYS.CLINIC_ADMIN);

  // A role that may CANCEL but may not READ. It exists to document a real
  // consequence of the design rather than to endorse it: every lifecycle write
  // loads the appointment within `appointment:read` scope first, so this role
  // gets a 404 rather than a 403. Nobody should ever be granted it.
  const cancelOnlyRole = await prisma.role.create({
    data: {
      tenantId: tenant.id,
      name: "AP-4 Cancel without sight",
      permissions: ["appointment:cancel"],
      isSystem: false,
    },
    select: { id: true },
  });

  // Holds the lifecycle permissions but has NO layer-3 row, so the module
  // denies before any of them is consulted.
  const unentitledRole = await prisma.role.create({
    data: {
      tenantId: tenant.id,
      name: "AP-4 Front desk, module off",
      permissions: [
        "appointment:read",
        "appointment:create",
        "appointment:cancel",
        "appointment:checkin",
        "appointment:reschedule",
      ],
      isSystem: false,
    },
    select: { id: true },
  });

  // `appointments` is PREMIUM, so an ABSENT RoleFeatureAccess row DENIES. Every
  // role meant to reach the module needs an explicit row.
  //
  // THE DOCTOR ROLE IS IN THIS LIST DELIBERATELY, even though it may not cancel.
  // The feature gate runs BEFORE the permission gate, so without a row here it
  // would be refused at layer 3 and the layer-4 refusal would never be reached
  // — the permission check would look tested when it was not.
  for (const id of [
    adminRoleId,
    receptionRoleId,
    doctorRoleId,
    rivalAdminRoleId,
    cancelOnlyRole.id,
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
  const siblingUser = await makeUser("sibling", tenant.id);
  const noModuleUser = await makeUser("nomodule", tenant.id);
  const cancelOnlyUser = await makeUser("cancelonly", tenant.id);
  const rivalAdminUser = await makeUser("rivaladmin", rival.id);

  const assign = (userId: string, roleId: string, clinicId: string | null) =>
    prisma.userRole.create({ data: { userId, roleId, clinicId } });

  await assign(adminUser.id, adminRoleId, null);
  await assign(receptionUser.id, receptionRoleId, null);
  await assign(doctorUser.id, doctorRoleId, null);
  await assign(rivalAdminUser.id, rivalAdminRoleId, null);
  await assign(noModuleUser.id, unentitledRole.id, null);
  await assign(cancelOnlyUser.id, cancelOnlyRole.id, null);
  // Clinic-scoped to the SIBLING only — the clinic-isolation subject.
  await assign(siblingUser.id, receptionRoleId, sibling.id);

  const actor = (userId: string, tenantId: string): ActorContext => ({
    userId,
    tenantId,
  });

  // A patient who exists at Alpha, carrying loud PII so a leak is unmistakable.
  const patient = await prisma.patient.create({
    data: {
      tenantId: tenant.id,
      clinicId: clinic.id,
      patientCode: `PT-AP4-${stamp}`,
      ...PII,
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
    appointmentsFeature,
    users: { reception: receptionUser, admin: adminUser },
    actors: {
      admin: actor(adminUser.id, tenant.id),
      reception: actor(receptionUser.id, tenant.id),
      doctor: actor(doctorUser.id, tenant.id),
      sibling: actor(siblingUser.id, tenant.id),
      noModule: actor(noModuleUser.id, tenant.id),
      cancelOnly: actor(cancelOnlyUser.id, tenant.id),
      rivalAdmin: actor(rivalAdminUser.id, rival.id),
    },
  };
}

type Fixture = Awaited<ReturnType<typeof build>>;

async function teardown(fixture: Fixture): Promise<void> {
  for (const tenantId of [fixture.tenant.id, fixture.rival.id]) {
    // RESTRICT foreign keys mean the children go first, and a reschedule chain
    // means appointments point at each other. Nothing in the APP ever deletes an
    // appointment — this is fixture teardown, not a supported operation.
    await prisma.registration.deleteMany({ where: { clinic: { tenantId } } });
    await prisma.appointment.updateMany({
      where: { tenantId },
      data: { rescheduledFromId: null },
    });
    await prisma.appointment.deleteMany({ where: { tenantId } });
    await prisma.appointmentType.deleteMany({ where: { tenantId } });
    await prisma.doctorScheduleLock.deleteMany({
      where: { doctor: { clinic: { tenantId } } },
    });
    await prisma.auditLog.deleteMany({ where: { actorTenantId: tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
  }
}

/**
 * Removes fixture tenants an interrupted earlier run left behind, so the
 * row-count baseline is taken against a clean database and the script is
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
// Shared helpers
// ---------------------------------------------------------------------------

interface TypeIds {
  /** 30 minutes. The workhorse. */
  standard: string;
  /** 15 minutes, for a finer grid. */
  quarterHour: string;
  /** 30 minutes at first, then re-timed mid-script. */
  shifting: string;
}

async function buildTypes(f: Fixture): Promise<TypeIds> {
  const make = async (name: string, durationMinutes: number, amount: number) =>
    (
      await createAppointmentType(f.actors.admin, {
        clinicId: null,
        name,
        durationMinutes,
        defaultAmount: amount,
      })
    ).id;

  return {
    standard: await make("AP-4 Consultation", 30, 500),
    quarterHour: await make("AP-4 Quick review", 15, 250),
    shifting: await make("AP-4 Shifting", 30, 800),
  };
}

interface BookOptions {
  doctorId?: string;
  typeId?: string;
  patientId?: string | null;
}

/** Books one appointment and returns its id. */
async function book(
  f: Fixture,
  types: TypeIds,
  day: string,
  start: string,
  end: string,
  options: BookOptions = {},
): Promise<string> {
  const created = await createAppointment(f.actors.reception, {
    clinicId: f.clinic.id,
    doctorId: options.doctorId ?? f.doctor.id,
    appointmentTypeId: options.typeId ?? types.standard,
    patientId: options.patientId ?? null,
    name: PII.name,
    mobileNumber: PII.mobileNumber,
    age: PII.age,
    gender: PII.gender,
    address: PII.address,
    city: PII.city,
    slotStart: iso(day, start),
    slotEnd: iso(day, end),
  });

  return created.id;
}

const row = (id: string) =>
  prisma.appointment.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      status: true,
      activeSlotStart: true,
      slotStart: true,
      slotEnd: true,
      doctorId: true,
      clinicId: true,
      tenantId: true,
      patientId: true,
      appointmentTypeId: true,
      name: true,
      mobileNumber: true,
      age: true,
      gender: true,
      address: true,
      city: true,
      amount: true,
      checkedInAt: true,
      checkedInById: true,
      cancelledAt: true,
      cancelledById: true,
      cancellationReason: true,
      rescheduledFromId: true,
      bookedById: true,
      createdAt: true,
    },
  });

/** Is this exact slot bookable right now? Books it if so, then reports. */
async function slotIsFree(
  f: Fixture,
  types: TypeIds,
  day: string,
  start: string,
  end: string,
  options: BookOptions = {},
): Promise<boolean> {
  try {
    const id = await book(f, types, day, start, end, options);
    // Put it straight back: this is a probe, not a booking. Deleting is a
    // fixture operation and never something the app does.
    await prisma.appointment.delete({ where: { id } });
    return true;
  } catch (error: unknown) {
    if (isConflictError(error)) {
      return false;
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Check-in
// ---------------------------------------------------------------------------

async function checkCheckIn(f: Fixture, types: TypeIds): Promise<string> {
  console.log("\nCheck-in");

  const id = await book(f, types, DAY, "09:00", "09:30");
  const before = await row(id);

  const result = await checkInAppointment(f.actors.reception, id);
  const after = await row(id);

  check("a receptionist can check a patient in", result.status === "CHECKED_IN");
  check("the row is CHECKED_IN", after.status === "CHECKED_IN", after.status);
  check(
    "checkedInAt was stamped",
    after.checkedInAt !== null && after.checkedInAt >= before.createdAt,
    after.checkedInAt,
  );
  check(
    "checkedInById is the actor",
    after.checkedInById === f.actors.reception.userId,
    after.checkedInById,
  );
  check(
    "the cancellation columns were NOT touched",
    after.cancelledAt === null &&
      after.cancelledById === null &&
      after.cancellationReason === null,
    after,
  );
  check(
    "the times are unchanged — nothing ever moves slot_start or slot_end",
    after.slotStart.getTime() === before.slotStart.getTime() &&
      after.slotEnd.getTime() === before.slotEnd.getTime(),
  );

  // The point of the whole status: a patient in the waiting room is not free
  // time.
  check(
    "the slot STAYS occupied — activeSlotStart still mirrors slotStart",
    after.activeSlotStart?.getTime() === after.slotStart.getTime(),
    after.activeSlotStart,
  );
  check(
    "and the database agrees: the slot cannot be booked over",
    !(await slotIsFree(f, types, DAY, "09:00", "09:30")),
  );

  await expectThrows(
    "checking in twice is refused rather than silently re-stamping",
    isConflictError,
    () => checkInAppointment(f.actors.reception, id),
  );

  const stamp = await row(id);
  check(
    "the refused second check-in did not overwrite the first stamp",
    stamp.checkedInAt?.getTime() === after.checkedInAt?.getTime() &&
      stamp.checkedInById === after.checkedInById,
  );

  const audit = await prisma.auditLog.findMany({
    where: {
      actorTenantId: f.tenant.id,
      action: AUDIT_ACTIONS.APPOINTMENT_CHECKED_IN,
      targetId: id,
    },
    select: { beforeValue: true, afterValue: true, actorUserId: true },
  });

  check("exactly one check-in audit row", audit.length === 1, audit.length);
  check(
    "it records the status either side",
    (audit[0]?.beforeValue as { status?: string })?.status === "SCHEDULED" &&
      (audit[0]?.afterValue as { status?: string })?.status === "CHECKED_IN",
    audit[0],
  );
  check(
    "and who did it",
    audit[0]?.actorUserId === f.actors.reception.userId,
  );

  return id;
}

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

async function checkCancel(f: Fixture, types: TypeIds): Promise<string> {
  console.log("\nCancellation");

  const id = await book(f, types, DAY, "09:30", "10:00");
  const before = await row(id);

  const result = await cancelAppointment(f.actors.reception, id, {
    reason: "Patient rang to call it off",
  });
  const after = await row(id);

  check("a receptionist can cancel", result.status === "CANCELLED");
  check("the row is CANCELLED", after.status === "CANCELLED", after.status);
  check(
    "THE ROW SURVIVES — nothing in this system deletes an appointment",
    Boolean(await prisma.appointment.findUnique({ where: { id } })),
  );
  check(
    "with its original times intact",
    after.slotStart.getTime() === before.slotStart.getTime() &&
      after.slotEnd.getTime() === before.slotEnd.getTime(),
  );
  check(
    "the slot is RELEASED — activeSlotStart is null",
    after.activeSlotStart === null,
    after.activeSlotStart,
  );
  check(
    "cancelledAt and cancelledById were stamped",
    after.cancelledAt !== null &&
      after.cancelledById === f.actors.reception.userId,
    after,
  );
  check(
    "the reason was stored",
    after.cancellationReason === "Patient rang to call it off",
    after.cancellationReason,
  );
  check(
    "the check-in columns were NOT touched",
    after.checkedInAt === null && after.checkedInById === null,
  );

  // The whole point of releasing.
  check(
    "and the database agrees: the slot is bookable again",
    await slotIsFree(f, types, DAY, "09:30", "10:00"),
  );

  await expectThrows(
    "cancelling twice is refused",
    isConflictError,
    () => cancelAppointment(f.actors.reception, id, { reason: "again" }),
  );

  const second = await row(id);
  check(
    "the refused second cancel did not rewrite who cancelled it",
    second.cancelledById === after.cancelledById &&
      second.cancelledAt?.getTime() === after.cancelledAt?.getTime() &&
      second.cancellationReason === after.cancellationReason,
  );

  const noReasonId = await book(f, types, DAY, "10:00", "10:30");
  await cancelAppointment(f.actors.reception, noReasonId);
  const noReason = await row(noReasonId);
  check(
    "cancelling without a reason is allowed and stores null, not an empty string",
    noReason.status === "CANCELLED" && noReason.cancellationReason === null,
    noReason.cancellationReason,
  );

  const blankId = await book(f, types, DAY, "10:30", "11:00");
  await cancelAppointment(f.actors.reception, blankId, { reason: "   " });
  const blank = await row(blankId);
  check(
    "a blank reason is stored as null too",
    blank.cancellationReason === null,
    blank.cancellationReason,
  );

  const audit = await prisma.auditLog.findMany({
    where: {
      actorTenantId: f.tenant.id,
      action: AUDIT_ACTIONS.APPOINTMENT_CANCELLED,
      targetId: id,
    },
    select: { reason: true, beforeValue: true, afterValue: true },
  });

  check("exactly one cancellation audit row", audit.length === 1, audit.length);
  check(
    "the reason travels in the reason column",
    audit[0]?.reason === "Patient rang to call it off",
    audit[0]?.reason,
  );
  check(
    "it records the status either side",
    (audit[0]?.beforeValue as { status?: string })?.status === "SCHEDULED" &&
      (audit[0]?.afterValue as { status?: string })?.status === "CANCELLED",
  );

  return id;
}

// ---------------------------------------------------------------------------
// No-show
// ---------------------------------------------------------------------------

async function checkNoShow(f: Fixture, types: TypeIds): Promise<string> {
  console.log("\nNo-show");

  const id = await book(f, types, DAY, "11:00", "11:30");
  const before = await row(id);

  const result = await markAppointmentNoShow(f.actors.reception, id, {
    reason: "Did not arrive",
  });
  const after = await row(id);

  check("a receptionist can mark a no-show", result.status === "NO_SHOW");
  check("the row is NO_SHOW", after.status === "NO_SHOW", after.status);
  check(
    "the row survives with its original times",
    after.slotStart.getTime() === before.slotStart.getTime() &&
      after.slotEnd.getTime() === before.slotEnd.getTime(),
  );
  check(
    "the slot is RELEASED — the patient did not come, so the time is free",
    after.activeSlotStart === null,
    after.activeSlotStart,
  );
  check(
    "and the database agrees: the slot is bookable again",
    await slotIsFree(f, types, DAY, "11:00", "11:30"),
  );

  // The deliberate asymmetry with cancelling, documented in the code.
  check(
    "the CANCELLATION COLUMNS ARE LEFT NULL — a no-show is not a cancellation",
    after.cancelledAt === null &&
      after.cancelledById === null &&
      after.cancellationReason === null,
    after,
  );
  check(
    "the check-in columns are untouched too",
    after.checkedInAt === null && after.checkedInById === null,
  );

  const audit = await prisma.auditLog.findMany({
    where: {
      actorTenantId: f.tenant.id,
      action: AUDIT_ACTIONS.APPOINTMENT_NO_SHOW,
      targetId: id,
    },
    select: { reason: true, actorUserId: true, afterValue: true },
  });

  check("exactly one no-show audit row", audit.length === 1, audit.length);
  check(
    "who marked it, and any note, are recorded there instead",
    audit[0]?.actorUserId === f.actors.reception.userId &&
      audit[0]?.reason === "Did not arrive",
    audit[0],
  );
  await expectThrows(
    "marking a no-show twice is refused",
    isConflictError,
    () => markAppointmentNoShow(f.actors.reception, id),
  );

  return id;
}

// ---------------------------------------------------------------------------
// Terminal states
// ---------------------------------------------------------------------------

async function checkTerminalStates(
  f: Fixture,
  types: TypeIds,
  cancelledId: string,
  noShowId: string,
  checkedInId: string,
): Promise<void> {
  console.log("\nTerminal states");

  for (const [label, id] of [
    ["cancelled", cancelledId],
    ["missed", noShowId],
  ] as const) {
    await expectThrows(
      `a ${label} appointment cannot be checked in`,
      isConflictError,
      () => checkInAppointment(f.actors.reception, id),
    );
    await expectThrows(
      `a ${label} appointment cannot be moved`,
      isConflictError,
      () =>
        rescheduleAppointment(f.actors.reception, id, {
          slotStart: iso(OTHER_DAY, "09:00"),
          slotEnd: iso(OTHER_DAY, "09:30"),
        }),
    );
  }

  await expectThrows(
    "a cancelled appointment cannot be marked a no-show",
    isConflictError,
    () => markAppointmentNoShow(f.actors.reception, cancelledId),
  );
  await expectThrows(
    "a missed appointment cannot be cancelled",
    isConflictError,
    () => cancelAppointment(f.actors.reception, noShowId),
  );

  // A patient standing at the desk is here. Moving them is not a reschedule.
  await expectThrows(
    "a checked-in patient cannot be rescheduled",
    isConflictError,
    () =>
      rescheduleAppointment(f.actors.reception, checkedInId, {
        slotStart: iso(OTHER_DAY, "09:00"),
        slotEnd: iso(OTHER_DAY, "09:30"),
      }),
  );
  check(
    "but a checked-in patient CAN still be cancelled or marked a no-show",
    true,
  );

  // AP-5 does not exist yet, so the CONVERTED state is set directly. This is a
  // fixture manoeuvre standing in for a conversion, not a supported operation.
  const convertedId = await book(f, types, DAY, "11:30", "12:00");
  await prisma.appointment.update({
    where: { id: convertedId },
    data: { status: "CONVERTED" },
  });

  await expectThrows(
    "a converted appointment cannot be cancelled",
    isConflictError,
    () => cancelAppointment(f.actors.reception, convertedId),
  );
  await expectThrows(
    "a converted appointment cannot be moved",
    isConflictError,
    () =>
      rescheduleAppointment(f.actors.reception, convertedId, {
        slotStart: iso(OTHER_DAY, "09:00"),
        slotEnd: iso(OTHER_DAY, "09:30"),
      }),
  );
  check(
    "and it still OCCUPIES its slot — a visit that happened consumed the time",
    !(await slotIsFree(f, types, DAY, "11:30", "12:00")),
  );

  await expectThrows(
    "an appointment id that does not exist is a 404, not a 500",
    isScopeError,
    () => cancelAppointment(f.actors.reception, "no-such-appointment"),
  );
}

// ---------------------------------------------------------------------------
// Rescheduling
// ---------------------------------------------------------------------------

async function checkReschedule(f: Fixture, types: TypeIds): Promise<void> {
  console.log("\nRescheduling");

  const id = await book(f, types, OTHER_DAY, "09:00", "09:30", {
    patientId: f.patient.id,
  });
  const before = await row(id);

  const moved = await rescheduleAppointment(f.actors.reception, id, {
    slotStart: iso(OTHER_DAY, "14:00"),
    slotEnd: iso(OTHER_DAY, "14:30"),
    reason: "Patient asked for the afternoon",
  });

  const original = await row(id);
  const replacement = await row(moved.appointment.id);

  check("a receptionist can move an appointment", Boolean(moved.appointment.id));
  check(
    "A NEW ROW WAS CREATED — a move is never an edit",
    moved.appointment.id !== id,
  );
  check(
    "the original is marked RESCHEDULED",
    original.status === "RESCHEDULED",
    original.status,
  );
  check(
    "the original KEEPS ITS ORIGINAL TIMES — slot_start is never updated",
    original.slotStart.getTime() === before.slotStart.getTime() &&
      original.slotEnd.getTime() === before.slotEnd.getTime(),
  );
  check(
    "the original released its slot",
    original.activeSlotStart === null,
    original.activeSlotStart,
  );
  check(
    "the new row points back at it",
    replacement.rescheduledFromId === id,
    replacement.rescheduledFromId,
  );
  check(
    "the new row is SCHEDULED and occupies its slot",
    replacement.status === "SCHEDULED" &&
      replacement.activeSlotStart?.getTime() === replacement.slotStart.getTime(),
  );
  check(
    "at the requested time",
    replacement.slotStart.getTime() === at(OTHER_DAY, "14:00").getTime() &&
      replacement.slotEnd.getTime() === at(OTHER_DAY, "14:30").getTime(),
  );

  // The patient travels with the appointment, unchanged.
  check(
    "the patient link is carried across",
    replacement.patientId === f.patient.id,
  );
  check(
    "every patient detail is copied verbatim",
    replacement.name === before.name &&
      replacement.mobileNumber === before.mobileNumber &&
      replacement.age === before.age &&
      replacement.gender === before.gender &&
      replacement.address === before.address &&
      replacement.city === before.city,
  );
  check(
    "the quoted price travels with the patient",
    replacement.amount.equals(before.amount),
    { before: before.amount.toString(), after: replacement.amount.toString() },
  );
  check(
    "the clinic, tenant and type are unchanged",
    replacement.clinicId === before.clinicId &&
      replacement.tenantId === before.tenantId &&
      replacement.appointmentTypeId === before.appointmentTypeId,
  );
  check(
    "whoever moved it is recorded as having booked the new row",
    replacement.bookedById === f.actors.reception.userId,
  );
  check(
    "the original's own bookedBy is untouched",
    original.bookedById === before.bookedById,
  );

  check(
    "the vacated slot is bookable again",
    await slotIsFree(f, types, OTHER_DAY, "09:00", "09:30"),
  );
  check(
    "and the new slot is not",
    !(await slotIsFree(f, types, OTHER_DAY, "14:00", "14:30")),
  );

  // --- The audit row -------------------------------------------------------

  const audit = await prisma.auditLog.findMany({
    where: {
      actorTenantId: f.tenant.id,
      action: AUDIT_ACTIONS.APPOINTMENT_RESCHEDULED,
      targetId: id,
    },
    select: { beforeValue: true, afterValue: true, reason: true },
  });

  check("exactly one reschedule audit row", audit.length === 1, audit.length);
  check(
    "it is filed against the ORIGINAL appointment",
    audit.length === 1,
  );
  check(
    "and leads forward to the replacement",
    (audit[0]?.afterValue as { newAppointmentId?: string })?.newAppointmentId ===
      moved.appointment.id,
    audit[0]?.afterValue,
  );
  check(
    "it records the old time and the new one",
    (audit[0]?.beforeValue as { startTime?: string })?.startTime === "09:00" &&
      (audit[0]?.afterValue as { startTime?: string })?.startTime === "14:00",
    { before: audit[0]?.beforeValue, after: audit[0]?.afterValue },
  );
  check(
    "it says the doctor did not change",
    (audit[0]?.afterValue as { doctorChanged?: boolean })?.doctorChanged === false,
  );
  check("the reason is captured", audit[0]?.reason === "Patient asked for the afternoon");

  // --- Moving to a different doctor ---------------------------------------

  const crossId = await book(f, types, OTHER_DAY, "10:00", "10:30");
  const crossMoved = await rescheduleAppointment(f.actors.reception, crossId, {
    doctorId: f.doctorTwo.id,
    slotStart: iso(OTHER_DAY, "10:00"),
    slotEnd: iso(OTHER_DAY, "10:30"),
  });
  const crossRow = await row(crossMoved.appointment.id);

  check(
    "an appointment can move to another doctor at the same clinic",
    crossRow.doctorId === f.doctorTwo.id,
  );
  check(
    "at the SAME time, because the other doctor's diary is what matters",
    crossRow.slotStart.getTime() === at(OTHER_DAY, "10:00").getTime(),
  );
  check(
    "the first doctor's slot is free again",
    await slotIsFree(f, types, OTHER_DAY, "10:00", "10:30"),
  );

  const crossAudit = await prisma.auditLog.findFirst({
    where: {
      action: AUDIT_ACTIONS.APPOINTMENT_RESCHEDULED,
      targetId: crossId,
    },
    select: { afterValue: true },
  });
  check(
    "the trail flags that the doctor changed",
    (crossAudit?.afterValue as { doctorChanged?: boolean })?.doctorChanged === true,
  );

  // --- A move that overlaps the slot it is vacating ------------------------
  //
  // The case the release-before-check ordering exists for. It needs the grid to
  // change under the appointment, which is what re-timing the type does.

  const shiftId = await book(f, types, DAY, "11:00", "11:30", {
    typeId: types.shifting,
    doctorId: f.doctorTwo.id,
  });
  // Re-timing the type moves the grid: 30-minute boundaries at 09:00/09:30/...
  // become 45-minute ones at 09:00/09:45/10:30/11:15. The 10:30 slot is the one
  // the new grid offers that OVERLAPS the 11:00-11:30 being vacated.
  await updateAppointmentType(f.actors.admin, types.shifting, {
    durationMinutes: 45,
  });

  const shifted = await rescheduleAppointment(f.actors.reception, shiftId, {
    slotStart: iso(DAY, "10:30"),
    slotEnd: iso(DAY, "11:15"),
  });
  const shiftedRow = await row(shifted.appointment.id);

  check(
    "an appointment can be moved onto a slot that overlaps the one it is vacating",
    shiftedRow.slotStart.getTime() === at(DAY, "10:30").getTime() &&
      shiftedRow.slotEnd.getTime() === at(DAY, "11:15").getTime(),
    shiftedRow,
  );
  check(
    "which also proves the original stopped occupying before the clash check ran",
    shiftedRow.status === "SCHEDULED",
  );
  check(
    "and that the unique index did not fire on the shared start time",
    (await row(shiftId)).activeSlotStart === null,
  );

  // --- Re-pricing does not follow the patient ------------------------------

  await updateAppointmentType(f.actors.admin, types.shifting, {
    defaultAmount: 9999,
  });
  const repriced = await rescheduleAppointment(
    f.actors.reception,
    shifted.appointment.id,
    {
      slotStart: iso(DAY, "12:45"),
      slotEnd: iso(DAY, "13:30"),
    },
  );
  const repricedRow = await row(repriced.appointment.id);

  check(
    "a move after a price rise keeps the amount the patient was quoted",
    repricedRow.amount.toFixed(2) === "800.00",
    repricedRow.amount.toString(),
  );

  // --- Chains --------------------------------------------------------------

  const chainRow = await row(repriced.appointment.id);
  const middle = await row(chainRow.rescheduledFromId ?? "");
  check(
    "a twice-moved appointment forms a chain",
    middle.rescheduledFromId === shiftId,
    { middle: middle.id, expected: shiftId },
  );
  check(
    "every earlier link is RESCHEDULED and releases its slot",
    middle.status === "RESCHEDULED" && middle.activeSlotStart === null,
  );
  check(
    "and only the last link is live",
    chainRow.status === "SCHEDULED" && chainRow.activeSlotStart !== null,
  );

  // --- Refusals ------------------------------------------------------------

  const liveId = await book(f, types, OTHER_DAY, "15:00", "15:30");

  await expectThrows(
    "moving an appointment to where it already is is refused",
    isBadRequestError,
    () =>
      rescheduleAppointment(f.actors.reception, liveId, {
        slotStart: iso(OTHER_DAY, "15:00"),
        slotEnd: iso(OTHER_DAY, "15:30"),
      }),
  );

  const blockerId = await book(f, types, OTHER_DAY, "16:00", "16:30");
  await expectThrows(
    "moving onto a slot somebody else holds is a conflict",
    (error) =>
      isConflictError(error) && String((error as Error).message) === SLOT_TAKEN,
    () =>
      rescheduleAppointment(f.actors.reception, liveId, {
        slotStart: iso(OTHER_DAY, "16:00"),
        slotEnd: iso(OTHER_DAY, "16:30"),
      }),
  );
  check(
    "and the refused move left the appointment exactly as it was",
    (await row(liveId)).status === "SCHEDULED" &&
      (await row(liveId)).activeSlotStart !== null,
  );
  check(
    "the blocker is untouched too",
    (await row(blockerId)).status === "SCHEDULED",
  );

  await expectThrows(
    "moving to a time off the type's grid is refused",
    isBadRequestError,
    () =>
      rescheduleAppointment(f.actors.reception, liveId, {
        slotStart: iso(OTHER_DAY, "15:07"),
        slotEnd: iso(OTHER_DAY, "15:37"),
      }),
  );

  await expectThrows(
    "a slot that is not the type's length is refused",
    isBadRequestError,
    () =>
      rescheduleAppointment(f.actors.reception, liveId, {
        slotStart: iso(OTHER_DAY, "13:00"),
        slotEnd: iso(OTHER_DAY, "13:45"),
      }),
  );

  await expectThrows(
    "a slot running past midnight is refused",
    isBadRequestError,
    () =>
      rescheduleAppointment(f.actors.reception, liveId, {
        slotStart: `${OTHER_DAY}T23:45:00.000Z`,
        slotEnd: `${CLOSED_DAY}T00:15:00.000Z`,
      }),
  );

  await expectThrows(
    "moving onto a day the doctor does not work is refused",
    isConflictError,
    () =>
      rescheduleAppointment(f.actors.reception, liveId, {
        slotStart: iso(CLOSED_DAY, "09:00"),
        slotEnd: iso(CLOSED_DAY, "09:30"),
      }),
  );

  await expectThrows(
    "moving onto a day the doctor is on leave is refused",
    isConflictError,
    () =>
      rescheduleAppointment(f.actors.reception, liveId, {
        slotStart: iso(LEAVE_DAY, "09:00"),
        slotEnd: iso(LEAVE_DAY, "09:30"),
      }),
  );

  await expectThrows(
    "moving to a doctor at another clinic is a 404, not a 403",
    isScopeError,
    () =>
      rescheduleAppointment(f.actors.reception, liveId, {
        doctorId: f.siblingDoctor.id,
        slotStart: iso(OTHER_DAY, "13:00"),
        slotEnd: iso(OTHER_DAY, "13:30"),
      }),
  );

  await expectThrows(
    "moving to another organisation's doctor is a 404 too",
    isScopeError,
    () =>
      rescheduleAppointment(f.actors.reception, liveId, {
        doctorId: f.rivalDoctor.id,
        slotStart: iso(OTHER_DAY, "13:00"),
        slotEnd: iso(OTHER_DAY, "13:30"),
      }),
  );

  check(
    "after every refusal the appointment is still exactly where it was",
    (await row(liveId)).slotStart.getTime() ===
      at(OTHER_DAY, "15:00").getTime() &&
      (await row(liveId)).status === "SCHEDULED",
  );

  // --- A retired type still moves -----------------------------------------

  const retiredType = await createAppointmentType(f.actors.admin, {
    clinicId: null,
    name: "AP-4 Withdrawn service",
    durationMinutes: 30,
    defaultAmount: 300,
  });
  const strandedId = await book(f, types, DAY, "13:00", "13:30", {
    typeId: retiredType.id,
  });
  await updateAppointmentType(f.actors.admin, retiredType.id, {
    isActive: false,
  });

  const rescued = await rescheduleAppointment(f.actors.reception, strandedId, {
    slotStart: iso(DAY, "13:30"),
    slotEnd: iso(DAY, "14:00"),
  });
  check(
    "retiring a service does not strand the people already booked into it",
    (await row(rescued.appointment.id)).status === "SCHEDULED",
  );

  await expectThrows(
    "but the retired service still cannot be booked afresh",
    isScopeError,
    () => book(f, types, DAY, "14:30", "15:00", { typeId: retiredType.id }),
  );
}

// ---------------------------------------------------------------------------
// Authorisation
// ---------------------------------------------------------------------------

async function checkAuthorisation(f: Fixture, types: TypeIds): Promise<void> {
  console.log("\nAuthorisation");

  const id = await book(f, types, DAY, "15:00", "15:30");

  const move = () =>
    rescheduleAppointment(f.actors.doctor, id, {
      slotStart: iso(DAY, "15:30"),
      slotEnd: iso(DAY, "16:00"),
    });

  // The Doctor role holds appointment:read and nothing else. It is the cleanest
  // subject for "can see it, may not touch it".
  await expectThrows(
    "a doctor may look at the board but not cancel",
    isPermissionError,
    () => cancelAppointment(f.actors.doctor, id),
  );
  await expectThrows(
    "nor mark a no-show — a doctor deciding a slot is free is a front-desk call",
    isPermissionError,
    () => markAppointmentNoShow(f.actors.doctor, id),
  );
  await expectThrows(
    "nor check a patient in",
    isPermissionError,
    () => checkInAppointment(f.actors.doctor, id),
  );
  await expectThrows("nor move an appointment", isPermissionError, move);

  check(
    "and none of those refusals changed anything",
    (await row(id)).status === "SCHEDULED" &&
      (await row(id)).cancelledAt === null &&
      (await row(id)).checkedInAt === null,
  );

  // Clinic isolation, within one organisation.
  await expectThrows(
    "a receptionist scoped to a sibling clinic cannot cancel here — 404, not 403",
    isScopeError,
    () => cancelAppointment(f.actors.sibling, id),
  );
  await expectThrows(
    "nor check in here",
    isScopeError,
    () => checkInAppointment(f.actors.sibling, id),
  );
  await expectThrows(
    "nor move it",
    isScopeError,
    () =>
      rescheduleAppointment(f.actors.sibling, id, {
        slotStart: iso(DAY, "15:30"),
        slotEnd: iso(DAY, "16:00"),
      }),
  );

  // Tenant isolation.
  await expectThrows(
    "another organisation's admin cannot cancel it",
    isScopeError,
    () => cancelAppointment(f.actors.rivalAdmin, id),
  );
  await expectThrows(
    "nor check it in",
    isScopeError,
    () => checkInAppointment(f.actors.rivalAdmin, id),
  );
  await expectThrows(
    "nor move it",
    isScopeError,
    () =>
      rescheduleAppointment(f.actors.rivalAdmin, id, {
        slotStart: iso(DAY, "15:30"),
        slotEnd: iso(DAY, "16:00"),
      }),
  );

  // The feature gate, which runs BEFORE the permission gate.
  await expectThrows(
    "an organisation without the module is told THAT, not that they lack a permission",
    isFeatureError,
    () => cancelAppointment(f.actors.noModule, id),
  );
  await expectThrows(
    "the module gate covers check-in too",
    isFeatureError,
    () => checkInAppointment(f.actors.noModule, id),
  );
  await expectThrows(
    "and rescheduling",
    isFeatureError,
    () =>
      rescheduleAppointment(f.actors.noModule, id, {
        slotStart: iso(DAY, "15:30"),
        slotEnd: iso(DAY, "16:00"),
      }),
  );

  // The documented consequence of loading within read scope.
  await expectThrows(
    "a role that may cancel but may not READ gets a 404 — acting requires sight",
    isScopeError,
    () => cancelAppointment(f.actors.cancelOnly, id),
  );

  // The admin holds everything.
  const adminMoved = await rescheduleAppointment(f.actors.admin, id, {
    slotStart: iso(DAY, "15:30"),
    slotEnd: iso(DAY, "16:00"),
  });
  check(
    "a clinic admin can do all of it",
    (await row(adminMoved.appointment.id)).status === "SCHEDULED",
  );
  await checkInAppointment(f.actors.admin, adminMoved.appointment.id);
  check(
    "including checking a patient in",
    (await row(adminMoved.appointment.id)).status === "CHECKED_IN",
  );
}

// ---------------------------------------------------------------------------
// Concurrency — the reason the lock exists
// ---------------------------------------------------------------------------

async function checkConcurrency(f: Fixture, types: TypeIds): Promise<void> {
  console.log("\nConcurrency");

  /**
   * Both calls are dispatched without awaiting the first, so they are in flight
   * together on separate pooled connections. The DoctorScheduleLock row and the
   * appointment's own row lock are what serialise them: the loser blocks until
   * the winner commits, then re-reads and sees the state the winner left.
   */
  const race = async (a: () => Promise<unknown>, b: () => Promise<unknown>) => {
    const [first, second] = await Promise.allSettled([a(), b()]);
    return {
      wins: [first, second].filter((r) => r.status === "fulfilled").length,
      losses: [first, second].filter(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      ),
    };
  };

  // --- Two people cancelling the same appointment --------------------------

  const cancelId = await book(f, types, DAY, "16:00", "16:30");
  const cancels = await race(
    () => cancelAppointment(f.actors.reception, cancelId, { reason: "first" }),
    () => cancelAppointment(f.actors.admin, cancelId, { reason: "second" }),
  );

  check(
    "two people cancelling at once: exactly one succeeds",
    cancels.wins === 1,
    cancels,
  );
  check(
    "the loser gets a clean conflict, not a deadlock",
    cancels.losses.length === 1 && isConflictError(cancels.losses[0].reason),
    cancels.losses.map((l) => l.reason),
  );

  const cancelled = await row(cancelId);
  check(
    "and the winner's identity was not overwritten by the loser",
    cancelled.cancellationReason === "first" ||
      cancelled.cancellationReason === "second",
    cancelled.cancellationReason,
  );
  check(
    "exactly one cancellation audit row was written",
    (await prisma.auditLog.count({
      where: {
        action: AUDIT_ACTIONS.APPOINTMENT_CANCELLED,
        targetId: cancelId,
      },
    })) === 1,
  );

  // --- A cancellation racing a check-in ------------------------------------

  const raceId = await book(f, types, DAY, "16:30", "17:00");
  const mixed = await race(
    () => cancelAppointment(f.actors.reception, raceId, { reason: "called off" }),
    () => checkInAppointment(f.actors.admin, raceId),
  );

  // BOTH MAY LEGITIMATELY SUCCEED HERE, and the outcome depends on which
  // transaction reaches the row lock first. Checking a patient in and then
  // cancelling them is an allowed sequence — somebody arrives and is then sent
  // away — so if the check-in lands first, the cancellation that follows it is
  // ordinary work, not a race. If the cancellation lands first the check-in is
  // refused, because CANCELLED is terminal.
  //
  // What the lock has to guarantee is not that one of them loses. It is that
  // they cannot INTERLEAVE: the row must never end up with a status saying one
  // thing and its occupancy sentinel saying another.
  check(
    "cancelling and checking in at once: one or both succeed, never neither",
    mixed.wins >= 1,
    mixed,
  );
  const mixedRow = await row(raceId);
  check(
    "the row ends CANCELLED whichever order they landed in",
    mixedRow.status === "CANCELLED",
    mixedRow.status,
  );
  check(
    "and its occupancy agrees with its status — no half-written row",
    mixedRow.activeSlotStart === null,
    mixedRow,
  );
  check(
    "a refused check-in never stamped an arrival",
    mixed.wins === 2
      ? mixedRow.checkedInAt !== null
      : mixedRow.checkedInAt === null,
    { wins: mixed.wins, checkedInAt: mixedRow.checkedInAt },
  );
  check(
    "the cancellation columns were written exactly once",
    mixedRow.cancelledAt !== null && mixedRow.cancellationReason === "called off",
    mixedRow,
  );
  check(
    "and the trail records each write that actually happened, no more",
    (await prisma.auditLog.count({
      where: {
        targetId: raceId,
        action: {
          in: [
            AUDIT_ACTIONS.APPOINTMENT_CANCELLED,
            AUDIT_ACTIONS.APPOINTMENT_CHECKED_IN,
          ],
        },
      },
    })) === mixed.wins,
  );

  // --- Two people moving the same appointment ------------------------------
  //
  // The worst failure available to this stage: both winning would turn ONE
  // appointment into TWO live rows.

  const moveId = await book(f, types, OTHER_DAY, "09:00", "09:30");
  const moves = await race(
    () =>
      rescheduleAppointment(f.actors.reception, moveId, {
        slotStart: iso(OTHER_DAY, "09:30"),
        slotEnd: iso(OTHER_DAY, "10:00"),
      }),
    () =>
      rescheduleAppointment(f.actors.admin, moveId, {
        slotStart: iso(OTHER_DAY, "10:00"),
        slotEnd: iso(OTHER_DAY, "10:30"),
      }),
  );

  check(
    "two people moving the same appointment at once: exactly one succeeds",
    moves.wins === 1,
    moves,
  );
  check(
    "the loser gets a clean conflict",
    moves.losses.length === 1 && isConflictError(moves.losses[0].reason),
    moves.losses.map((l) => l.reason),
  );
  check(
    "ONE original produced exactly ONE replacement",
    (await prisma.appointment.count({
      where: { rescheduledFromId: moveId },
    })) === 1,
  );

  const liveFromMove = await prisma.appointment.count({
    where: {
      OR: [{ id: moveId }, { rescheduledFromId: moveId }],
      activeSlotStart: { not: null },
    },
  });
  check(
    "and exactly one row out of that pair still occupies a slot",
    liveFromMove === 1,
    liveFromMove,
  );

  // --- A move racing a booking for the same target slot --------------------

  const contendId = await book(f, types, OTHER_DAY, "11:00", "11:30");
  const contest = await race(
    () =>
      rescheduleAppointment(f.actors.reception, contendId, {
        slotStart: iso(OTHER_DAY, "12:00"),
        slotEnd: iso(OTHER_DAY, "12:30"),
      }),
    () => book(f, types, OTHER_DAY, "12:00", "12:30"),
  );

  check(
    "a move and a booking racing for one slot: exactly one succeeds",
    contest.wins === 1,
    contest,
  );
  check(
    "exactly one row occupies the contested slot",
    (await prisma.appointment.count({
      where: {
        doctorId: f.doctor.id,
        activeSlotStart: at(OTHER_DAY, "12:00"),
      },
    })) === 1,
  );

  // --- Mirror-image moves, the deadlock the lock ordering prevents ---------

  const leftId = await book(f, types, OTHER_DAY, "13:00", "13:30");
  const rightId = await book(f, types, OTHER_DAY, "13:00", "13:30", {
    doctorId: f.doctorTwo.id,
  });

  const mirrored = await race(
    () =>
      rescheduleAppointment(f.actors.reception, leftId, {
        doctorId: f.doctorTwo.id,
        slotStart: iso(OTHER_DAY, "14:00"),
        slotEnd: iso(OTHER_DAY, "14:30"),
      }),
    () =>
      rescheduleAppointment(f.actors.admin, rightId, {
        doctorId: f.doctor.id,
        slotStart: iso(OTHER_DAY, "14:30"),
        slotEnd: iso(OTHER_DAY, "15:00"),
      }),
  );

  check(
    "two moves that swap doctors both succeed — no deadlock",
    mirrored.wins === 2,
    mirrored.losses.map((l) => l.reason),
  );

  // --- Nothing is left behind by a refusal --------------------------------

  const before = await prisma.appointment.count({
    where: { tenantId: f.tenant.id },
  });
  await expectThrows(
    "a refused move creates no row",
    isConflictError,
    () =>
      rescheduleAppointment(f.actors.reception, contendId, {
        slotStart: iso(OTHER_DAY, "12:00"),
        slotEnd: iso(OTHER_DAY, "12:30"),
      }),
  );
  check(
    "and the appointment count is unchanged",
    (await prisma.appointment.count({ where: { tenantId: f.tenant.id } })) ===
      before,
  );

  const locks = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*) AS n FROM (
       SELECT doctor_id, date, COUNT(*) c FROM doctor_schedule_locks
       GROUP BY doctor_id, date HAVING c > 1
     ) dupes`,
  );
  check(
    "never more than one lock row per doctor-day",
    Number(locks[0]?.n ?? 0) === 0,
    locks,
  );
}

// ---------------------------------------------------------------------------
// The trail, and what must never be in it
// ---------------------------------------------------------------------------

async function checkAudit(f: Fixture): Promise<void> {
  console.log("\nAudit");

  const rows = await prisma.auditLog.findMany({
    where: { actorTenantId: f.tenant.id },
    select: {
      action: true,
      targetType: true,
      targetId: true,
      beforeValue: true,
      afterValue: true,
      reason: true,
      actorUserId: true,
    },
  });

  const lifecycle = rows.filter((r) =>
    [
      AUDIT_ACTIONS.APPOINTMENT_RESCHEDULED,
      AUDIT_ACTIONS.APPOINTMENT_CANCELLED,
      AUDIT_ACTIONS.APPOINTMENT_NO_SHOW,
      AUDIT_ACTIONS.APPOINTMENT_CHECKED_IN,
    ].includes(r.action as never),
  );

  check("all four lifecycle actions were written", lifecycle.length > 0);

  for (const action of [
    AUDIT_ACTIONS.APPOINTMENT_RESCHEDULED,
    AUDIT_ACTIONS.APPOINTMENT_CANCELLED,
    AUDIT_ACTIONS.APPOINTMENT_NO_SHOW,
    AUDIT_ACTIONS.APPOINTMENT_CHECKED_IN,
  ]) {
    check(
      `${action} appears in the trail`,
      lifecycle.some((r) => r.action === action),
    );
  }

  check(
    "every lifecycle row is filed against an Appointment",
    lifecycle.every((r) => r.targetType === "Appointment" && Boolean(r.targetId)),
  );
  check(
    "every lifecycle row names the person who did it",
    lifecycle.every((r) => Boolean(r.actorUserId)),
  );

  // The rule that matters most: the trail is append-only and is read during
  // support work, so it carries the scheduling fact and nothing about the
  // patient.
  const metadata = JSON.stringify(
    lifecycle.map((r) => ({ before: r.beforeValue, after: r.afterValue })),
  );

  for (const [label, value] of [
    ["the patient's name", PII.name],
    ["their mobile number", PII.mobileNumber],
    ["their address", PII.address],
    ["their city", PII.city],
    ["their patient id", f.patient.id],
  ] as const) {
    check(`no metadata anywhere contains ${label}`, !metadata.includes(value));
  }

  check(
    "no metadata key looks like a secret",
    !/password|token|secret|otp|pepper|apikey|authorization/i.test(metadata),
  );
  check(
    "and no patient code appears either",
    !metadata.includes("PT-AP4-"),
  );

  // Every lifecycle row carries the same scheduling shape.
  check(
    "every lifecycle row records the status either side of the change",
    lifecycle.every(
      (r) =>
        typeof (r.beforeValue as { status?: string })?.status === "string" &&
        typeof (r.afterValue as { status?: string })?.status === "string",
    ),
  );
  check(
    "and the doctor, clinic, day and times",
    lifecycle.every((r) => {
      const after = r.afterValue as Record<string, unknown>;
      return (
        typeof after?.doctorId === "string" &&
        typeof after?.clinicId === "string" &&
        typeof after?.date === "string" &&
        typeof after?.startTime === "string"
      );
    }),
  );

  const noShowRows = rows.filter(
    (r) => r.action === AUDIT_ACTIONS.APPOINTMENT_NO_SHOW,
  );
  check(
    "a no-show's actor and note live in the trail, since the row's columns stay null",
    noShowRows.every((r) => Boolean(r.actorUserId)),
  );
}

// ---------------------------------------------------------------------------
// Invariants, over every row the fixture produced
// ---------------------------------------------------------------------------

async function checkInvariants(f: Fixture): Promise<void> {
  console.log("\nInvariants");

  const rows = await prisma.appointment.findMany({
    where: { tenantId: f.tenant.id },
    select: {
      id: true,
      status: true,
      slotStart: true,
      slotEnd: true,
      activeSlotStart: true,
      doctorId: true,
      clinicId: true,
      tenantId: true,
      rescheduledFromId: true,
    },
  });

  check(`${rows.length} appointment rows to check`, rows.length > 0);

  check(
    "AP-1 RULE 3: activeSlotStart is exactly what the status says it should be",
    rows.every((r) => {
      const expected = activeSlotStartForStatus(
        r.status as AppointmentStatus,
        r.slotStart,
      );
      return expected === null
        ? r.activeSlotStart === null
        : r.activeSlotStart?.getTime() === expected.getTime();
    }),
    rows
      .filter(
        (r) =>
          (activeSlotStartForStatus(r.status as AppointmentStatus, r.slotStart) ===
            null) !==
          (r.activeSlotStart === null),
      )
      .map((r) => ({ id: r.id, status: r.status, active: r.activeSlotStart })),
  );

  check(
    "no appointment spans two days",
    rows.every(
      (r) =>
        r.slotStart.toISOString().slice(0, 10) ===
        r.slotEnd.toISOString().slice(0, 10),
    ),
  );

  check(
    "every appointment ends after it starts",
    rows.every((r) => r.slotEnd.getTime() > r.slotStart.getTime()),
  );

  // No two live rows may overlap for one doctor. This is the invariant the
  // whole stage protects, asserted over the finished state rather than trusted.
  const live = rows.filter((r) => r.activeSlotStart !== null);
  let overlaps = 0;

  for (let i = 0; i < live.length; i += 1) {
    for (let j = i + 1; j < live.length; j += 1) {
      const a = live[i];
      const b = live[j];
      if (a.doctorId !== b.doctorId) continue;
      if (
        a.slotStart.getTime() < b.slotEnd.getTime() &&
        a.slotEnd.getTime() > b.slotStart.getTime()
      ) {
        overlaps += 1;
      }
    }
  }

  check("NO TWO LIVE APPOINTMENTS OVERLAP for any doctor", overlaps === 0, overlaps);

  check(
    "every reschedule link points at a row that was itself retired",
    rows
      .filter((r) => r.rescheduledFromId !== null)
      .every((r) => {
        const parent = rows.find((p) => p.id === r.rescheduledFromId);
        return parent?.status === "RESCHEDULED" && parent.activeSlotStart === null;
      }),
  );

  check(
    "no row was orphaned into another tenant or clinic",
    rows.every((r) => r.tenantId === f.tenant.id),
  );
}

// ---------------------------------------------------------------------------
// AP-2 and AP-3 still behave
// ---------------------------------------------------------------------------

async function checkRegression(f: Fixture, types: TypeIds): Promise<void> {
  console.log("\nAP-2 and AP-3 regression");

  const id = await book(f, types, DAY, "12:00", "12:30");

  const busy = await getAppointmentSlots(f.actors.reception, {
    clinicId: f.clinic.id,
    doctorId: f.doctor.id,
    appointmentTypeId: types.standard,
    date: DAY,
  });
  const busySlot = busy.slots.find((s) => s.start === "12:00");
  check(
    "a booked slot shows as taken in the slot picker",
    busySlot?.status === "booked",
    busySlot,
  );
  check(
    "and carries the appointment id, so it can be opened",
    busySlot?.bookingId === id,
    busySlot,
  );

  await cancelAppointment(f.actors.reception, id);

  const free = await getAppointmentSlots(f.actors.reception, {
    clinicId: f.clinic.id,
    doctorId: f.doctor.id,
    appointmentTypeId: types.standard,
    date: DAY,
  });
  const freeSlot = free.slots.find((s) => s.start === "12:00");
  check(
    "and available again the moment it is cancelled",
    freeSlot?.status === "available",
    freeSlot,
  );
  check(
    "with no appointment id left hanging off it",
    freeSlot?.bookingId === undefined,
    freeSlot,
  );

  const board = await listAppointments(f.actors.reception, { date: DAY });
  check(
    "the board hides cancelled appointments by default",
    !board.rows.some((r) => r.id === id),
  );

  const history = await listAppointments(f.actors.reception, {
    date: DAY,
    includeHistory: true,
  });
  check(
    "and shows them when history is asked for",
    history.rows.some((r) => r.id === id),
  );

  const byStatus = await listAppointments(f.actors.reception, {
    date: DAY,
    status: "CANCELLED",
  });
  check(
    "filtering by CANCELLED finds it too",
    byStatus.rows.some((r) => r.id === id),
    byStatus.rows.length,
  );
  check(
    "and returns only cancelled rows",
    byStatus.rows.every((r) => r.status === "CANCELLED"),
  );

  const checkedIn = await listAppointments(f.actors.reception, {
    date: DAY,
    status: "CHECKED_IN",
  });
  check(
    "a checked-in appointment is on the default board, because it still holds the slot",
    checkedIn.rows.every((r) => r.status === "CHECKED_IN"),
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("AP-4 — reschedule, cancel, no-show and check-in\n");

  await sweepLeftovers();

  const before = await countEverything();
  let fixture: Fixture | null = null;

  try {
    fixture = await build();
    const types = await buildTypes(fixture);

    const checkedInId = await checkCheckIn(fixture, types);
    const cancelledId = await checkCancel(fixture, types);
    const noShowId = await checkNoShow(fixture, types);
    await checkTerminalStates(
      fixture,
      types,
      cancelledId,
      noShowId,
      checkedInId,
    );
    await checkReschedule(fixture, types);
    await checkAuthorisation(fixture, types);
    await checkConcurrency(fixture, types);
    await checkAudit(fixture);
    await checkRegression(fixture, types);
    await checkInvariants(fixture);
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
