/**
 * AP-2 verification — the slot read path, exercised against a LOCAL database.
 *
 *     npm run verify:ap2-appointment-slots
 *
 * tests/unit/appointmentSlots.test.ts already pins every rule the PURE engine
 * encodes, with no database in sight. This script exists for the half a unit
 * test cannot reach: that the four queries in lib/appointments.ts actually
 * select the rows the engine was tested on, and that the authorisation in front
 * of them refuses everything it is supposed to refuse.
 *
 * Those are different failure modes and they need different evidence. A slot
 * rule that is wrong shows up as a wrong answer; a QUERY that is wrong shows up
 * as a right answer computed from the wrong rows — availability read for the
 * neighbouring date, a cancelled appointment still freezing a slot because the
 * status filter was dropped, another organisation's diary returned because a
 * clinic id was trusted. Every one of those is asserted below against real rows.
 *
 * READ ONLY, deliberately. AP-2 ships no booking, so there is no concurrency to
 * race here — that is proved in verify-ap1-appointments-schema.mts and will be
 * extended by AP-3.
 *
 * Everything it creates lives under tenants named `verify-ap2-slots` and is torn
 * down at the end. Row counts on every pre-existing table are asserted before
 * and after, so a bug here that touched real data would be visible.
 *
 * Refuses to run unless DATABASE_URL points at localhost.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAppointmentSlots } from "@/lib/appointments";
import {
  APPOINTMENT_STATUSES,
  activeSlotStartForStatus,
  isOccupyingAppointmentStatus,
  type AppointmentStatus,
} from "@/lib/appointmentRules";
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

const TEST_TENANT_NAME = "verify-ap2-slots";

/** The working day every assertion is built on. */
const DAY = "2026-11-09";
/** The day after it — nothing is ever configured here. */
const NEXT_DAY = "2026-11-10";
/** A day used only for the status sweep, so it cannot disturb DAY. */
const PROBE_DAY = "2026-11-11";
/** A day the doctor is on leave. */
const LEAVE_DAY = "2026-11-12";

/** Wall-clock tagged UTC — the convention src/lib/dates.ts establishes. */
const at = (day: string, time: string): Date =>
  new Date(`${day}T${time}:00.000Z`);
const dayOnly = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

