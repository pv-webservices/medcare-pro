/**
 * AP-5 verification — converting an arrived appointment into a Registration,
 * against a LOCAL database.
 *
 *     npm run verify:ap5-appointment-conversion
 *
 * tests/unit/appointmentConversionRules.test.ts already pins every rule that
 * can be decided without rows: which statuses convert, how a refusal reads,
 * what the audit payload may contain, and which of the two unique indexes a
 * P2002 came from. This script exists for the six things it cannot reach:
 *
 *   1. THAT THE REUSE IS REAL. Conversion must go through
 *      lib/registrations.ts's own creation path — a Patient created only when
 *      there is not one already, a PT-YYYY-#### code minted by the one function
 *      allowed to mint it, and a registration_edit_log row written with it. A
 *      forked copy would pass every unit test and still be a second set of
 *      FR-3.1 rules waiting to drift.
 *   2. THE LINK, AND ITS UNIQUENESS. `registrations.appointment_id` is UNIQUE
 *      and that is the database-level guard against a double conversion. That
 *      is a claim about an index, not about a value.
 *   3. OCCUPANCY AFTER THE FACT. CONVERTED keeps the doctor's time, so the slot
 *      must still be unbookable once the visit exists.
 *   4. ATOMICITY. The registration, the status change and the audit row share
 *      one transaction. A rollback must leave none of the three.
 *   5. AUTHORISATION over real roles — that a doctor may look and not convert,
 *      that a clinic-scoped receptionist cannot reach a sibling's diary, that
 *      neither reaches another organisation's, and that the PREMIUM feature
 *      gate refuses before any of it.
 *   6. CONCURRENCY. Two receptionists converting the same arrival is the
 *      failure this stage is built around. It cannot be simulated: it needs two
 *      transactions, real InnoDB locks, and a genuine loser.
 *
 * Everything it creates lives under tenants named `verify-ap5-conversion` and is
 * torn down at the end. Row counts on every pre-existing table are asserted
 * before and after, so a bug here that touched real data would be visible.
 *
 * Refuses to run unless DATABASE_URL points at localhost.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BadRequestError, ConflictError } from "@/lib/apiHandler";
import {
  ALREADY_CONVERTED_MESSAGE,
  DEPARTMENT_REQUIRED_MESSAGE,
  convertAppointmentToRegistration,
} from "@/lib/appointmentConversion";
import {
  cancelAppointment,
  checkInAppointment,
  markAppointmentNoShow,
} from "@/lib/appointmentLifecycle";
import { appointmentTransaction } from "@/lib/appointmentLocks";
import { rescheduleAppointment } from "@/lib/appointmentReschedule";
import { createAppointment } from "@/lib/appointments";
import {
  createAppointmentType,
  updateAppointmentType,
} from "@/lib/appointmentTypes";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";
import { describeAuditAction } from "@/lib/auditDescriptions";
import { formatClockTime, formatDateOnly } from "@/lib/dates";
import { DEFAULT_PLAN_KEY, seedFeatureCatalogue } from "@/lib/defaultFeatures";
import { ROLE_KEYS, seedDefaultRoles } from "@/lib/defaultRoles";
import { FeatureError } from "@/lib/featureResolution";
import { PermissionError, ScopeError, type ActorContext } from "@/lib/rbac";
import {
  buildCreationSnapshot,
  createRegistration,
  insertRegistrationWithin,
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

const TEST_TENANT_NAME = "verify-ap5-conversion";

/** The working day every conversion in this script happens on. */
const DAY = "2026-12-21";
/** A second day, so a reschedule has somewhere to land. */
const OTHER_DAY = "2026-12-22";

const iso = (day: string, time: string): string => `${day}T${time}:00.000Z`;
const at = (day: string, time: string): Date => new Date(iso(day, time));
const dayOnly = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

/** Distinctive enough that finding any of it in an audit row is unambiguous. */
const PII = {
  name: "Zzyzx Ap5 Patient",
  mobileNumber: "9876500055",
  address: "55 Disclosure Drive",
  city: "Leakstown",
  gender: "female",
  age: 918275,
};

