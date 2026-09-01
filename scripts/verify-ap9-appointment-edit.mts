/**
 * AP-9 verification — correcting a booking, and confirming one, against a
 * LOCAL database.
 *
 *     npm run verify:ap9-appointment-edit
 *
 * AP-9 closes the appointments module: it builds the last pending permission's
 * call site and makes the one unreachable status reachable. Both are the sort
 * of change whose failures are silent, so this script asserts the things a
 * unit test cannot see:
 *
 *   1. THE LOCKED FIELDS ARE ACTUALLY LOCKED. `updateAppointmentSchema` has no
 *      vocabulary for a slot, a doctor, a service, a clinic, a patient link or
 *      a status, and zod STRIPS unknown keys rather than refusing them — which
 *      means a client sending them gets a 200 and no complaint. The only proof
 *      that the stored row was untouched is to send every one of them at once
 *      and read the row back. This is the central claim of the stage.
 *   2. A CONVERTED BOOKING CANNOT BE EDITED. Conversion copies the name, the
 *      number and the amount onto a Registration. An edit afterwards leaves
 *      the visit on the register disagreeing with the booking it came from,
 *      and nothing in the schema could detect it.
 *   3. AN EDITED AMOUNT IS REAL MONEY. It is carried onto the Registration at
 *      conversion, so a correction before conversion changes revenue — which
 *      is exactly why the edit needs its own permission and its own audit row.
 *   4. CONFIRMED IS NOW REACHABLE, AND EVERY AP-4/AP-5 PATH STILL WORKS FROM
 *      IT. Until this stage no appointment could reach CONFIRMED, so no verify
 *      script has ever driven check-in, cancel, no-show, reschedule or
 *      conversion out of that state. This is the real integration risk of the
 *      stage, and it is asserted path by path.
 *   5. NEITHER OPERATION MOVES THE DOCTOR'S DAY. An edit changes no status;
 *      a confirm changes status without changing occupancy. In both cases
 *      `active_slot_start` must still mirror `slot_start` and the slot must
 *      still refuse a second booking.
 *   6. TWO CONCURRENT CORRECTIONS DO NOT LOSE ONE ANOTHER. The row lock is the
 *      only thing standing between two receptionists and a silently discarded
 *      change, so the two are genuinely raced here rather than reasoned about.
 *   7. AUTHORISATION IS FOUR-LAYERED, as everywhere else: feature, scope,
 *      permission, row. A role holding the whole AP-4 lifecycle but NOT
 *      `appointment:update` must be refused both operations.
 *   8. THE AUDIT ROW NAMES COLUMNS, NEVER VALUES — with `amount` the single
 *      deliberate exception, because a price is a commercial fact this table
 *      already records at booking.
 *
 * Everything it creates lives under tenants named `verify-ap9-edit` and is torn
 * down at the end. Row counts on every pre-existing table are asserted before
 * and after, so a bug here that touched real data would be visible.
 *
 * Refuses to run unless DATABASE_URL points at localhost.
 */

import { BadRequestError, ConflictError } from "@/lib/apiHandler";
import { convertAppointmentToRegistration } from "@/lib/appointmentConversion";
import { updateAppointment } from "@/lib/appointmentEdit";
import {
  cancelAppointment,
  checkInAppointment,
  confirmAppointment,
  markAppointmentNoShow,
} from "@/lib/appointmentLifecycle";
import { rescheduleAppointment } from "@/lib/appointmentReschedule";
import { createAppointment } from "@/lib/appointments";
import { createAppointmentType } from "@/lib/appointmentTypes";
import { AUDIT_ACTIONS } from "@/lib/audit";
import { describeAuditAction } from "@/lib/auditDescriptions";
import { DEFAULT_PLAN_KEY, seedFeatureCatalogue } from "@/lib/defaultFeatures";
import { ROLE_KEYS, seedDefaultRoles } from "@/lib/defaultRoles";
import { FeatureError } from "@/lib/featureResolution";
import { prisma } from "@/lib/prisma";
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
const isBadRequest = (error: unknown): boolean =>
  error instanceof BadRequestError;
const isFeatureError = (error: unknown): boolean => error instanceof FeatureError;