/** Distinctive enough that finding it in a response is unambiguous. */
const PII = {
  name: "Zzyzx Pii Patient",
  mobileNumber: "9876500011",
  address: "17 Leaky Lane",
  city: "Disclosureville",
  gender: "female",
  age: 987654,
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
    roles,
    userRoles,
    features,
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
    prisma.role.count(),
    prisma.userRole.count(),
    prisma.feature.count(),
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
    roles,
    userRoles,
    features,
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

  const clinic = await prisma.clinic.create({
    data: { tenantId: tenant.id, name: "AP-2 Alpha" },
    select: { id: true },
  });
  const sibling = await prisma.clinic.create({
    data: { tenantId: tenant.id, name: "AP-2 Beta" },
    select: { id: true },
  });
  const rivalClinic = await prisma.clinic.create({
    data: { tenantId: rival.id, name: "AP-2 Rival" },
    select: { id: true },
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
  const staffRoleId = await roleId(tenant.id, ROLE_KEYS.STAFF);
  const rivalAdminRoleId = await roleId(rival.id, ROLE_KEYS.CLINIC_ADMIN);

  // `appointments` is PREMIUM, so an ABSENT RoleFeatureAccess row DENIES. Every
  // role that is meant to reach the module needs an explicit row — which is
  // itself one of the things this script checks, further down.
  //
  // STAFF IS IN THIS LIST DELIBERATELY, even though Staff holds no appointment
  // permission at all. The feature gate runs BEFORE the permission gate (see
  // lib/features.ts), so without a row here Staff would be refused at layer 3
  // and the layer-4 refusal would never be reached — the permission check would
  // look tested when it was not. Giving Staff the module is what isolates it.
  for (const id of [adminRoleId, receptionRoleId, staffRoleId, rivalAdminRoleId]) {
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

  const admin = await makeUser("admin", tenant.id);
  const siblingOnly = await makeUser("sibling", tenant.id);
  const staff = await makeUser("staff", tenant.id);
  const staffWithoutModule = await makeUser("staff-nomodule", tenant.id);
  const noFeature = await makeUser("nofeature", tenant.id);
  const rivalAdmin = await makeUser("rivaladmin", rival.id);

  // Tenant-wide (null clinic) reaches every clinic in the organisation.
  await prisma.userRole.create({
    data: { userId: admin.id, roleId: adminRoleId, clinicId: null },
  });
  // Clinic-scoped to the SIBLING only — the clinic-isolation subject.
  await prisma.userRole.create({
    data: {
      userId: siblingOnly.id,
      roleId: receptionRoleId,
      clinicId: sibling.id,
    },
  });
  // Staff holds no appointment permission at all (AP-1 decision D).
  await prisma.userRole.create({
    data: { userId: staff.id, roleId: staffRoleId, clinicId: null },
  });
  await prisma.userRole.create({
    data: { userId: rivalAdmin.id, roleId: rivalAdminRoleId, clinicId: null },
  });

  // Neither the module nor the permission: both layers would refuse, which is
  // what makes them orderable.
  const bareRole = await prisma.role.create({
    data: {
      tenantId: tenant.id,
      name: "AP-2 Nothing at all",
      permissions: ["doctor:read"],
      isSystem: false,
    },
    select: { id: true },
  });
  await prisma.userRole.create({
    data: { userId: staffWithoutModule.id, roleId: bareRole.id, clinicId: null },
  });

  // A role with the PERMISSION but no layer-3 row: the tier rule's subject.
  const unentitledRole = await prisma.role.create({
    data: {
      tenantId: tenant.id,
      name: "AP-2 Front Desk, module off",
      // No `key`: (tenant_id, key) is unique, and this is a custom role, not a
      // second copy of a seeded one.
      permissions: ["appointment:read", "doctor:read"],
      isSystem: false,
    },
    select: { id: true },
  });
  await prisma.userRole.create({
    data: { userId: noFeature.id, roleId: unentitledRole.id, clinicId: null },
  });

  const doctor = await prisma.doctor.create({
    data: { clinicId: clinic.id, name: "Dr AP-2 Alpha", department: "General" },
    select: { id: true },
  });
  const siblingDoctor = await prisma.doctor.create({
    data: { clinicId: sibling.id, name: "Dr AP-2 Beta", department: "General" },
    select: { id: true },
  });
  const rivalDoctor = await prisma.doctor.create({
    data: { clinicId: rivalClinic.id, name: "Dr AP-2 Rival", department: "General" },
    select: { id: true },
  });

  const makeType = (
    name: string,
    tenantId: string,
    clinicId: string | null,
    durationMinutes: number,
    isActive = true,
  ) =>
    prisma.appointmentType.create({
      data: {
        tenantId,
        clinicId,
        name,
        durationMinutes,
        defaultAmount: new Prisma.Decimal("500.00"),
        isActive,
      },
      select: { id: true, durationMinutes: true },
    });

  const tenantWideType = await makeType("Consultation", tenant.id, null, 30);
  const clinicType = await makeType("Alpha only", tenant.id, clinic.id, 15);
  const siblingType = await makeType("Beta only", tenant.id, sibling.id, 30);
  const retiredType = await makeType("Retired", tenant.id, null, 30, false);
  const rivalType = await makeType("Rival", rival.id, null, 30);

  // Two windows on DAY with a gap between them; one on PROBE_DAY; none at all
  // on NEXT_DAY, which is what the exact-date assertions turn on.
  for (const [date, startTime, endTime] of [
    [DAY, "09:00", "10:00"],
    [DAY, "14:00", "15:00"],
    [PROBE_DAY, "09:00", "10:00"],
    [LEAVE_DAY, "09:00", "17:00"],
  ] as const) {
    await prisma.doctorAvailability.create({
      data: { doctorId: doctor.id, date: dayOnly(date), startTime, endTime },
    });
  }

  await prisma.doctorLeave.create({
    data: {
      doctorId: doctor.id,
      startDate: dayOnly(LEAVE_DAY),
      endDate: dayOnly(LEAVE_DAY),
      reason: "AP-2 leave reason that must never reach a slot response",
    },
  });

  // The patient whose details must never appear in a slot response.
  const patient = await prisma.patient.create({
    data: {
      tenantId: tenant.id,
      clinicId: clinic.id,
      patientCode: `PT-AP2-${stamp}`,
      ...PII,
    },
    select: { id: true },
  });

  const makeAppointment = async (
    day: string,
    startTime: string,
    endTime: string,
    status: AppointmentStatus,
    withPatient = false,
  ) => {
    const slotStart = at(day, startTime);
    return prisma.appointment.create({
      data: {
        tenantId: tenant.id,
        clinicId: clinic.id,
        doctorId: doctor.id,
        appointmentTypeId: tenantWideType.id,
        patientId: withPatient ? patient.id : null,
        name: withPatient ? PII.name : "AP-2 Booking",
        mobileNumber: withPatient ? PII.mobileNumber : "9000000000",
        address: withPatient ? PII.address : null,
        city: withPatient ? PII.city : null,
        gender: withPatient ? PII.gender : null,
        age: withPatient ? PII.age : null,
        amount: new Prisma.Decimal("500.00"),
        slotStart,
        slotEnd: at(day, endTime),
        activeSlotStart: activeSlotStartForStatus(status, slotStart),
        status,
        bookedById: admin.id,
      },
      select: { id: true },
    });
  };

  // DAY: one occupying and one releasing appointment in each of the two windows.
  const scheduled = await makeAppointment(DAY, "09:00", "09:30", "SCHEDULED", true);
  await makeAppointment(DAY, "09:30", "10:00", "CANCELLED");
  await makeAppointment(DAY, "14:00", "14:30", "CONVERTED");
  await makeAppointment(DAY, "14:30", "15:00", "NO_SHOW");

  // PROBE_DAY: one appointment whose status is swept through all seven.
  const probe = await makeAppointment(PROBE_DAY, "09:00", "09:30", "SCHEDULED");

  return {
    tenant,
    rival,
    clinic,
    sibling,
    rivalClinic,
    doctor,
    siblingDoctor,
    rivalDoctor,
    tenantWideType,
    clinicType,
    siblingType,
    retiredType,
    rivalType,
    appointmentsFeature,
    unentitledRole,
    scheduled,
    probe,
    patient,
    actors: {
      admin: { userId: admin.id, tenantId: tenant.id } satisfies ActorContext,
      siblingOnly: {
        userId: siblingOnly.id,
        tenantId: tenant.id,
      } satisfies ActorContext,
      staff: { userId: staff.id, tenantId: tenant.id } satisfies ActorContext,
      staffWithoutModule: {
        userId: staffWithoutModule.id,
        tenantId: tenant.id,
      } satisfies ActorContext,
      noFeature: {
        userId: noFeature.id,
        tenantId: tenant.id,
      } satisfies ActorContext,
      rivalAdmin: {
        userId: rivalAdmin.id,
        tenantId: rival.id,
      } satisfies ActorContext,
    },
  };
}

type Fixture = Awaited<ReturnType<typeof build>>;

async function teardown(fixture: Fixture): Promise<void> {
  for (const tenantId of [fixture.tenant.id, fixture.rival.id]) {
    // RESTRICT foreign keys mean the children go first. Nothing in the APP
    // ever deletes an appointment — this is fixture teardown, not a supported
    // operation.
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
    await prisma.tenant.delete({ where: { id: tenantId } });
  }
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

/** "09:00-09:30 booked", which is what the expectations read best. */
const describeSlots = (result: {
  slots: { start: string; end: string; status: string }[];
}) => result.slots.map((slot) => `${slot.start}-${slot.end} ${slot.status}`);

async function checkHappyPath(f: Fixture): Promise<void> {
  console.log("\nThe ordinary read");

  const result = await getAppointmentSlots(f.actors.admin, {
    clinicId: f.clinic.id,
    doctorId: f.doctor.id,
    appointmentTypeId: f.tenantWideType.id,
    date: DAY,
  });

  check("reports the day as computed, not empty", result.outcome === "ok", result.outcome);

  check(
    "returns both availability windows as one chronological run",
    JSON.stringify(describeSlots(result)) ===
      JSON.stringify([
        "09:00-09:30 booked",
        "09:30-10:00 available",
        "14:00-14:30 booked",
        "14:30-15:00 available",
      ]),
    describeSlots(result),
  );

  check(
    "echoes the doctor, clinic, type and duration it resolved",
    result.doctorId === f.doctor.id &&
      result.clinicId === f.clinic.id &&
      result.appointmentTypeId === f.tenantWideType.id &&
      result.durationMinutes === 30 &&
      result.date === DAY,
    result,
  );

  check(
    "links a booked slot to its appointment and leaves a free one unlinked",
    result.slots[0]?.bookingId === f.scheduled.id &&
      result.slots[1]?.bookingId === undefined,
    result.slots.slice(0, 2),
  );

  // The whole point of computing a grid per type: a 15-minute type must not be
  // measured against a 30-minute one's boundaries.
  const short = await getAppointmentSlots(f.actors.admin, {
    clinicId: f.clinic.id,
    doctorId: f.doctor.id,
    appointmentTypeId: f.clinicType.id,
    date: DAY,
  });

  check(
    "computes a separate grid for a 15-minute type",
    short.durationMinutes === 15 && short.slots.length === 8,
    { duration: short.durationMinutes, slots: short.slots.length },
  );

  check(
    "freezes only the 15-minute candidates the 30-minute bookings overlap",
    JSON.stringify(describeSlots(short)) ===
      JSON.stringify([
        "09:00-09:15 booked",
        "09:15-09:30 booked",
        "09:30-09:45 available",
        "09:45-10:00 available",
        "14:00-14:15 booked",
        "14:15-14:30 booked",
        "14:30-14:45 available",
        "14:45-15:00 available",
      ]),
    describeSlots(short),
  );
}

async function checkDateHandling(f: Fixture): Promise<void> {
  console.log("\nExact-date behaviour");

  const query = {
    clinicId: f.clinic.id,
    doctorId: f.doctor.id,
    appointmentTypeId: f.tenantWideType.id,
  };

  const next = await getAppointmentSlots(f.actors.admin, {
    ...query,
    date: NEXT_DAY,
  });

  check(
    "a date with no availability row returns an explicit no-availability result",
    next.outcome === "no-availability" && next.slots.length === 0,
    next,
  );

  check(
    "never infers the next day's hours from the day before",
    next.slots.length === 0,
    next.slots,
  );

  const onLeave = await getAppointmentSlots(f.actors.admin, {
    ...query,
    date: LEAVE_DAY,
  });

  check(
    "a full day of leave beats the availability window that still exists",
    onLeave.outcome === "on-leave" && onLeave.slots.length === 0,
    onLeave,
  );

  check(
    "the leave reason never reaches the response",
    !JSON.stringify(onLeave).includes("must never reach"),
    onLeave,
  );

  // The one query most likely to be written wrong: a DATE column compared
  // against a DateTime. If the availability filter were a range rather than an
  // equality, PROBE_DAY's window would leak into DAY, or vice versa.
  const probeDay = await getAppointmentSlots(f.actors.admin, {
    ...query,
    date: PROBE_DAY,
  });

  check(
    "reads only the requested date's window",
    probeDay.outcome === "ok" && probeDay.slots.length === 2,
    describeSlots(probeDay),
  );
}

async function checkOccupancy(f: Fixture): Promise<void> {
  console.log("\nOccupancy — every status, against real rows");

  const query = {
    clinicId: f.clinic.id,
    doctorId: f.doctor.id,
    appointmentTypeId: f.tenantWideType.id,
    date: PROBE_DAY,
  };

  for (const status of APPOINTMENT_STATUSES) {
    const slotStart = at(PROBE_DAY, "09:00");
    await prisma.appointment.update({
      where: { id: f.probe.id },
      // Status and sentinel written together, as every AP-3+ write must: the
      // partial-unique workaround is only correct while they agree.
      data: { status, activeSlotStart: activeSlotStartForStatus(status, slotStart) },
    });

    const result = await getAppointmentSlots(f.actors.admin, query);
    const expected = isOccupyingAppointmentStatus(status) ? "booked" : "available";

    check(
      `a ${status} appointment leaves the slot ${expected}`,
      result.slots[0]?.status === expected,
      describeSlots(result),
    );
  }

  // Left as occupying, so the row is in a realistic state for anything after.
  await prisma.appointment.update({
    where: { id: f.probe.id },
    data: {
      status: "SCHEDULED",
      activeSlotStart: at(PROBE_DAY, "09:00"),
    },
  });

  check(
    "the sweep changed no other appointment",
    (await prisma.appointment.count({ where: { tenantId: f.tenant.id } })) === 5,
  );
}

async function checkAuthorisation(f: Fixture): Promise<void> {
  console.log("\nAuthorisation");

  const query = {
    clinicId: f.clinic.id,
    doctorId: f.doctor.id,
    appointmentTypeId: f.tenantWideType.id,
    date: DAY,
  };

  await expectThrows(
    "an actor holding no appointment:read is refused (403)",
    isPermissionError,
    () => getAppointmentSlots(f.actors.staff, query),
  );

  // The order is a design decision, not an accident: someone whose
  // organisation does not have the module must be told THAT, not sent to their
  // admin for a permission they may already hold. `noFeature` lacks the module
  // and holds the permission; `staff` has the module and lacks the permission.
  // Each therefore isolates one layer, and this pins which one wins when both
  // could fire.
  await expectThrows(
    "the feature refusal wins over the permission refusal when both apply",
    (error) => error instanceof FeatureError,
    () =>
      getAppointmentSlots(f.actors.staffWithoutModule, query),
  );

  await expectThrows(
    "an actor scoped to a sibling clinic cannot read this one",
    (error) => isPermissionError(error) || isScopeError(error),
    () => getAppointmentSlots(f.actors.siblingOnly, query),
  );

  check(
    "...but can read the clinic they ARE scoped to",
    (
      await getAppointmentSlots(f.actors.siblingOnly, {
        clinicId: f.sibling.id,
        doctorId: f.siblingDoctor.id,
        appointmentTypeId: f.tenantWideType.id,
        date: DAY,
      })
    ).outcome === "no-availability",
  );

  await expectThrows(
    "another organisation cannot read this clinic's diary (404)",
    isScopeError,
    () => getAppointmentSlots(f.actors.rivalAdmin, query),
  );

  await expectThrows(
    "this organisation cannot reach into another's clinic (404)",
    isScopeError,
    () =>
      getAppointmentSlots(f.actors.admin, {
        ...query,
        clinicId: f.rivalClinic.id,
        doctorId: f.rivalDoctor.id,
      }),
  );

  await expectThrows(
    "a doctor from a sibling clinic cannot be read under this clinic's id",
    isScopeError,
    () => getAppointmentSlots(f.actors.admin, { ...query, doctorId: f.siblingDoctor.id }),
  );

  await expectThrows(
    "another organisation's doctor id is not found",
    isScopeError,
    () => getAppointmentSlots(f.actors.admin, { ...query, doctorId: f.rivalDoctor.id }),
  );
}

async function checkAppointmentTypeScope(f: Fixture): Promise<void> {
  console.log("\nAppointment type scope");

  const query = {
    clinicId: f.clinic.id,
    doctorId: f.doctor.id,
    date: DAY,
  };

  check(
    "a tenant-wide type (NULL clinic) is usable at this clinic",
    (
      await getAppointmentSlots(f.actors.admin, {
        ...query,
        appointmentTypeId: f.tenantWideType.id,
      })
    ).outcome === "ok",
  );

  check(
    "a clinic-specific type is usable at its own clinic",
    (
      await getAppointmentSlots(f.actors.admin, {
        ...query,
        appointmentTypeId: f.clinicType.id,
      })
    ).outcome === "ok",
  );

  await expectThrows(
    "a type belonging to a SIBLING clinic is refused here",
    isScopeError,
    () =>
      getAppointmentSlots(f.actors.admin, {
        ...query,
        appointmentTypeId: f.siblingType.id,
      }),
  );

  await expectThrows(
    "another organisation's type is refused",
    isScopeError,
    () =>
      getAppointmentSlots(f.actors.admin, {
        ...query,
        appointmentTypeId: f.rivalType.id,
      }),
  );

  await expectThrows(
    "a retired type is refused rather than quietly still bookable",
    isScopeError,
    () =>
      getAppointmentSlots(f.actors.admin, {
        ...query,
        appointmentTypeId: f.retiredType.id,
      }),
  );
}

async function checkFeatureGate(f: Fixture): Promise<void> {
  console.log("\nFeature entitlement");

  const query = {
    clinicId: f.clinic.id,
    doctorId: f.doctor.id,
    appointmentTypeId: f.tenantWideType.id,
    date: DAY,
  };

  check(
    "appointments is still PREMIUM, so an absent role row denies",
    f.appointmentsFeature.tier === "PREMIUM",
    f.appointmentsFeature.tier,
  );

  await expectThrows(
    "a role with the permission but no feature row is refused (layer 3)",
    (error) => error instanceof FeatureError && error.reason === "role",
    () => getAppointmentSlots(f.actors.noFeature, query),
  );

  // Layer 2: the organisation loses the module outright.
  await prisma.tenantFeatureOverride.create({
    data: {
      tenantId: f.tenant.id,
      featureId: f.appointmentsFeature.id,
      enabled: false,
      reason: "AP-2 verification",
    },
  });

  await expectThrows(
    "an organisation whose entitlement is revoked is refused (layer 2)",
    (error) => error instanceof FeatureError && error.reason === "entitlement",
    () => getAppointmentSlots(f.actors.admin, query),
  );

  await prisma.tenantFeatureOverride.deleteMany({
    where: { tenantId: f.tenant.id, featureId: f.appointmentsFeature.id },
  });

  // Layer 1: the platform-wide kill switch.
  await prisma.feature.update({
    where: { id: f.appointmentsFeature.id },
    data: { globalEnabled: false },
  });

  await expectThrows(
    "the platform kill switch refuses everyone (layer 1)",
    (error) => error instanceof FeatureError && error.reason === "global",
    () => getAppointmentSlots(f.actors.admin, query),
  );

  await prisma.feature.update({
    where: { id: f.appointmentsFeature.id },
    data: { globalEnabled: true },
  });

  check(
    "the module works again once the switch is restored",
    (await getAppointmentSlots(f.actors.admin, query)).outcome === "ok",
  );
}

async function checkResponseSafety(f: Fixture): Promise<void> {
  console.log("\nResponse safety");

  const result = await getAppointmentSlots(f.actors.admin, {
    clinicId: f.clinic.id,
    doctorId: f.doctor.id,
    appointmentTypeId: f.tenantWideType.id,
    date: DAY,
  });

  const serialised = JSON.stringify(result);

  // The 09:00 appointment carries every one of these on its own row, so if any
  // of them appears here, the select widened.
  for (const [field, value] of Object.entries(PII)) {
    check(
      `no patient ${field} in the slot response`,
      !serialised.includes(String(value)),
      serialised,
    );
  }

  check(
    "no patient id in the slot response",
    !serialised.includes(f.patient.id),
  );

  const allowed = ["start", "end", "status", "bookingId"];
  check(
    "a slot carries nothing but its times, status and booking id",
    result.slots.every((slot) =>
      Object.keys(slot).every((key) => allowed.includes(key)),
    ),
    result.slots,
  );

  check(
    "no amount, audit or medical field anywhere in the response",
    !/"(amount|createdBy|cancellationReason|bookedById|checkedInAt|patientId)"/.test(
      serialised,
    ),
    serialised,
  );
}

async function checkIdempotence(f: Fixture): Promise<void> {
  console.log("\nRepeatability");

  const query = {
    clinicId: f.clinic.id,
    doctorId: f.doctor.id,
    appointmentTypeId: f.tenantWideType.id,
    date: DAY,
  };

  const first = JSON.stringify(await getAppointmentSlots(f.actors.admin, query));
  const second = JSON.stringify(await getAppointmentSlots(f.actors.admin, query));
  const third = JSON.stringify(await getAppointmentSlots(f.actors.admin, query));

  check("three consecutive reads agree exactly", first === second && second === third);

  const before = await prisma.appointment.count({ where: { tenantId: f.tenant.id } });
  await getAppointmentSlots(f.actors.admin, query);
  const after = await prisma.appointment.count({ where: { tenantId: f.tenant.id } });

  check("reading slots writes nothing", before === after, { before, after });
}

// ---------------------------------------------------------------------------

/** Removes anything an earlier interrupted run of THIS script left behind. */
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
    await prisma.tenant.delete({ where: { id: tenant.id } });
  }

  if (stale.length > 0) {
    console.log(`  swept ${stale.length} leftover fixture tenant(s)`);
  }
}

async function main(): Promise<void> {
  console.log("=== AP-2 VERIFY: appointment slot computation ===");

  // A run that failed part-way through build() leaves tenants behind, and the
  // row-count guard below would then report a difference this run did not
  // cause. Swept first so the guard means what it says.
  await sweepLeftovers();

  const before = await countEverything();
  let fixture: Fixture | null = null;

  try {
    fixture = await build();

    await checkHappyPath(fixture);
    await checkDateHandling(fixture);
    await checkOccupancy(fixture);
    await checkAuthorisation(fixture);
    await checkAppointmentTypeScope(fixture);
    await checkFeatureGate(fixture);
    await checkResponseSafety(fixture);
    await checkIdempotence(fixture);
  } finally {
    if (fixture) {
      await teardown(fixture);
    }
  }

  console.log("\nData preservation");
  const after = await countEverything();
  for (const [table, count] of Object.entries(before)) {
    check(
      `${table}: ${count} rows before and after`,
      after[table as keyof typeof after] === count,
      { before: count, after: after[table as keyof typeof after] },
    );
  }

  console.log(
    failures === 0
      ? "\nAll checks passed."
      : `\n${failures} CHECK(S) FAILED.`,
  );
  if (failures > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error("\nScript error:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