const DEPARTMENT = "AP-5 Cardiology";
/** The price quoted at booking. Re-priced mid-script; the visit must not move. */
const BOOKED_AMOUNT = 750;
const REPRICED_AMOUNT = 1250;

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
    registrationEditLogs,
    availability,
    appointments,
    appointmentTypes,
    scheduleLocks,
    roles,
    userRoles,
    features,
    auditLogs,
    notifications,
  ] = await Promise.all([
    prisma.tenant.count(),
    prisma.clinic.count(),
    prisma.user.count(),
    prisma.doctor.count(),
    prisma.patient.count(),
    prisma.registration.count(),
    prisma.registrationEditLog.count(),
    prisma.doctorAvailability.count(),
    prisma.appointment.count(),
    prisma.appointmentType.count(),
    prisma.doctorScheduleLock.count(),
    prisma.role.count(),
    prisma.userRole.count(),
    prisma.feature.count(),
    prisma.auditLog.count(),
    prisma.notification.count(),
  ]);

  return {
    tenants,
    clinics,
    users,
    doctors,
    patients,
    registrations,
    registrationEditLogs,
    availability,
    appointments,
    appointmentTypes,
    scheduleLocks,
    roles,
    userRoles,
    features,
    auditLogs,
    notifications,
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

  const clinic = await makeClinic(tenant.id, "AP-5 Alpha");
  const sibling = await makeClinic(tenant.id, "AP-5 Beta");
  const rivalClinic = await makeClinic(rival.id, "AP-5 Rival");

  const makeDoctor = (clinicId: string, name: string, department: string) =>
    prisma.doctor.create({
      data: { clinicId, name, department },
      select: { id: true, clinicId: true, department: true },
    });

  const doctor = await makeDoctor(clinic.id, "AP-5 Dr Alpha", DEPARTMENT);
  // The subject of the missing-department check. Created WITH a department,
  // because lib/doctors.ts and the NOT NULL column both refuse an empty one —
  // it is blanked by raw SQL below, which is the only way that row can exist.
  const blankDoctor = await makeDoctor(
    clinic.id,
    "AP-5 Dr No Department",
    "placeholder",
  );
  const siblingDoctor = await makeDoctor(
    sibling.id,
    "AP-5 Dr Beta",
    "AP-5 Dermatology",
  );
  const rivalDoctor = await makeDoctor(
    rivalClinic.id,
    "AP-5 Dr Rival",
    "AP-5 Neurology",
  );

  // The state no supported path produces. Raw, because Prisma's own validation
  // and lib/doctors.ts's Zod schema both stop short of it, and the guard in
  // lib/appointmentConversionRules.ts exists precisely for a row that arrived
  // another way.
  await prisma.$executeRaw`
    UPDATE doctors SET department = '' WHERE id = ${blankDoctor.id}
  `;

  for (const d of [doctor, blankDoctor, siblingDoctor, rivalDoctor]) {
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
  const rivalReceptionRoleId = await roleId(rival.id, ROLE_KEYS.RECEPTIONIST);

  // Runs the whole booking desk EXCEPT conversion. The subject of the 403: the
  // difference between this role and Receptionist is one permission, so a
  // refusal here can only be `appointment:convert` doing its job.
  const noConvertRole = await prisma.role.create({
    data: {
      tenantId: tenant.id,
      name: "AP-5 Desk without conversion",
      permissions: [
        "appointment:read",
        "appointment:create",
        "appointment:checkin",
        "appointment:cancel",
        // registration:create deliberately INCLUDED, to prove conversion does
        // not fall back to it: holding the registration permission must not
        // substitute for holding the appointment one.
        "registration:create",
        "registration:read",
      ],
      isSystem: false,
    },
    select: { id: true },
  });

  // Holds convert but has NO layer-3 row, so the module denies before the
  // permission is ever consulted.
  const unentitledRole = await prisma.role.create({
    data: {
      tenantId: tenant.id,
      name: "AP-5 Front desk, module off",
      permissions: [
        "appointment:read",
        "appointment:create",
        "appointment:checkin",
        "appointment:convert",
      ],
      isSystem: false,
    },
    select: { id: true },
  });

  // `appointments` is PREMIUM, so an ABSENT RoleFeatureAccess row DENIES. Every
  // role meant to reach the module needs an explicit row.
  //
  // THE DOCTOR AND STAFF ROLES ARE IN THIS LIST DELIBERATELY, even though
  // neither may convert. The feature gate runs BEFORE the permission gate, so
  // without a row here they would be refused at layer 3 and the layer-4 refusal
  // would never be reached — the permission check would look tested when it was
  // not.
  for (const id of [
    adminRoleId,
    receptionRoleId,
    doctorRoleId,
    staffRoleId,
    rivalReceptionRoleId,
    noConvertRole.id,
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
  const noConvertUser = await makeUser("noconvert", tenant.id);
  const noModuleUser = await makeUser("nomodule", tenant.id);
  const rivalUser = await makeUser("rival", rival.id);

  const assign = (userId: string, roleId: string, clinicId: string | null) =>
    prisma.userRole.create({ data: { userId, roleId, clinicId } });

  await assign(adminUser.id, adminRoleId, null);
  await assign(receptionUser.id, receptionRoleId, null);
  await assign(doctorUser.id, doctorRoleId, null);
  await assign(staffUser.id, staffRoleId, null);
  await assign(noConvertUser.id, noConvertRole.id, null);
  await assign(noModuleUser.id, unentitledRole.id, null);
  await assign(rivalUser.id, rivalReceptionRoleId, null);
  // Clinic-scoped to the SIBLING only — the clinic-isolation subject.
  await assign(siblingUser.id, receptionRoleId, sibling.id);

  const actor = (userId: string, tenantId: string): ActorContext => ({
    userId,
    tenantId,
  });

  // A patient who already exists at Alpha, for the return-visit path. Carries
  // the loud PII so a leak into the audit trail is unmistakable.
  const patient = await prisma.patient.create({
    data: {
      tenantId: tenant.id,
      clinicId: clinic.id,
      patientCode: `PT-AP5-${stamp}`,
      ...PII,
    },
    select: { id: true, patientCode: true },
  });

  return {
    stamp,
    tenant,
    rival,
    clinic,
    sibling,
    rivalClinic,
    doctor,
    blankDoctor,
    siblingDoctor,
    rivalDoctor,
    patient,
    appointmentsFeature,
    users: { reception: receptionUser, admin: adminUser },
    actors: {
      admin: actor(adminUser.id, tenant.id),
      reception: actor(receptionUser.id, tenant.id),
      doctor: actor(doctorUser.id, tenant.id),
      staff: actor(staffUser.id, tenant.id),
      sibling: actor(siblingUser.id, tenant.id),
      noConvert: actor(noConvertUser.id, tenant.id),
      noModule: actor(noModuleUser.id, tenant.id),
      rival: actor(rivalUser.id, rival.id),
    },
  };
}

type Fixture = Awaited<ReturnType<typeof build>>;

async function purgeTenant(tenantId: string): Promise<void> {
  // RESTRICT foreign keys mean the children go first. Deleting a registration
  // cascades its registration_edit_log rows; deleting an appointment is a
  // FIXTURE operation and never something the app does.
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

async function teardown(fixture: Fixture): Promise<void> {
  for (const tenantId of [fixture.tenant.id, fixture.rival.id]) {
    await purgeTenant(tenantId);
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
    await purgeTenant(tenant.id);
  }

  if (stale.length > 0) {
    console.log(`  (swept ${stale.length} leftover fixture tenant(s))`);
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

interface TypeIds {
  /** 30 minutes at BOOKED_AMOUNT. Re-priced part-way through the script. */
  standard: string;
  /** 30 minutes, never re-priced. */
  steady: string;
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
    standard: await make("AP-5 Consultation", 30, BOOKED_AMOUNT),
    steady: await make("AP-5 Steady", 30, BOOKED_AMOUNT),
  };
}

interface BookOptions {
  doctorId?: string;
  typeId?: string;
  patientId?: string | null;
  clinicId?: string;
  actor?: ActorContext;
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
  const created = await createAppointment(options.actor ?? f.actors.reception, {
    clinicId: options.clinicId ?? f.clinic.id,
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

/** Books, then checks in — the only state conversion accepts. */
async function arrived(
  f: Fixture,
  types: TypeIds,
  day: string,
  start: string,
  end: string,
  options: BookOptions = {},
): Promise<string> {
  const id = await book(f, types, day, start, end, options);
  await checkInAppointment(options.actor ?? f.actors.reception, id);
  return id;
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
      amount: true,
      name: true,
      mobileNumber: true,
      checkedInAt: true,
    },
  });

const registrationFor = (appointmentId: string) =>
  prisma.registration.findUnique({
    where: { appointmentId },
    select: {
      id: true,
      clinicId: true,
      patientId: true,
      doctorId: true,
      department: true,
      amount: true,
      visitDate: true,
      visitType: true,
      createdBy: true,
      appointmentId: true,
      patient: { select: { id: true, patientCode: true, tenantId: true } },
      editLog: { select: { id: true, roleAtTime: true, changedFields: true } },
    },
  });

const countRegistrations = (appointmentId: string) =>
  prisma.registration.count({ where: { appointmentId } });

const countConversionAudit = (appointmentId: string) =>
  prisma.auditLog.count({
    where: {
      action: AUDIT_ACTIONS.APPOINTMENT_CONVERTED,
      targetId: appointmentId,
    },
  });

// ---------------------------------------------------------------------------
// The happy path: a first-time patient
// ---------------------------------------------------------------------------

async function checkNewPatient(f: Fixture, types: TypeIds): Promise<string> {
  console.log("\nConverting a first-time patient");

  const patientsBefore = await prisma.patient.count({
    where: { tenantId: f.tenant.id },
  });

  const id = await arrived(f, types, DAY, "09:00", "09:30");
  const before = await row(id);

  // Re-price the TYPE between booking and conversion. The visit must carry what
  // the patient was quoted, not what the price list says now.
  await updateAppointmentType(f.actors.admin, types.standard, {
    defaultAmount: REPRICED_AMOUNT,
  });

  const result = await convertAppointmentToRegistration(f.actors.reception, id);
  const after = await row(id);
  const registration = await registrationFor(id);

  check("the appointment is now CONVERTED", after.status === "CONVERTED", after.status);
  check(
    "and it still occupies the doctor's time — active_slot_start unchanged",
    after.activeSlotStart !== null &&
      after.activeSlotStart.getTime() === before.slotStart.getTime(),
    { before: before.activeSlotStart, after: after.activeSlotStart },
  );
  check(
    "slot_start and slot_end were not touched",
    after.slotStart.getTime() === before.slotStart.getTime() &&
      after.slotEnd.getTime() === before.slotEnd.getTime(),
    after,
  );

  check("exactly one registration is linked to it", (await countRegistrations(id)) === 1);
  check("the registration exists", registration !== null, registration);

  if (!registration) {
    return id;
  }

  check(
    "linked back through appointment_id",
    registration.appointmentId === id,
    registration.appointmentId,
  );
  check(
    "filed at the appointment's clinic",
    registration.clinicId === f.clinic.id,
    registration.clinicId,
  );
  check(
    "attributed to the appointment's doctor",
    registration.doctorId === f.doctor.id,
    registration.doctorId,
  );
  check(
    "department taken from the doctor",
    registration.department === DEPARTMENT,
    registration.department,
  );
  check(
    "amount is what was QUOTED, not the re-priced type",
    registration.amount.toFixed(2) === before.amount.toFixed(2) &&
      registration.amount.toNumber() === BOOKED_AMOUNT,
    { registration: registration.amount.toFixed(2), booked: before.amount.toFixed(2) },
  );
  check(
    "visit_date is the slot's own wall-clock instant",
    registration.visitDate.getTime() === before.slotStart.getTime(),
    { visitDate: registration.visitDate, slotStart: before.slotStart },
  );
  check(
    "visit_date splits back into the day and time booked",
    formatDateOnly(registration.visitDate) === DAY &&
      formatClockTime(registration.visitDate) === "09:00",
    registration.visitDate,
  );
  check(
    "recorded against the user who converted it",
    registration.createdBy === f.actors.reception.userId,
    registration.createdBy,
  );
  check(
    "marked NEW — this is their first visit",
    registration.visitType === "NEW",
    registration.visitType,
  );

  // --- the Patient the conversion minted -----------------------------------

  check(
    "exactly one new patient was created",
    (await prisma.patient.count({ where: { tenantId: f.tenant.id } })) ===
      patientsBefore + 1,
  );
  // NOT BACK-LINKED, and this is a deliberate reading of the AP-5 spec rather
  // than an oversight. That spec enumerates what the conversion transaction
  // writes — the registration, the status, the audit row — and setting
  // `appointments.patient_id` is not among them. So the link runs one way:
  // appointment -> registration -> patient. Asserted rather than left silent,
  // because the consequence is real and belongs in front of whoever picks up
  // AP-6: `patient.appointments` will not list the appointment that created
  // that patient, and the board still reads this arrival as "not a patient
  // here yet". Flagged as an AP-6 carry-forward.
  check(
    "the appointment is NOT back-linked to the patient it created (AP-5 spec)",
    after.patientId === null,
    { appointment: after.patientId, registration: registration.patientId },
  );
  check(
    "  ...but the patient is still reachable through the registration",
    registration.patientId === registration.patient.id,
    registration.patientId,
  );
  check(
    "the patient carries a well-formed PT-YYYY-#### code",
    /^PT-\d{4}-\d{4}$/.test(registration.patient.patientCode),
    registration.patient.patientCode,
  );
  check(
    "the code is unique tenant-wide",
    (await prisma.patient.count({
      where: {
        tenantId: f.tenant.id,
        patientCode: registration.patient.patientCode,
      },
    })) === 1,
  );
  check(
    "the patient is denormalised onto the right tenant",
    registration.patient.tenantId === f.tenant.id,
    registration.patient.tenantId,
  );

  // --- the audit trail lib/registrations.ts writes --------------------------

  check(
    "one registration_edit_log row was written with it",
    registration.editLog.length === 1,
    registration.editLog,
  );
  check(
    "and it captured the converting user's role at the time",
    (registration.editLog[0]?.roleAtTime ?? "") !== "" &&
      registration.editLog[0]?.roleAtTime !== "unknown",
    registration.editLog[0]?.roleAtTime,
  );

  // --- what the caller gets back -------------------------------------------

  check(
    "the result names the registration it created",
    result.registrationId === registration.id,
    result,
  );
  check(
    "and reports it as a new patient, with the code",
    result.isNewPatient &&
      result.patientCode === registration.patient.patientCode,
    result,
  );
  check(
    "the returned appointment view says CONVERTED",
    result.appointment.status === "CONVERTED",
    result.appointment.status,
  );

  // --- FR-7.1 --------------------------------------------------------------

  check(
    "a registration.created notification was raised",
    (await prisma.notification.count({
      where: { tenantId: f.tenant.id, relatedRecordId: registration.id },
    })) === 1,
  );

  // Put the price list back, so later bookings quote the usual amount.
  await updateAppointmentType(f.actors.admin, types.standard, {
    defaultAmount: BOOKED_AMOUNT,
  });

  return id;
}

// ---------------------------------------------------------------------------
// The happy path: somebody already on the register
// ---------------------------------------------------------------------------

async function checkExistingPatient(f: Fixture, types: TypeIds): Promise<void> {
  console.log("\nConverting a return visit");

  const patientsBefore = await prisma.patient.count({
    where: { tenantId: f.tenant.id },
  });

  const id = await arrived(f, types, DAY, "10:00", "10:30", {
    patientId: f.patient.id,
  });

  await convertAppointmentToRegistration(f.actors.reception, id);

  const registration = await registrationFor(id);

  check("the registration exists", registration !== null);

  if (!registration) {
    return;
  }

  check(
    "no new patient was created",
    (await prisma.patient.count({ where: { tenantId: f.tenant.id } })) ===
      patientsBefore,
  );
  check(
    "the existing patient was reused",
    registration.patientId === f.patient.id,
    registration.patientId,
  );
  check(
    "no new Patient ID was minted",
    registration.patient.patientCode === f.patient.patientCode,
    registration.patient.patientCode,
  );
  check(
    "marked FOLLOW_UP",
    registration.visitType === "FOLLOW_UP",
    registration.visitType,
  );
  check(
    "still takes its department from the doctor",
    registration.department === DEPARTMENT,
    registration.department,
  );
  check(
    "and its own edit-log row",
    registration.editLog.length === 1,
    registration.editLog,
  );
}

// ---------------------------------------------------------------------------
// Which statuses may not convert
// ---------------------------------------------------------------------------

async function checkIneligibleStatuses(
  f: Fixture,
  types: TypeIds,
  convertedId: string,
): Promise<void> {
  console.log("\nStatuses that may not convert");

  const refuse = async (label: string, appointmentId: string) => {
    const registrationsBefore = await prisma.registration.count();

    await expectThrows(label, isConflictError, () =>
      convertAppointmentToRegistration(f.actors.reception, appointmentId),
    );

    check(
      `  ...and ${label} created no registration`,
      (await prisma.registration.count()) === registrationsBefore &&
        (await countRegistrations(appointmentId)) === 0,
    );
  };

  // Booked but not arrived. THE CENTRAL PRODUCT RULE OF THIS STAGE.
  await refuse("a SCHEDULED appointment is refused", await book(f, types, DAY, "11:00", "11:30"));

  // CONFIRMED has no endpoint that reaches it — there is deliberately no
  // confirm operation (see the AP-4 header), so the row is put into that state
  // directly. This is a fixture manipulation of a state the enum allows.
  const confirmedId = await book(f, types, DAY, "11:30", "12:00");
  await prisma.appointment.update({
    where: { id: confirmedId },
    data: { status: "CONFIRMED" },
  });
  await refuse("a CONFIRMED appointment without check-in is refused", confirmedId);

  const cancelledId = await book(f, types, DAY, "12:00", "12:30");
  await cancelAppointment(f.actors.reception, cancelledId, { reason: "called off" });
  await refuse("a CANCELLED appointment is refused", cancelledId);

  const noShowId = await book(f, types, DAY, "12:30", "13:00");
  await markAppointmentNoShow(f.actors.reception, noShowId);
  await refuse("a NO_SHOW appointment is refused", noShowId);

  const rescheduledId = await book(f, types, DAY, "13:00", "13:30");
  const moved = await rescheduleAppointment(f.actors.reception, rescheduledId, {
    slotStart: iso(OTHER_DAY, "13:00"),
    slotEnd: iso(OTHER_DAY, "13:30"),
  });
  await refuse("a RESCHEDULED appointment is refused", rescheduledId);
  check(
    "  ...while the row it moved to is untouched and still convertible",
    (await row(moved.appointment.id)).status === "SCHEDULED",
  );

  // --- and the one that must not repeat ------------------------------------

  const auditBefore = await countConversionAudit(convertedId);

  await expectThrows(
    "a second conversion of the same appointment is refused",
    isConflictError,
    () => convertAppointmentToRegistration(f.actors.reception, convertedId),
  );
  check(
    "  ...with the message a receptionist can act on",
    await (async () => {
      try {
        await convertAppointmentToRegistration(f.actors.reception, convertedId);
        return false;
      } catch (error: unknown) {
        return (
          error instanceof ConflictError &&
          error.message === ALREADY_CONVERTED_MESSAGE
        );
      }
    })(),
  );
  check(
    "  ...leaving exactly one registration",
    (await countRegistrations(convertedId)) === 1,
  );
  check(
    "  ...and writing no second audit row",
    (await countConversionAudit(convertedId)) === auditBefore,
  );
}

// ---------------------------------------------------------------------------
// A doctor with no department
// ---------------------------------------------------------------------------

async function checkMissingDepartment(f: Fixture, types: TypeIds): Promise<void> {
  console.log("\nA doctor with no department");

  const id = await arrived(f, types, DAY, "14:00", "14:30", {
    doctorId: f.blankDoctor.id,
    typeId: types.steady,
  });

  const registrationsBefore = await prisma.registration.count();

  await expectThrows(
    "conversion is refused rather than defaulting the department",
    isBadRequestError,
    () => convertAppointmentToRegistration(f.actors.reception, id),
  );

  check(
    "the message says what to fix",
    await (async () => {
      try {
        await convertAppointmentToRegistration(f.actors.reception, id);
        return false;
      } catch (error: unknown) {
        return (
          error instanceof BadRequestError &&
          error.message === DEPARTMENT_REQUIRED_MESSAGE
        );
      }
    })(),
  );
  check(
    "no partial registration was written",
    (await prisma.registration.count()) === registrationsBefore &&
      (await countRegistrations(id)) === 0,
  );
  check(
    "no patient was minted for the refused conversion",
    (await prisma.patient.count({
      where: { tenantId: f.tenant.id, name: PII.name, registrations: { none: {} } },
    })) === 0,
  );
  check(
    "the appointment is still CHECKED_IN, waiting",
    (await row(id)).status === "CHECKED_IN",
  );
  check("and no audit row was written", (await countConversionAudit(id)) === 0);
}

// ---------------------------------------------------------------------------
// Authorisation
// ---------------------------------------------------------------------------

async function checkAuthorisation(f: Fixture, types: TypeIds): Promise<void> {
  console.log("\nAuthorisation");

  const id = await arrived(f, types, DAY, "15:00", "15:30", {
    typeId: types.steady,
  });

  // 404, not 403: telling another organisation that an id exists is itself a
  // cross-tenant disclosure.
  await expectThrows(
    "another organisation cannot reach it at all",
    isScopeError,
    () => convertAppointmentToRegistration(f.actors.rival, id),
  );

  await expectThrows(
    "a receptionist scoped to a sibling clinic cannot reach it",
    isScopeError,
    () => convertAppointmentToRegistration(f.actors.sibling, id),
  );

  // The Doctor role holds appointment:read, so it CAN see the appointment —
  // which is why this is a 403 and the two above are 404s.
  await expectThrows(
    "a doctor may look but not convert",
    isPermissionError,
    () => convertAppointmentToRegistration(f.actors.doctor, id),
  );

  // Staff holds no appointment permission at all, so it cannot even load it.
  await expectThrows(
    "staff cannot reach it",
    isScopeError,
    () => convertAppointmentToRegistration(f.actors.staff, id),
  );

  // The one that isolates the permission: this role runs the whole desk and
  // holds registration:create, and is refused purely for lacking convert.
  await expectThrows(
    "the desk without appointment:convert is refused, registration:create notwithstanding",
    isPermissionError,
    () => convertAppointmentToRegistration(f.actors.noConvert, id),
  );

  // Layer 3 beats layer 4: the module is checked first.
  await expectThrows(
    "a role with convert but no entitlement is refused by the feature gate",
    isFeatureError,
    () => convertAppointmentToRegistration(f.actors.noModule, id),
  );

  check(
    "none of the six refusals created a registration",
    (await countRegistrations(id)) === 0,
  );
  check(
    "and none of them wrote an audit row",
    (await countConversionAudit(id)) === 0,
  );
  check(
    "the appointment is untouched, still CHECKED_IN",
    (await row(id)).status === "CHECKED_IN",
  );

  // ...and the permitted caller still succeeds, so the refusals above are not
  // simply a broken fixture.
  await convertAppointmentToRegistration(f.actors.reception, id);
  check(
    "a receptionist with the permission converts it",
    (await countRegistrations(id)) === 1,
  );

  // An Admin holds the wildcard-free full catalogue, including convert.
  const adminId = await arrived(f, types, DAY, "15:30", "16:00", {
    typeId: types.steady,
  });
  await convertAppointmentToRegistration(f.actors.admin, adminId);
  check(
    "an admin converts too",
    (await countRegistrations(adminId)) === 1,
  );
}

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------

async function checkConcurrency(f: Fixture, types: TypeIds): Promise<void> {
  console.log("\nConcurrency");

  /**
   * Both calls are dispatched without awaiting the first, so they are in flight
   * together on separate pooled connections. The DoctorScheduleLock row and the
   * appointment's own row lock are what serialise them: the loser blocks until
   * the winner commits, then re-reads and sees CONVERTED.
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

  // --- Two receptionists converting the same arrival, new patient ----------

  const patientsBefore = await prisma.patient.count({
    where: { tenantId: f.tenant.id },
  });
  const id = await arrived(f, types, DAY, "16:00", "16:30", {
    typeId: types.steady,
  });

  const outcome = await race(
    () => convertAppointmentToRegistration(f.actors.reception, id),
    () => convertAppointmentToRegistration(f.actors.admin, id),
  );

  check(
    "two conversions at once: exactly one succeeds",
    outcome.wins === 1,
    outcome,
  );
  check(
    "the loser gets a clean conflict, not a deadlock or a 500",
    outcome.losses.length === 1 && isConflictError(outcome.losses[0].reason),
    outcome.losses.map((l) => l.reason),
  );
  check(
    "exactly one registration exists",
    (await countRegistrations(id)) === 1,
  );
  check(
    "exactly one audit row was written",
    (await countConversionAudit(id)) === 1,
  );
  check(
    "exactly one patient was minted — the loser left nothing behind",
    (await prisma.patient.count({ where: { tenantId: f.tenant.id } })) ===
      patientsBefore + 1,
  );

  const converted = await row(id);
  check(
    "the row ends CONVERTED with its occupancy intact",
    converted.status === "CONVERTED" &&
      converted.activeSlotStart !== null &&
      converted.activeSlotStart.getTime() === converted.slotStart.getTime(),
    converted,
  );

  const registration = await registrationFor(id);
  check(
    "and exactly one edit-log row, so the loser's did not survive either",
    registration?.editLog.length === 1,
    registration?.editLog,
  );

  // --- A conversion racing a cancellation ----------------------------------

  const mixedId = await arrived(f, types, DAY, "16:30", "17:00", {
    typeId: types.steady,
  });

  const mixed = await race(
    () => convertAppointmentToRegistration(f.actors.reception, mixedId),
    () => cancelAppointment(f.actors.admin, mixedId, { reason: "walked out" }),
  );

  // BOTH CANNOT SUCCEED. Unlike AP-4's cancel-versus-check-in, these two are
  // mutually exclusive: CONVERTED and CANCELLED are both terminal, so whichever
  // reaches the row lock first makes the other impossible.
  check(
    "converting and cancelling at once: exactly one succeeds",
    mixed.wins === 1,
    mixed,
  );

  const mixedRow = await row(mixedId);
  const mixedRegistrations = await countRegistrations(mixedId);

  check(
    "the row's status and occupancy agree — no half-written row",
    mixedRow.status === "CONVERTED"
      ? mixedRow.activeSlotStart?.getTime() === mixedRow.slotStart.getTime()
      : mixedRow.status === "CANCELLED" && mixedRow.activeSlotStart === null,
    mixedRow,
  );
  check(
    "a registration exists if and only if the conversion won",
    mixedRow.status === "CONVERTED"
      ? mixedRegistrations === 1
      : mixedRegistrations === 0,
    { status: mixedRow.status, registrations: mixedRegistrations },
  );
  check(
    "a cancelled appointment left no orphan registration",
    mixedRow.status !== "CANCELLED" || mixedRegistrations === 0,
  );
}

// ---------------------------------------------------------------------------
// Atomicity
// ---------------------------------------------------------------------------

/**
 * A forced rollback over the EXACT composition the conversion performs.
 *
 * The production function has no failure injection point, and inventing one
 * would mean shipping test scaffolding in a path that writes money. So this
 * runs the same three writes — `insertRegistrationWithin`, the status update
 * and `writeAuditLog` — through the same `appointmentTransaction` wrapper, then
 * throws. What it proves is the property that matters: those three share one
 * transaction, so an appointment can never end up CONVERTED without its
 * Registration, and no audit row can describe a change that did not happen.
 */
async function checkRollback(f: Fixture, types: TypeIds): Promise<void> {
  console.log("\nAtomicity");

  const id = await arrived(f, types, DAY, "09:30", "10:00", {
    typeId: types.steady,
  });

  const before = {
    registrations: await prisma.registration.count(),
    editLogs: await prisma.registrationEditLog.count(),
    patients: await prisma.patient.count({ where: { tenantId: f.tenant.id } }),
    audits: await prisma.auditLog.count({ where: { actorTenantId: f.tenant.id } }),
  };

  const appointment = await row(id);
  const input = {
    clinicId: appointment.clinicId,
    patientId: null,
    name: appointment.name,
    age: PII.age,
    gender: PII.gender,
    mobileNumber: appointment.mobileNumber,
    address: PII.address,
    city: PII.city,
    doctorId: appointment.doctorId,
    department: DEPARTMENT,
    amount: appointment.amount.toNumber(),
    visitDate: formatDateOnly(appointment.slotStart),
    visitTime: formatClockTime(appointment.slotStart),
    visitType: "NEW" as const,
  };

  try {
    await appointmentTransaction(prisma, async (tx) => {
      const inserted = await insertRegistrationWithin(
        tx,
        f.actors.reception,
        input,
        {
          existingPatientId: null,
          doctorId: appointment.doctorId,
          visitType: "NEW",
          roleAtTime: "Receptionist",
          snapshot: buildCreationSnapshot(input, "AP-5 Dr Alpha", "NEW"),
          appointmentId: id,
        },
      );

      await tx.appointment.update({
        where: { id },
        data: { status: "CONVERTED" },
      });

      await writeAuditLog(tx, {
        action: AUDIT_ACTIONS.APPOINTMENT_CONVERTED,
        targetType: "Appointment",
        targetId: id,
        actorUserId: f.actors.reception.userId,
        actorTenantId: f.tenant.id,
        afterValue: { registrationId: inserted.registrationId },
      });

      throw new Error("AP-5 forced rollback");
    });
    check("the forced failure propagated", false, "it did not throw");
  } catch (error: unknown) {
    check(
      "the forced failure propagated",
      error instanceof Error && error.message === "AP-5 forced rollback",
      error,
    );
  }

  check(
    "no registration survived the rollback",
    (await prisma.registration.count()) === before.registrations &&
      (await countRegistrations(id)) === 0,
  );
  check(
    "no registration_edit_log row survived",
    (await prisma.registrationEditLog.count()) === before.editLogs,
  );
  check(
    "no patient and no Patient ID were burned",
    (await prisma.patient.count({ where: { tenantId: f.tenant.id } })) ===
      before.patients,
  );
  check(
    "no audit row survived — the trail describes nothing that did not happen",
    (await prisma.auditLog.count({ where: { actorTenantId: f.tenant.id } })) ===
      before.audits,
  );
  check(
    "and the appointment is still CHECKED_IN, not CONVERTED",
    (await row(id)).status === "CHECKED_IN",
  );

  // The same appointment converts normally afterwards, so the rollback left no
  // lock, no half state and nothing that blocks the real path.
  await convertAppointmentToRegistration(f.actors.reception, id);
  check(
    "and it converts cleanly on the next real attempt",
    (await row(id)).status === "CONVERTED" &&
      (await countRegistrations(id)) === 1,
  );
}

// ---------------------------------------------------------------------------
// The audit trail
// ---------------------------------------------------------------------------

async function checkAudit(f: Fixture, convertedId: string): Promise<void> {
  console.log("\nAudit");

  const entry = await prisma.auditLog.findFirst({
    where: {
      action: AUDIT_ACTIONS.APPOINTMENT_CONVERTED,
      targetId: convertedId,
    },
    select: {
      action: true,
      targetType: true,
      targetId: true,
      actorUserId: true,
      actorTenantId: true,
      beforeValue: true,
      afterValue: true,
      reason: true,
    },
  });

  check("a conversion audit row exists", entry !== null);

  if (!entry) {
    return;
  }

  check("it targets the Appointment", entry.targetType === "Appointment", entry.targetType);
  check("it names the actor", entry.actorUserId === f.actors.reception.userId);
  check("and the organisation", entry.actorTenantId === f.tenant.id);

  const after = (entry.afterValue ?? {}) as Record<string, unknown>;
  const before = (entry.beforeValue ?? {}) as Record<string, unknown>;

  const registration = await registrationFor(convertedId);

  check(
    "the after side carries the registration id",
    after.registrationId === registration?.id,
    after,
  );
  check(
    "and the scheduling fact either side of the change",
    before.status === "CHECKED_IN" && after.status === "CONVERTED",
    { before: before.status, after: after.status },
  );

  // --- what must NOT be there ----------------------------------------------

  const serialised = JSON.stringify({ before, after });

  for (const [label, value] of Object.entries({
    "the patient's name": PII.name,
    "their mobile number": PII.mobileNumber,
    "their address": PII.address,
    "their city": PII.city,
  })) {
    check(`the trail carries none of ${label}`, !serialised.includes(value), serialised);
  }

  check(
    "no patient code anywhere in it",
    !/PT-\d{4}-/.test(serialised) && !/patientCode/i.test(serialised),
    serialised,
  );
  check(
    "no patient id either",
    !Object.keys({ ...before, ...after }).some((k) => /patient/i.test(k)),
    Object.keys({ ...before, ...after }),
  );

  // --- the catalogue -------------------------------------------------------

  const description = describeAuditAction(AUDIT_ACTIONS.APPOINTMENT_CONVERTED);
  check(
    "the action has a human description, so the audit screen can label it",
    description.label !== AUDIT_ACTIONS.APPOINTMENT_CONVERTED &&
      description.category === "appointments" &&
      description.side === "tenant",
    description,
  );
}

// ---------------------------------------------------------------------------
// Invariants, and everything AP-5 must not have changed
// ---------------------------------------------------------------------------

async function checkInvariants(f: Fixture, types: TypeIds): Promise<void> {
  console.log("\nInvariants and regressions");

  // --- a converted slot is still busy --------------------------------------

  await expectThrows(
    "a converted slot cannot be booked over",
    isConflictError,
    () => book(f, types, DAY, "09:00", "09:30"),
  );

  // --- the unique index, directly ------------------------------------------

  const converted = await prisma.registration.findFirstOrThrow({
    where: { clinic: { tenantId: f.tenant.id }, appointmentId: { not: null } },
    select: { id: true, appointmentId: true, clinicId: true, patientId: true },
  });

  let indexHeld = false;
  try {
    await prisma.registration.create({
      data: {
        clinicId: converted.clinicId,
        patientId: converted.patientId,
        department: DEPARTMENT,
        amount: "1.00",
        visitDate: at(DAY, "09:00"),
        createdBy: f.actors.admin.userId,
        appointmentId: converted.appointmentId,
      },
    });
  } catch (error: unknown) {
    indexHeld =
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002";
  }
  check(
    "registrations.appointment_id refuses a second row at the database level",
    indexHeld,
  );

  // --- nothing was deleted --------------------------------------------------

  const appointments = await prisma.appointment.findMany({
    where: { tenantId: f.tenant.id },
    select: { id: true, status: true, slotStart: true, activeSlotStart: true },
  });

  check(
    "every appointment this run created still exists",
    appointments.length > 0,
    appointments.length,
  );
  check(
    "and every CONVERTED one still occupies its slot",
    appointments
      .filter((a) => a.status === "CONVERTED")
      .every(
        (a) =>
          a.activeSlotStart !== null &&
          a.activeSlotStart.getTime() === a.slotStart.getTime(),
      ),
    appointments.filter((a) => a.status === "CONVERTED"),
  );
  check(
    "while every retired one released it",
    appointments
      .filter((a) => ["CANCELLED", "NO_SHOW", "RESCHEDULED"].includes(a.status))
      .every((a) => a.activeSlotStart === null),
    appointments.filter((a) =>
      ["CANCELLED", "NO_SHOW", "RESCHEDULED"].includes(a.status),
    ),
  );

  // --- direct registration is completely unaffected -------------------------

  const direct = await createRegistration(f.actors.reception, {
    clinicId: f.clinic.id,
    name: "AP-5 Walk-in",
    mobileNumber: "9876500099",
    age: 41,
    gender: "male",
    address: "1 Walk-in Way",
    city: "Townsville",
    doctorId: f.doctor.id,
    department: "AP-5 Walk-in Department",
    amount: 300,
    visitDate: DAY,
    visitTime: "08:00",
  });

  const directRow = await prisma.registration.findUniqueOrThrow({
    where: { id: direct.id },
    select: {
      appointmentId: true,
      department: true,
      visitType: true,
      amount: true,
      editLog: { select: { id: true } },
      patient: { select: { patientCode: true } },
    },
  });

  check(
    "a walk-in registration still has no appointment link",
    directRow.appointmentId === null,
    directRow.appointmentId,
  );
  check(
    "it keeps the department the form supplied, not a doctor's",
    directRow.department === "AP-5 Walk-in Department",
    directRow.department,
  );
  check("it is NEW", directRow.visitType === "NEW", directRow.visitType);
  check(
    "it still mints its own Patient ID",
    /^PT-\d{4}-\d{4}$/.test(directRow.patient.patientCode),
    directRow.patient.patientCode,
  );
  check(
    "and still writes its own edit-log row",
    directRow.editLog.length === 1,
    directRow.editLog,
  );
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("AP-5 — converting an appointment into a registration\n");

  await sweepLeftovers();

  const before = await countEverything();
  let fixture: Fixture | null = null;

  try {
    fixture = await build();
    const types = await buildTypes(fixture);

    const convertedId = await checkNewPatient(fixture, types);
    await checkExistingPatient(fixture, types);
    await checkIneligibleStatuses(fixture, types, convertedId);
    await checkMissingDepartment(fixture, types);
    await checkAuthorisation(fixture, types);
    await checkConcurrency(fixture, types);
    await checkRollback(fixture, types);
    await checkAudit(fixture, convertedId);
    await checkInvariants(fixture, types);
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