const TEST_TENANT_NAME = "verify-ap9-edit";

/** The working day every booking in this script sits on. */
const DAY = "2027-05-10";

const iso = (day: string, time: string): string => `${day}T${time}:00.000Z`;
const dayOnly = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

/** Distinctive enough that finding any of it in an audit row is unambiguous. */
const PII = {
  name: "Zzyzx Ap9 Patient",
  mobileNumber: "9876500099",
  address: "99 Disclosure Drive",
  city: "Leakstown",
  gender: "Female" as const,
  age: 49,
};

/** What a correction changes them to. Equally distinctive, for the same reason. */
const CORRECTED = {
  name: "Qqqqx Ap9 Corrected",
  mobileNumber: "9876500198",
  address: "198 Correction Crescent",
  city: "Fixville",
  gender: "male",
  age: 918298,
};

const QUOTED_AMOUNT = 700;
const CORRECTED_AMOUNT = 1275.5;

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
    appointments,
    appointmentTypes,
    scheduleLocks,
    notifications,
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
    prisma.appointment.count(),
    prisma.appointmentType.count(),
    prisma.doctorScheduleLock.count(),
    prisma.notification.count(),
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
    appointments,
    appointmentTypes,
    scheduleLocks,
    notifications,
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
    select: { id: true },
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
  // A real neighbour, so every isolation assertion has somewhere to leak INTO.
  const rival = await makeTenant("rival");

  await seedDefaultRoles(prisma, tenant.id);
  await seedDefaultRoles(prisma, rival.id);

  const makeClinic = (tenantId: string, name: string) =>
    prisma.clinic.create({ data: { tenantId, name }, select: { id: true } });

  const clinic = await makeClinic(tenant.id, "AP-9 Alpha");
  const sibling = await makeClinic(tenant.id, "AP-9 Beta");
  const rivalClinic = await makeClinic(rival.id, "AP-9 Rival");

  const makeDoctor = (clinicId: string, name: string) =>
    prisma.doctor.create({
      data: { clinicId, name, department: "AP-9 Cardiology" },
      select: { id: true },
    });

  const doctor = await makeDoctor(clinic.id, "AP-9 Dr Alpha");
  // A second doctor at the same clinic, so a reschedule out of CONFIRMED has
  // somewhere to land that is not the slot it is leaving.
  const relief = await makeDoctor(clinic.id, "AP-9 Dr Relief");

  for (const id of [doctor.id, relief.id]) {
    await prisma.doctorAvailability.create({
      data: {
        doctorId: id,
        date: dayOnly(DAY),
        startTime: "09:00",
        endTime: "18:00",
      },
    });
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
  const rivalAdminRoleId = await roleId(rival.id, ROLE_KEYS.CLINIC_ADMIN);

  // THE SUBJECT OF THE PERMISSION SECTION. Holds the entire AP-4 lifecycle and
  // AP-5's conversion, and differs from Receptionist by exactly one key:
  // `appointment:update` is absent. Anything this role can do to a booking is
  // therefore not evidence that AP-9's gate works; anything it is refused is.
  const lifecycleOnlyRole = await prisma.role.create({
    data: {
      tenantId: tenant.id,
      name: "AP-9 Lifecycle, no edit",
      permissions: [
        "appointment:read",
        "appointment:create",
        "appointment:reschedule",
        "appointment:cancel",
        "appointment:checkin",
        "appointment:convert",
      ],
      isSystem: false,
    },
    select: { id: true },
  });

  // Holds the edit permission but has NO layer-3 row, so the module denies
  // before the permission is ever consulted.
  const unentitledRole = await prisma.role.create({
    data: {
      tenantId: tenant.id,
      name: "AP-9 Editor, module off",
      permissions: ["appointment:read", "appointment:update"],
      isSystem: false,
    },
    select: { id: true },
  });

  // `appointments` is PREMIUM, so an ABSENT RoleFeatureAccess row DENIES.
  for (const id of [
    adminRoleId,
    receptionRoleId,
    rivalAdminRoleId,
    lifecycleOnlyRole.id,
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
  const betaAdminUser = await makeUser("beta-admin", tenant.id);
  const receptionUser = await makeUser("reception", tenant.id);
  const lifecycleUser = await makeUser("lifecycle", tenant.id);
  const noModuleUser = await makeUser("nomodule", tenant.id);
  const rivalUser = await makeUser("rival", rival.id);

  const assign = (userId: string, roleId: string, clinicId: string | null) =>
    prisma.userRole.create({ data: { userId, roleId, clinicId } });

  await assign(adminUser.id, adminRoleId, null);
  // Clinic-scoped to BETA only, so Alpha's appointments are in-tenant but out
  // of scope for them — the 403 case, as distinct from the 404 case.
  await assign(betaAdminUser.id, adminRoleId, sibling.id);
  await assign(receptionUser.id, receptionRoleId, null);
  await assign(lifecycleUser.id, lifecycleOnlyRole.id, null);
  await assign(noModuleUser.id, unentitledRole.id, null);
  await assign(rivalUser.id, rivalAdminRoleId, null);

  const actor = (userId: string, tenantId: string): ActorContext => ({
    userId,
    tenantId,
  });

  const actors = {
    admin: actor(adminUser.id, tenant.id),
    betaAdmin: actor(betaAdminUser.id, tenant.id),
    reception: actor(receptionUser.id, tenant.id),
    lifecycle: actor(lifecycleUser.id, tenant.id),
    noModule: actor(noModuleUser.id, tenant.id),
    rival: actor(rivalUser.id, rival.id),
  };

  const service = await createAppointmentType(actors.admin, {
    clinicId: clinic.id,
    name: "AP-9 Consultation",
    durationMinutes: 30,
    defaultAmount: QUOTED_AMOUNT,
  });

  const rivalService = await createAppointmentType(actors.rival, {
    clinicId: rivalClinic.id,
    name: "AP-9 Rival Consultation",
    durationMinutes: 30,
    defaultAmount: QUOTED_AMOUNT,
  });

  return {
    stamp,
    tenant,
    rival,
    clinic,
    sibling,
    rivalClinic,
    doctor,
    relief,
    service,
    rivalService,
    actors,
  };
}

type Fixture = Awaited<ReturnType<typeof build>>;

/** One booking on this doctor's day, at the given time. Returns its id. */
async function bookAt(
  f: Fixture,
  time: string,
  options: { doctorId?: string; minutes?: number } = {},
): Promise<string> {
  const doctorId = options.doctorId ?? f.doctor.id;
  const minutes = options.minutes ?? 30;
  const [hour, minute] = time.split(":").map(Number);
  const endMinutes = hour * 60 + minute + minutes;
  const end = `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(
    endMinutes % 60,
  ).padStart(2, "0")}`;

  const booking = await createAppointment(f.actors.reception, {
    clinicId: f.clinic.id,
    doctorId,
    appointmentTypeId: f.service.id,
    patientId: null,
    ...PII,
    slotStart: iso(DAY, time),
    slotEnd: iso(DAY, end),
  });

  return booking.id;
}

const readRow = (id: string) =>
  prisma.appointment.findUniqueOrThrow({ where: { id } });

async function purgeTenant(tenantId: string): Promise<void> {
  await prisma.notification.deleteMany({ where: { tenantId } });
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
// 1. The locked fields
// ---------------------------------------------------------------------------

async function checkLockedFields(f: Fixture): Promise<void> {
  console.log("\n1. What a correction may change, and what it may not");

  const id = await bookAt(f, "09:00");
  const before = await readRow(id);

  // Everything AP-9 refuses to have vocabulary for, sent in one body. Zod
  // STRIPS these rather than refusing them, so the request succeeds and says
  // nothing — which is precisely why the row has to be read back.
  const smuggled = {
    ...CORRECTED,
    amount: CORRECTED_AMOUNT,
    clinicId: f.sibling.id,
    doctorId: f.relief.id,
    appointmentTypeId: f.rivalService.id,
    patientId: "patient-someone-else",
    status: "CONVERTED",
    slotStart: iso(DAY, "16:00"),
    slotEnd: iso(DAY, "16:30"),
    activeSlotStart: null,
    bookedById: "someone-else",
    tenantId: f.rival.id,
    cancelledAt: new Date(),
    rescheduledFromId: "another-appointment",
  } as unknown as Parameters<typeof updateAppointment>[2];

  const result = await updateAppointment(f.actors.admin, id, smuggled);
  const after = await readRow(id);

  check(
    "the patient snapshot is corrected",
    after.name === CORRECTED.name &&
      after.mobileNumber === CORRECTED.mobileNumber &&
      after.age === CORRECTED.age &&
      after.gender === CORRECTED.gender &&
      after.city === CORRECTED.city &&
      after.address === CORRECTED.address,
    after,
  );
  check(
    "the amount is corrected",
    after.amount.toFixed(2) === CORRECTED_AMOUNT.toFixed(2),
    after.amount.toString(),
  );
  check(
    "changedFields reports all seven",
    result.changedFields.length === 7,
    result.changedFields,
  );

  check("the clinic is unchanged", after.clinicId === before.clinicId);
  check("the tenant is unchanged", after.tenantId === before.tenantId);
  check("the doctor is unchanged", after.doctorId === before.doctorId);
  check(
    "the service is unchanged",
    after.appointmentTypeId === before.appointmentTypeId,
  );
  check("the patient link is unchanged", after.patientId === before.patientId);
  check("the status is unchanged", after.status === before.status);
  check(
    "slot_start is unchanged — AP-1 rule 2",
    after.slotStart.getTime() === before.slotStart.getTime(),
  );
  check(
    "slot_end is unchanged — AP-1 rule 2",
    after.slotEnd.getTime() === before.slotEnd.getTime(),
  );
  check(
    "active_slot_start still mirrors slot_start",
    after.activeSlotStart?.getTime() === after.slotStart.getTime(),
  );
  check("who booked it is unchanged", after.bookedById === before.bookedById);
  check("cancelled_at was not written", after.cancelledAt === null);
  check(
    "rescheduled_from_id was not written",
    after.rescheduledFromId === before.rescheduledFromId,
  );

  // The slot must still be busy. If a smuggled field HAD landed, the clearest
  // symptom would be a second booking slipping into the same time.
  await expectThrows(
    "the slot still refuses a second booking",
    isConflictError,
    () =>
      createAppointment(f.actors.reception, {
        clinicId: f.clinic.id,
        doctorId: f.doctor.id,
        appointmentTypeId: f.service.id,
        patientId: null,
        ...PII,
        slotStart: iso(DAY, "09:00"),
        slotEnd: iso(DAY, "09:30"),
      }),
  );

  // A partial patch touches only what it names.
  const partial = await updateAppointment(f.actors.admin, id, {
    city: "Onlythiscity",
  });
  const afterPartial = await readRow(id);
  check(
    "an absent field is left exactly as it was",
    afterPartial.name === CORRECTED.name &&
      afterPartial.mobileNumber === CORRECTED.mobileNumber &&
      afterPartial.address === CORRECTED.address,
    afterPartial,
  );
  check(
    "only the named field is reported changed",
    partial.changedFields.length === 1 && partial.changedFields[0] === "city",
    partial.changedFields,
  );

  // Clearing, as distinct from not sending.
  await updateAppointment(f.actors.admin, id, { age: null, address: "  " });
  const afterClear = await readRow(id);
  check(
    "an explicit null clears the age",
    afterClear.age === null,
    afterClear.age,
  );
  check(
    "a blank string clears the address rather than storing ''",
    afterClear.address === null,
    afterClear.address,
  );
  check(
    "an untouched field survives the clearing",
    afterClear.city === "Onlythiscity",
    afterClear.city,
  );
}

// ---------------------------------------------------------------------------
// 2. Refusing a save that changes nothing
// ---------------------------------------------------------------------------

async function checkNoOpRefusal(f: Fixture): Promise<void> {
  console.log("\n2. A save that changes nothing is refused, not recorded");

  const id = await bookAt(f, "09:30");
  const auditBefore = await prisma.auditLog.count({
    where: { targetId: id, action: AUDIT_ACTIONS.APPOINTMENT_UPDATED },
  });

  await expectThrows("an empty body is a 400", isBadRequest, () =>
    updateAppointment(f.actors.admin, id, {}),
  );

  await expectThrows(
    "the same values typed back again is a 400",
    isBadRequest,
    () =>
      updateAppointment(f.actors.admin, id, {
        name: PII.name,
        mobileNumber: PII.mobileNumber,
        age: PII.age,
        gender: PII.gender,
        city: PII.city,
        address: PII.address,
        amount: QUOTED_AMOUNT,
      }),
  );

  const auditAfter = await prisma.auditLog.count({
    where: { targetId: id, action: AUDIT_ACTIONS.APPOINTMENT_UPDATED },
  });
  check(
    "no audit row claims an edit that did not happen",
    auditAfter === auditBefore,
    { before: auditBefore, after: auditAfter },
  );

  // Trailing whitespace is not a change either — it is trimmed on the way in,
  // exactly as it was at booking.
  await expectThrows(
    "the same name with a stray space is still not a change",
    isBadRequest,
    () => updateAppointment(f.actors.admin, id, { name: `  ${PII.name}  ` }),
  );
}

// ---------------------------------------------------------------------------
// 3. Confirming, and every path out of CONFIRMED
// ---------------------------------------------------------------------------

async function checkConfirm(f: Fixture): Promise<void> {
  console.log("\n3. CONFIRMED is reachable, and every path out of it works");

  const id = await bookAt(f, "10:00");
  const before = await readRow(id);

  const confirmed = await confirmAppointment(f.actors.admin, id);
  const after = await readRow(id);

  check("a booked appointment can be confirmed", confirmed.status === "CONFIRMED");
  check("the row says so", after.status === "CONFIRMED", after.status);
  check(
    "the slot is still occupied — CONFIRMED occupies",
    after.activeSlotStart?.getTime() === after.slotStart.getTime(),
  );
  check(
    "the times did not move",
    after.slotStart.getTime() === before.slotStart.getTime() &&
      after.slotEnd.getTime() === before.slotEnd.getTime(),
  );
  check(
    "no cancellation or check-in column was written",
    after.cancelledAt === null && after.checkedInAt === null,
  );

  await expectThrows(
    "confirming twice is a conflict, not a silent success",
    isConflictError,
    () => confirmAppointment(f.actors.admin, id),
  );

  // THE INTEGRATION RISK OF THIS STAGE. Until now nothing could reach
  // CONFIRMED, so no AP-4 or AP-5 path has ever been driven out of it.
  await checkInAppointment(f.actors.admin, id);
  const arrived = await readRow(id);
  check("CONFIRMED → CHECKED_IN works", arrived.status === "CHECKED_IN");
  check(
    "arrival still holds the slot",
    arrived.activeSlotStart?.getTime() === arrived.slotStart.getTime(),
  );

  const converted = await convertAppointmentToRegistration(f.actors.admin, id);
  const registered = await readRow(id);
  check(
    "CONFIRMED → CHECKED_IN → CONVERTED works",
    registered.status === "CONVERTED" && converted.registrationId.length > 0,
  );

  await expectThrows(
    "confirming an arrived patient is refused",
    isConflictError,
    async () => {
      const other = await bookAt(f, "10:30");
      await checkInAppointment(f.actors.admin, other);
      return confirmAppointment(f.actors.admin, other);
    },
  );

  const cancelId = await bookAt(f, "11:00");
  await confirmAppointment(f.actors.admin, cancelId);
  await cancelAppointment(f.actors.admin, cancelId, { reason: "AP-9 cancel" });
  const cancelled = await readRow(cancelId);
  check("CONFIRMED → CANCELLED works", cancelled.status === "CANCELLED");
  check(
    "cancelling from CONFIRMED releases the slot",
    cancelled.activeSlotStart === null,
  );

  const noShowId = await bookAt(f, "11:30");
  await confirmAppointment(f.actors.admin, noShowId);
  await markAppointmentNoShow(f.actors.admin, noShowId);
  const missed = await readRow(noShowId);
  check("CONFIRMED → NO_SHOW works", missed.status === "NO_SHOW");
  check(
    "a no-show from CONFIRMED releases the slot",
    missed.activeSlotStart === null,
  );

  const moveId = await bookAt(f, "12:00");
  await confirmAppointment(f.actors.admin, moveId);
  const moved = await rescheduleAppointment(f.actors.admin, moveId, {
    slotStart: iso(DAY, "12:30"),
    slotEnd: iso(DAY, "13:00"),
  });
  const original = await readRow(moveId);
  const replacement = await readRow(moved.appointment.id);
  check("CONFIRMED → RESCHEDULED works", original.status === "RESCHEDULED");
  check(
    "the replacement starts back at SCHEDULED, not CONFIRMED",
    replacement.status === "SCHEDULED",
    replacement.status,
  );
  check(
    "the original released its slot and the replacement took one",
    original.activeSlotStart === null &&
      replacement.activeSlotStart?.getTime() === replacement.slotStart.getTime(),
  );

  await expectThrows(
    "confirming a cancelled appointment is refused",
    isConflictError,
    () => confirmAppointment(f.actors.admin, cancelId),
  );
  await expectThrows(
    "confirming a moved appointment is refused",
    isConflictError,
    () => confirmAppointment(f.actors.admin, moveId),
  );

  // A CONFIRMED booking is still correctable — the desk phones to confirm and
  // hears the correct spelling in the same call.
  const editableId = await bookAt(f, "13:30");
  await confirmAppointment(f.actors.admin, editableId);
  const edited = await updateAppointment(f.actors.admin, editableId, {
    name: "Ap9 Confirmed Then Corrected",
  });
  check(
    "a confirmed booking can still be corrected",
    edited.status === "CONFIRMED" && edited.name === "Ap9 Confirmed Then Corrected",
    edited,
  );
}

// ---------------------------------------------------------------------------
// 4. Conversion — the guard, and the money
// ---------------------------------------------------------------------------

async function checkConversion(f: Fixture): Promise<void> {
  console.log("\n4. A converted booking is frozen, and the amount is real money");

  // The amount corrected BEFORE conversion must be the one the visit bills.
  const id = await bookAt(f, "14:00");
  await updateAppointment(f.actors.admin, id, { amount: CORRECTED_AMOUNT });
  await checkInAppointment(f.actors.admin, id);
  const converted = await convertAppointmentToRegistration(f.actors.admin, id);

  const registration = await prisma.registration.findUniqueOrThrow({
    where: { id: converted.registrationId },
    select: { amount: true, patientId: true },
  });
  check(
    "a corrected amount is carried onto the registration",
    registration.amount.toFixed(2) === CORRECTED_AMOUNT.toFixed(2),
    registration.amount.toString(),
  );

  // ...and after conversion the booking is frozen, or the two would disagree.
  await expectThrows(
    "correcting a converted booking is refused",
    isConflictError,
    () => updateAppointment(f.actors.admin, id, { amount: 1 }),
  );

  const stillAgrees = await readRow(id);
  check(
    "the refusal left the booking's amount alone",
    stillAgrees.amount.toFixed(2) === registration.amount.toFixed(2),
    { appointment: stillAgrees.amount.toString(), registration: registration.amount.toString() },
  );

  await expectThrows(
    "correcting a cancelled booking is refused",
    isConflictError,
    async () => {
      const dead = await bookAt(f, "14:30");
      await cancelAppointment(f.actors.admin, dead);
      return updateAppointment(f.actors.admin, dead, { city: "Nowhere" });
    },
  );

  await expectThrows(
    "correcting a moved booking is refused, not silently applied",
    isConflictError,
    async () => {
      const moved = await bookAt(f, "15:00");
      await rescheduleAppointment(f.actors.admin, moved, {
        slotStart: iso(DAY, "15:30"),
        slotEnd: iso(DAY, "16:00"),
      });
      return updateAppointment(f.actors.admin, moved, { city: "Nowhere" });
    },
  );
}

// ---------------------------------------------------------------------------
// 5. Authorisation — four layers
// ---------------------------------------------------------------------------

async function checkAuthorisation(f: Fixture): Promise<void> {
  console.log("\n5. Feature, scope, permission, row");

  const id = await bookAt(f, "16:00");

  // Layer 1. Holds `appointment:update` and is refused before it is consulted.
  await expectThrows("an unentitled role is refused an edit", isFeatureError, () =>
    updateAppointment(f.actors.noModule, id, { city: "Nowhere" }),
  );
  await expectThrows(
    "an unentitled role is refused a confirm",
    isFeatureError,
    () => confirmAppointment(f.actors.noModule, id),
  );

  // Layer 2. Another organisation's appointment reads as absent, not forbidden.
  await expectThrows("another tenant's appointment is a 404", isScopeError, () =>
    updateAppointment(f.actors.rival, id, { city: "Nowhere" }),
  );
  await expectThrows(
    "another tenant cannot confirm it either",
    isScopeError,
    () => confirmAppointment(f.actors.rival, id),
  );
  await expectThrows("an unknown id is a 404", isScopeError, () =>
    updateAppointment(f.actors.admin, "appointment-does-not-exist", {
      city: "Nowhere",
    }),
  );

  // Layer 3. In-tenant but out of this admin's clinic. `getAppointmentForActor`
  // scopes by `appointment:read`, which this actor holds only at Beta — so an
  // Alpha appointment is unreachable, and unreachable is a 404.
  await expectThrows(
    "a clinic-scoped admin cannot reach another clinic's booking",
    isScopeError,
    () => updateAppointment(f.actors.betaAdmin, id, { city: "Nowhere" }),
  );

  // Layer 4, and the one AP-9 is really about. This role holds the ENTIRE AP-4
  // lifecycle and AP-5's conversion; it differs from Receptionist by exactly
  // one key. Everything it can still do proves the refusal below is about
  // `appointment:update` and nothing else.
  await checkInAppointment(f.actors.lifecycle, id);
  check(
    "the lifecycle-only role can still check a patient in",
    (await readRow(id)).status === "CHECKED_IN",
  );

  await expectThrows(
    "the lifecycle-only role is refused an edit",
    isPermissionError,
    () => updateAppointment(f.actors.lifecycle, id, { city: "Nowhere" }),
  );

  const confirmableId = await bookAt(f, "16:30");
  await expectThrows(
    "the lifecycle-only role is refused a confirm",
    isPermissionError,
    () => confirmAppointment(f.actors.lifecycle, confirmableId),
  );
  check(
    "the refused confirm left the status alone",
    (await readRow(confirmableId)).status === "SCHEDULED",
  );

  // Receptionist holds `appointment:update` by default, which is what makes
  // the front desk able to correct its own typing without an admin.
  const receptionEdit = await updateAppointment(f.actors.reception, confirmableId, {
    city: "Receptionfixedthis",
  });
  check(
    "a receptionist may correct a booking",
    receptionEdit.changedFields.includes("city"),
    receptionEdit.changedFields,
  );
  const receptionConfirm = await confirmAppointment(
    f.actors.reception,
    confirmableId,
  );
  check(
    "a receptionist may confirm one",
    receptionConfirm.status === "CONFIRMED",
  );
}

// ---------------------------------------------------------------------------
// 6. Two corrections at once
// ---------------------------------------------------------------------------

async function checkConcurrency(f: Fixture): Promise<void> {
  console.log("\n6. Two receptionists correcting the same booking");

  const id = await bookAt(f, "17:00");

  // Genuinely raced. Each writes the WHOLE editable set from the snapshot it
  // read, so without the row lock the loser's field is silently overwritten
  // with the value it had before the winner's change — a lost update whose only
  // symptom is a receptionist swearing they typed it.
  await Promise.all([
    updateAppointment(f.actors.admin, id, { name: "Ap9 Racer One" }),
    updateAppointment(f.actors.reception, id, { amount: 999.99 }),
  ]);

  const after = await readRow(id);
  check(
    "the first writer's name survived",
    after.name === "Ap9 Racer One",
    after.name,
  );
  check(
    "the second writer's amount survived",
    after.amount.toFixed(2) === "999.99",
    after.amount.toString(),
  );

  const rows = await prisma.auditLog.count({
    where: { targetId: id, action: AUDIT_ACTIONS.APPOINTMENT_UPDATED },
  });
  check("both corrections left an audit row", rows === 2, rows);
}

// ---------------------------------------------------------------------------
// 7. The trail, and what stays out of it
// ---------------------------------------------------------------------------

async function checkAudit(f: Fixture): Promise<void> {
  console.log("\n7. The audit trail names columns, never values");

  const id = await bookAt(f, "17:30");
  await updateAppointment(f.actors.admin, id, {
    mobileNumber: CORRECTED.mobileNumber,
    amount: CORRECTED_AMOUNT,
  });
  await confirmAppointment(f.actors.admin, id);

  const edit = await prisma.auditLog.findFirstOrThrow({
    where: { targetId: id, action: AUDIT_ACTIONS.APPOINTMENT_UPDATED },
    orderBy: { createdAt: "desc" },
  });
  const confirm = await prisma.auditLog.findFirstOrThrow({
    where: { targetId: id, action: AUDIT_ACTIONS.APPOINTMENT_CONFIRMED },
  });

  check("the edit is filed against the Appointment", edit.targetType === "Appointment");
  check("the actor is recorded", edit.actorUserId === f.actors.admin.userId);
  check("the organisation is recorded", edit.actorTenantId === f.tenant.id);

  const after = edit.afterValue as Record<string, unknown> | null;
  const beforeValue = edit.beforeValue as Record<string, unknown> | null;

  check(
    "changedFields names the two columns that changed",
    after?.changedFields === "mobileNumber, amount",
    after?.changedFields,
  );
  check(
    "the amount is carried on both sides",
    beforeValue?.amount === QUOTED_AMOUNT.toFixed(2) &&
      after?.amount === CORRECTED_AMOUNT.toFixed(2),
    { before: beforeValue?.amount, after: after?.amount },
  );
  check(
    "the scheduling fact is carried too",
    after?.doctorId === f.doctor.id && after?.date === DAY,
    after,
  );

  // The rule that matters. Every distinctive string this fixture uses, hunted
  // across the whole audit trail for this organisation.
  const all = await prisma.auditLog.findMany({
    where: { actorTenantId: f.tenant.id },
    select: { beforeValue: true, afterValue: true, reason: true },
  });
  const haystack = JSON.stringify(all);

  for (const [label, needle] of [
    ["the patient's name", PII.name],
    ["the corrected name", CORRECTED.name],
    ["the mobile number", PII.mobileNumber],
    ["the corrected mobile number", CORRECTED.mobileNumber],
    ["the address", PII.address],
    ["the corrected address", CORRECTED.address],
    ["the city", PII.city],
    ["the age", String(PII.age)],
  ] as const) {
    check(`${label} never reaches the trail`, !haystack.includes(needle));
  }

  check(
    "the confirm is a distinct action, not a generic status change",
    confirm.action === AUDIT_ACTIONS.APPOINTMENT_CONFIRMED,
  );
  const confirmAfter = confirm.afterValue as Record<string, unknown> | null;
  check(
    "the confirm records the status either side",
    (confirm.beforeValue as Record<string, unknown> | null)?.status ===
      "SCHEDULED" && confirmAfter?.status === "CONFIRMED",
    { before: confirm.beforeValue, after: confirm.afterValue },
  );

  for (const action of [
    AUDIT_ACTIONS.APPOINTMENT_UPDATED,
    AUDIT_ACTIONS.APPOINTMENT_CONFIRMED,
  ]) {
    const described = describeAuditAction(action);
    check(
      `${action} reads as a sentence on the audit screen`,
      described.label.length > 0 && described.detail.length > 20,
      described,
    );
  }

  // AP-8 chose four appointment events for the feed. Neither of AP-9's is one
  // of them, and an absence is the kind of thing only an assertion records.
  const notifications = await prisma.notification.findMany({
    where: { tenantId: f.tenant.id },
    select: { type: true },
  });
  check(
    "no notification type was invented for an edit or a confirm",
    !notifications.some(
      (row) => row.type === "appointment.updated" || row.type === "appointment.confirmed",
    ),
    notifications.map((row) => row.type),
  );
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("AP-9 — correcting a booking, and confirming one\n");

  await sweepLeftovers();

  const before = await countEverything();
  let fixture: Fixture | null = null;

  try {
    fixture = await build();

    await checkLockedFields(fixture);
    await checkNoOpRefusal(fixture);
    await checkConfirm(fixture);
    await checkConversion(fixture);
    await checkAuthorisation(fixture);
    await checkConcurrency(fixture);
    await checkAudit(fixture);
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
