/**
 * AP-1 verification — the appointment schema, catalogue and locking primitive,
 * exercised against a LOCAL database.
 *
 *     npm run verify:ap1-appointments-schema
 *
 * The unit tests cover the pure rules: status transitions, half-open overlap,
 * the tier semantics, the permission snapshots. What only a database can answer
 * is whether the CONCURRENCY DESIGN actually holds, and that is most of what is
 * below. An application-level "is this slot free?" check is not concurrency-safe
 * on its own — two requests can both read "free" and both insert — so this
 * script opens genuinely concurrent transactions and races them, rather than
 * asserting that the design is sound.
 *
 * AP-1 ships no booking code, so the protocol is exercised HERE, in the same
 * order AP-3 will have to follow. That is deliberate: the guarantee is proven
 * before anything is built on top of it, and this file becomes the reference
 * for what AP-3 must do.
 *
 * Everything it creates lives under a tenant named `verify-ap1-appointments`
 * and is torn down at the end. It asserts before/after row counts on every
 * pre-existing table, so a bug here that touched real data would be visible.
 *
 * Refuses to run unless DATABASE_URL points at localhost.
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_PLAN_KEY,
  seedFeatureCatalogue,
} from "@/lib/defaultFeatures";
import { seedDefaultRoles, ROLE_KEYS } from "@/lib/defaultRoles";
import {
  ALL_PERMISSIONS,
  PRE_APPOINTMENTS_PERMISSIONS,
  PRE_STAGE_11_PERMISSIONS,
  STAGE_1_PERMISSIONS,
  STAGE_11_PERMISSIONS,
  STAGE_AP1_PERMISSIONS,
  HISTORICAL_ALL_PERMISSIONS,
  isKnownPermission,
  isUntouchedPreStage11AdminSet,
} from "@/lib/permissions";
import {
  APPOINTMENT_STATUSES,
  OCCUPYING_STATUSES,
  activeSlotStartForStatus,
  appointmentLockDate,
  type AppointmentStatus,
} from "@/lib/appointmentRules";

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

const TEST_TENANT_NAME = "verify-ap1-appointments";

/** MySQL duplicate-key. What a unique index refusing a write looks like. */
const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

/** Wall-clock tagged UTC, the convention src/lib/dates.ts establishes. */
const at = (day: string, time: string): Date =>
  new Date(`${day}T${time}:00.000Z`);

const DAY = "2026-11-02";

// ---------------------------------------------------------------------------
// Row-count guard
// ---------------------------------------------------------------------------

async function countEverything() {
  const [
    patients,
    registrations,
    doctors,
    availability,
    leave,
    userRoles,
    clinics,
    tenants,
  ] = await Promise.all([
    prisma.patient.count(),
    prisma.registration.count(),
    prisma.doctor.count(),
    prisma.doctorAvailability.count(),
    prisma.doctorLeave.count(),
    prisma.userRole.count(),
    prisma.clinic.count(),
    prisma.tenant.count(),
  ]);
  return {
    patients,
    registrations,
    doctors,
    availability,
    leave,
    userRoles,
    clinics,
    tenants,
  };
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

async function build() {
  const stamp = Date.now();
  await seedFeatureCatalogue(prisma);

  const tenant = await prisma.tenant.create({
    data: {
      businessName: TEST_TENANT_NAME,
      email: `ap1-${stamp}@example.test`,
      slug: `ap1-${stamp}`,
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
  });
  await seedDefaultRoles(prisma, tenant.id);

  const clinic = await prisma.clinic.create({
    data: { tenantId: tenant.id, name: "AP-1 Clinic" },
  });
  const otherClinic = await prisma.clinic.create({
    data: { tenantId: tenant.id, name: "AP-1 Clinic 2" },
  });

  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: `ap1-user-${stamp}@example.test`,
      passwordHash: "x",
      accountStatus: "ACTIVE",
      membershipStatus: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
  });

  const doctor = await prisma.doctor.create({
    data: { clinicId: clinic.id, name: "Dr AP-1", department: "General" },
  });
  const otherDoctor = await prisma.doctor.create({
    data: { clinicId: clinic.id, name: "Dr AP-1 B", department: "General" },
  });

  const type = await prisma.appointmentType.create({
    data: {
      tenantId: tenant.id,
      clinicId: null,
      name: "Consultation",
      durationMinutes: 30,
      defaultAmount: new Prisma.Decimal("500.00"),
    },
  });

  return { tenant, clinic, otherClinic, user, doctor, otherDoctor, type };
}

type Fixture = Awaited<ReturnType<typeof build>>;

async function teardown(fixture: Fixture): Promise<void> {
  // Order matters: RESTRICT foreign keys mean the children go first.
  await prisma.registration.deleteMany({
    where: { clinic: { tenantId: fixture.tenant.id } },
  });
  // The reschedule chain is self-referencing and RESTRICT, so clear the links
  // before deleting the rows. Nothing in the APP ever deletes an appointment —
  // this is teardown of a test fixture, not a supported operation.
  await prisma.appointment.updateMany({
    where: { tenantId: fixture.tenant.id },
    data: { rescheduledFromId: null },
  });
  await prisma.appointment.deleteMany({
    where: { tenantId: fixture.tenant.id },
  });
  await prisma.appointmentType.deleteMany({
    where: { tenantId: fixture.tenant.id },
  });
  await prisma.doctorScheduleLock.deleteMany({
    where: { doctor: { clinic: { tenantId: fixture.tenant.id } } },
  });
  await prisma.tenant.delete({ where: { id: fixture.tenant.id } });
}

// ---------------------------------------------------------------------------
// The booking protocol AP-3 must follow
// ---------------------------------------------------------------------------

interface BookInput {
  tenantId: string;
  clinicId: string;
  doctorId: string;
  appointmentTypeId: string;
  bookedById: string;
  slotStart: Date;
  slotEnd: Date;
}

class SlotTakenError extends Error {}

/**
 * The reference implementation of the concurrency protocol.
 *
 * AP-3 must follow these steps in this order. The comments say why each one is
 * the way it is, because every one of them is load-bearing.
 */
async function bookWithLock(
  client: PrismaClient,
  input: BookInput,
): Promise<string> {
  const lockDate = appointmentLockDate(input.slotStart);

  return client.$transaction(
    async (tx) => {
    // 1. Ensure the lock row exists AND take an exclusive lock on it in one
    //    statement.
    //
    //    IT MUST BE `ON DUPLICATE KEY UPDATE`, NOT `INSERT IGNORE`. This was
    //    found by this script deadlocking, not by reasoning about it, and it is
    //    the single most important detail in the protocol:
    //
    //      INSERT IGNORE takes a SHARED lock on the conflicting index record.
    //      Two concurrent bookings for the same doctor-day therefore both get
    //      an S lock, and both then try to upgrade to the X lock that step 2
    //      needs — a textbook lock-upgrade deadlock, MySQL error 1213. Neither
    //      booking succeeds and the loser is not even a clean conflict.
    //
    //      ON DUPLICATE KEY UPDATE takes an EXCLUSIVE lock on the duplicate
    //      row instead, so the second transaction blocks here and waits rather
    //      than deadlocking. `updated_at = updated_at` is a deliberate no-op:
    //      the row's contents are irrelevant, only the lock matters.
    await tx.$executeRawUnsafe(
      "INSERT INTO `doctor_schedule_locks` (`id`, `doctor_id`, `date`, `created_at`, `updated_at`) VALUES (?, ?, ?, NOW(3), NOW(3)) ON DUPLICATE KEY UPDATE `updated_at` = `updated_at`",
      `lock-${input.doctorId}-${lockDate}`,
      input.doctorId,
      lockDate,
    );

    // 2. Hold it explicitly. Step 1 already took the X lock, so this is
    //    belt-and-braces — but it keeps the intent legible and guarantees the
    //    lock is held even if step 1 is ever rewritten.
    await tx.$queryRawUnsafe(
      "SELECT `id` FROM `doctor_schedule_locks` WHERE `doctor_id` = ? AND `date` = ? FOR UPDATE",
      input.doctorId,
      lockDate,
    );

    // 3. The overlap check, AS A LOCKING READ. It must be FOR UPDATE: MySQL's
    //    default REPEATABLE READ pins a plain SELECT to a snapshot taken at the
    //    transaction's first consistent read, so an ordinary read here could
    //    miss a competitor that committed after that snapshot but before the
    //    lock was taken. A locking read always sees the latest committed row.
    //
    //    Half-open [start, end): touching end-to-start is not an overlap.
    const clash = await tx.$queryRawUnsafe<{ id: string }[]>(
      "SELECT `id` FROM `appointments` WHERE `doctor_id` = ? AND `status` IN ('SCHEDULED','CONFIRMED','CHECKED_IN','CONVERTED') AND `slot_start` < ? AND `slot_end` > ? FOR UPDATE",
      input.doctorId,
      input.slotEnd,
      input.slotStart,
    );

    if (clash.length > 0) {
      throw new SlotTakenError("That slot is no longer free.");
    }

    // 4. Only now insert. active_slot_start is derived from status by the one
    //    helper, so the index and the overlap query cannot disagree about what
    //    "busy" means.
    const status: AppointmentStatus = "SCHEDULED";
    const created = await tx.appointment.create({
      data: {
        tenantId: input.tenantId,
        clinicId: input.clinicId,
        doctorId: input.doctorId,
        appointmentTypeId: input.appointmentTypeId,
        bookedById: input.bookedById,
        name: "Concurrency Test",
        mobileNumber: "9000000000",
        amount: new Prisma.Decimal("500.00"),
        slotStart: input.slotStart,
        slotEnd: input.slotEnd,
        activeSlotStart: activeSlotStartForStatus(status, input.slotStart),
        status,
      },
      select: { id: true },
    });
      return created.id;
    },
    {
      /**
       * READ COMMITTED, not MySQL's REPEATABLE READ default. This was found by
       * this script deadlocking, and it is the second load-bearing detail.
       *
       * Under REPEATABLE READ, the `FOR UPDATE` overlap read in step 3 takes
       * GAP LOCKS over the index range it scans — including when it matches
       * nothing, which is the common case for a free slot. Two bookings for
       * DIFFERENT doctors at the same time of day scan adjacent gaps in
       * `appointments_doctor_id_slot_start_idx`, and each one's insert-intention
       * lock conflicts with the other's gap lock. The result is that two
       * completely unrelated doctors deadlock each other, which would show up
       * in production as random booking failures under load.
       *
       * READ COMMITTED takes no gap locks: only record locks on rows that
       * actually match. Correctness is unaffected because it never came from
       * gap locking in the first place — the `doctor_schedule_locks` row is
       * what serialises writers for a doctor-day, and it still does.
       *
       * It also removes the stale-snapshot hazard entirely. Under REPEATABLE
       * READ a plain SELECT is pinned to the transaction's first consistent
       * read, so an ordinary read at step 3 could miss a competitor; under READ
       * COMMITTED every statement sees the latest committed data. Step 3 stays
       * `FOR UPDATE` regardless, so the guarantee does not rest on isolation
       * level alone.
       */
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    },
  );
}

/**
 * Two bookings, genuinely concurrent, on separate connections.
 *
 * Separate PrismaClient instances matter: one client would serialise them
 * through its own pool and the race would never happen.
 */
async function race(
  a: BookInput,
  b: BookInput,
): Promise<{ won: number; taken: number; other: unknown[] }> {
  const clientA = new PrismaClient();
  const clientB = new PrismaClient();
  try {
    const results = await Promise.allSettled([
      bookWithLock(clientA, a),
      bookWithLock(clientB, b),
    ]);
    let won = 0;
    let taken = 0;
    const other: unknown[] = [];
    for (const result of results) {
      if (result.status === "fulfilled") {
        won += 1;
      } else if (
        result.reason instanceof SlotTakenError ||
        isUniqueViolation(result.reason)
      ) {
        taken += 1;
      } else {
        other.push(result.reason);
      }
    }
    return { won, taken, other };
  } finally {
    await clientA.$disconnect();
    await clientB.$disconnect();
  }
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

async function checkMigrations(): Promise<void> {
  console.log("\nMigration history");

  const rows = await prisma.$queryRawUnsafe<
    { migration_name: string; finished_at: Date | null }[]
  >(
    "SELECT `migration_name`, `finished_at` FROM `_prisma_migrations` ORDER BY `started_at` ASC",
  );
  const names = rows.map((row) => row.migration_name);

  const expandIndex = names.indexOf("20260823090000_appointment_expand");
  const constrainIndex = names.indexOf("20260823090100_appointment_constrain");

  check("the expand migration is applied", expandIndex >= 0, names);
  check("the constrain migration is applied", constrainIndex >= 0, names);
  check(
    "expand ran before constrain",
    expandIndex >= 0 && constrainIndex > expandIndex,
    { expandIndex, constrainIndex },
  );
  check(
    "every AP-1 migration finished",
    rows
      .filter((row) => row.migration_name.includes("appointment_"))
      .every((row) => row.finished_at !== null),
  );
}

async function checkTables(): Promise<void> {
  console.log("\nSchema shape");

  const table = async (name: string): Promise<Set<string>> => {
    const rows = await prisma.$queryRawUnsafe<{ COLUMN_NAME: string }[]>(
      "SELECT `COLUMN_NAME` FROM `information_schema`.`COLUMNS` WHERE `TABLE_SCHEMA` = DATABASE() AND `TABLE_NAME` = ?",
      name,
    );
    return new Set(rows.map((row) => row.COLUMN_NAME));
  };

  const appointments = await table("appointments");
  const types = await table("appointment_types");
  const locks = await table("doctor_schedule_locks");

  check("appointments table exists", appointments.size > 0);
  check("appointment_types table exists", types.size > 0);
  check("doctor_schedule_locks table exists", locks.size > 0);

  for (const column of [
    "tenant_id",
    "clinic_id",
    "doctor_id",
    "appointment_type_id",
    "patient_id",
    "name",
    "mobile_number",
    "amount",
    "slot_start",
    "slot_end",
    "active_slot_start",
    "status",
    "booked_by_id",
    "checked_in_at",
    "cancelled_at",
    "cancellation_reason",
    "rescheduled_from_id",
  ]) {
    check(`appointments.${column} exists`, appointments.has(column));
  }

  check(
    "appointments uses the Patient field names, not patientName aliases",
    appointments.has("name") &&
      appointments.has("mobile_number") &&
      !appointments.has("patient_name") &&
      !appointments.has("patient_phone"),
  );

  check(
    "no convertedRegistrationId column was added — one FK, not two",
    !appointments.has("converted_registration_id"),
  );

  check(
    "appointment_types.default_amount has NO database default",
    await columnHasNoDefault("appointment_types", "default_amount"),
  );

  // The enum must hold all seven, or a status transition would fail at write
  // time rather than at review time.
  const statusType = await prisma.$queryRawUnsafe<{ COLUMN_TYPE: string }[]>(
    "SELECT `COLUMN_TYPE` FROM `information_schema`.`COLUMNS` WHERE `TABLE_SCHEMA` = DATABASE() AND `TABLE_NAME` = 'appointments' AND `COLUMN_NAME` = 'status'",
  );
  const statusSql = statusType[0]?.COLUMN_TYPE ?? "";
  for (const status of APPOINTMENT_STATUSES) {
    check(`AppointmentStatus includes ${status}`, statusSql.includes(status));
  }
}

async function columnHasNoDefault(
  table: string,
  column: string,
): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ COLUMN_DEFAULT: string | null }[]>(
    "SELECT `COLUMN_DEFAULT` FROM `information_schema`.`COLUMNS` WHERE `TABLE_SCHEMA` = DATABASE() AND `TABLE_NAME` = ? AND `COLUMN_NAME` = ?",
    table,
    column,
  );
  return rows[0]?.COLUMN_DEFAULT === null;
}

async function checkIndexes(): Promise<void> {
  console.log("\nIndexes");

  const indexes = await prisma.$queryRawUnsafe<
    { TABLE_NAME: string; INDEX_NAME: string; NON_UNIQUE: bigint }[]
  >(
    "SELECT DISTINCT `TABLE_NAME`, `INDEX_NAME`, `NON_UNIQUE` FROM `information_schema`.`STATISTICS` WHERE `TABLE_SCHEMA` = DATABASE() AND `TABLE_NAME` IN ('appointments','appointment_types','doctor_schedule_locks','registrations')",
  );
  // NON_UNIQUE arrives from information_schema as a BigInt through the raw
  // driver, so `=== 0` is false for a unique index. Compare as a string.
  const unique = new Set(
    indexes
      .filter((row) => String(row.NON_UNIQUE) === "0")
      .map((row) => row.INDEX_NAME),
  );

  check(
    "appointments has the (doctor_id, active_slot_start) backstop",
    unique.has("appointments_doctor_id_active_slot_start_key"),
  );
  check(
    "doctor_schedule_locks has the (doctor_id, date) lock key",
    unique.has("doctor_schedule_locks_doctor_id_date_key"),
  );
  check(
    "appointment_types has the (tenant_id, clinic_id, name) unique",
    unique.has("appointment_types_tenant_id_clinic_id_name_key"),
  );
  check(
    "registrations.appointment_id is unique",
    unique.has("registrations_appointment_id_key"),
  );

  // The redundant-index trap the constrain migration exists to avoid: adding
  // the FK before the unique index would have left MySQL's auto-created plain
  // index behind for good.
  const registrationIndexes = indexes.filter(
    (row) =>
      row.TABLE_NAME === "registrations" &&
      row.INDEX_NAME.includes("appointment_id"),
  );
  check(
    "registrations has exactly one appointment_id index, not a redundant pair",
    registrationIndexes.length === 1,
    registrationIndexes,
  );
}

async function checkExistingData(): Promise<void> {
  console.log("\nExisting data is untouched");

  const linked = await prisma.registration.count({
    where: { appointmentId: { not: null } },
  });
  check(
    "no pre-existing registration was linked to an appointment",
    linked === 0,
    linked,
  );

  const appointments = await prisma.appointment.count();
  check(
    "the migration manufactured no appointment rows",
    appointments === 0,
    appointments,
  );

  const types = await prisma.appointmentType.count();
  check(
    "the migration manufactured no appointment types",
    types === 0,
    types,
  );
}

async function checkCatalogue(): Promise<void> {
  console.log("\nFeature catalogue");

  const features = await prisma.feature.findMany({
    where: { key: "appointments" },
    select: { id: true, tier: true, globalEnabled: true, name: true },
  });
  check("exactly one appointments feature exists", features.length === 1);

  const feature = features[0];
  check("its tier is PREMIUM", feature?.tier === "PREMIUM", feature?.tier);
  check("it is globally enabled", feature?.globalEnabled === true);

  const plan = await prisma.plan.findUnique({
    where: { key: DEFAULT_PLAN_KEY },
    select: { id: true },
  });
  check(`the '${DEFAULT_PLAN_KEY}' plan exists`, plan !== null);

  if (plan && feature) {
    const links = await prisma.planFeature.count({
      where: { planId: plan.id, featureId: feature.id },
    });
    check("the plan links appointments exactly once", links === 1, links);
  }

  // The whole point of PREMIUM: entitling the organisation must not expose the
  // module to every role. AP-1 writes no layer-3 rows at all.
  if (feature) {
    const roleRows = await prisma.roleFeatureAccess.count({
      where: { featureId: feature.id },
    });
    check(
      "AP-1 wrote no RoleFeatureAccess rows — a Clinic Admin decides",
      roleRows === 0,
      roleRows,
    );
  }
}

async function checkPermissions(): Promise<void> {
  console.log("\nPermission catalogue");

  for (const permission of STAGE_AP1_PERMISSIONS) {
    check(`${permission} is a known permission`, isKnownPermission(permission));
  }
  check("AP-1 added exactly eight keys", STAGE_AP1_PERMISSIONS.length === 8);

  for (const permission of STAGE_AP1_PERMISSIONS) {
    check(
      `${permission} is kept out of the Stage 1 backfill list`,
      !STAGE_1_PERMISSIONS.includes(permission),
    );
    check(
      `${permission} is kept out of the pre-Stage-11 snapshot`,
      !PRE_STAGE_11_PERMISSIONS.includes(permission),
    );
    check(
      `${permission} is not in the frozen pre-Stage-1 twenty`,
      !HISTORICAL_ALL_PERMISSIONS.includes(permission),
    );
    check(
      `${permission} is not in the Stage 11 list`,
      !STAGE_11_PERMISSIONS.includes(permission),
    );
  }

  // The regression that would otherwise be silent: the Stage 11 backfill
  // quietly stopping, because its exact-set comparison never matches again.
  check(
    "a genuine pre-Stage-11 Admin is still recognised as untouched",
    isUntouchedPreStage11AdminSet([...PRE_STAGE_11_PERMISSIONS]),
  );

  check(
    "every catalogue key belongs to exactly one stage list",
    ALL_PERMISSIONS.every(
      (permission) =>
        HISTORICAL_ALL_PERMISSIONS.includes(permission) ||
        STAGE_1_PERMISSIONS.includes(permission) ||
        STAGE_11_PERMISSIONS.includes(permission) ||
        STAGE_AP1_PERMISSIONS.includes(permission),
    ),
  );

  check(
    "the pre-AP-1 snapshot is the catalogue minus the eight",
    PRE_APPOINTMENTS_PERMISSIONS.length ===
      ALL_PERMISSIONS.length - STAGE_AP1_PERMISSIONS.length,
  );
}

async function checkSeededRoles(fixture: Fixture): Promise<void> {
  console.log("\nSeeded roles for a new organisation");

  const roles = await prisma.role.findMany({
    where: { tenantId: fixture.tenant.id },
    select: { key: true, permissions: true },
  });
  const byKey = new Map(
    roles.map((role) => [role.key, role.permissions as string[]]),
  );

  const admin = byKey.get(ROLE_KEYS.CLINIC_ADMIN) ?? [];
  const receptionist = byKey.get(ROLE_KEYS.RECEPTIONIST) ?? [];
  const doctor = byKey.get(ROLE_KEYS.DOCTOR) ?? [];
  const staff = byKey.get(ROLE_KEYS.STAFF) ?? [];
  const owner = byKey.get(ROLE_KEYS.OWNER) ?? [];

  check(
    "Admin holds all eight",
    STAGE_AP1_PERMISSIONS.every((permission) => admin.includes(permission)),
  );
  check(
    "Receptionist holds the seven booking keys",
    STAGE_AP1_PERMISSIONS.filter((p) => p !== "appointment:type:manage").every(
      (permission) => receptionist.includes(permission),
    ),
  );
  check(
    "Receptionist cannot manage appointment types",
    !receptionist.includes("appointment:type:manage"),
  );
  check(
    "Doctor holds appointment:read and nothing more",
    doctor.includes("appointment:read") &&
      STAGE_AP1_PERMISSIONS.filter((p) => p !== "appointment:read").every(
        (permission) => !doctor.includes(permission),
      ),
  );
  check(
    "Staff holds no appointment permission",
    STAGE_AP1_PERMISSIONS.every((permission) => !staff.includes(permission)),
  );
  check("Owner still holds only the wildcard", owner.length === 1 && owner[0] === "*");
}

async function checkScopeConstraints(fixture: Fixture): Promise<void> {
  console.log("\nScope and delete rules");

  // A clinic-specific type is usable only at its clinic. Enforced in
  // application code (appointmentRules.ts) — this proves the COLUMN exists and
  // is nullable, which is what the rule depends on.
  const scoped = await prisma.appointmentType.create({
    data: {
      tenantId: fixture.tenant.id,
      clinicId: fixture.otherClinic.id,
      name: "Site-specific",
      durationMinutes: 20,
      defaultAmount: new Prisma.Decimal("250.00"),
    },
  });
  check("a clinic-scoped appointment type can be created", scoped !== null);

  // The documented MySQL quirk, asserted rather than assumed — because AP-6
  // has to write an application-level check on the strength of it.
  const wide1 = await prisma.appointmentType.create({
    data: {
      tenantId: fixture.tenant.id,
      clinicId: null,
      name: "Duplicate tenant-wide",
      durationMinutes: 15,
      defaultAmount: new Prisma.Decimal("100.00"),
    },
  });
  const wide2 = await prisma.appointmentType.create({
    data: {
      tenantId: fixture.tenant.id,
      clinicId: null,
      name: "Duplicate tenant-wide",
      durationMinutes: 15,
      defaultAmount: new Prisma.Decimal("100.00"),
    },
  });
  check(
    "MySQL DOES allow two tenant-wide types to share a name (NULLs are distinct) — AP-6 must check this in application code",
    wide1.id !== wide2.id,
  );

  // The same index DOES bite when the clinic is set, which is what makes it
  // worth having at all.
  await expectThrows(
    "two clinic-scoped types cannot share a name at one clinic",
    isUniqueViolation,
    () =>
      prisma.appointmentType.create({
        data: {
          tenantId: fixture.tenant.id,
          clinicId: fixture.otherClinic.id,
          name: "Site-specific",
          durationMinutes: 20,
          defaultAmount: new Prisma.Decimal("250.00"),
        },
      }),
  );

  await prisma.appointmentType.deleteMany({
    where: { id: { in: [scoped.id, wide1.id, wide2.id] } },
  });

  // Restrict on doctor: the schedule history must survive a doctor's removal
  // attempt rather than vanishing with them.
  const held = await prisma.appointment.create({
    data: {
      tenantId: fixture.tenant.id,
      clinicId: fixture.clinic.id,
      doctorId: fixture.doctor.id,
      appointmentTypeId: fixture.type.id,
      bookedById: fixture.user.id,
      name: "Delete Guard",
      mobileNumber: "9000000001",
      amount: new Prisma.Decimal("500.00"),
      slotStart: at(DAY, "15:00"),
      slotEnd: at(DAY, "15:30"),
      activeSlotStart: at(DAY, "15:00"),
      status: "SCHEDULED",
    },
  });

  await expectThrows(
    "a doctor with appointments cannot be deleted (Restrict)",
    () => true,
    () => prisma.doctor.delete({ where: { id: fixture.doctor.id } }),
  );
  await expectThrows(
    "an appointment type in use cannot be deleted (Restrict)",
    () => true,
    () => prisma.appointmentType.delete({ where: { id: fixture.type.id } }),
  );

  // SetNull on patient: deleting a patient must NEVER delete an appointment.
  const patient = await prisma.patient.create({
    data: {
      tenantId: fixture.tenant.id,
      clinicId: fixture.clinic.id,
      patientCode: `PT-VERIFY-${Date.now()}`,
      name: "Detach Me",
      mobileNumber: "9000000002",
    },
  });
  await prisma.appointment.update({
    where: { id: held.id },
    data: { patientId: patient.id },
  });
  await prisma.patient.delete({ where: { id: patient.id } });
  const survivor = await prisma.appointment.findUnique({
    where: { id: held.id },
    select: { id: true, patientId: true, name: true, mobileNumber: true },
  });
  check(
    "deleting a patient detaches the appointment but does not delete it",
    survivor !== null && survivor.patientId === null,
    survivor,
  );
  check(
    "the detached appointment is still readable from its own columns",
    survivor?.name === "Delete Guard" && survivor?.mobileNumber === "9000000001",
  );

  await prisma.appointment.delete({ where: { id: held.id } });
}

async function checkConcurrency(fixture: Fixture): Promise<void> {
  console.log("\nSlot concurrency — the part only a database can answer");

  const base: Omit<BookInput, "slotStart" | "slotEnd"> = {
    tenantId: fixture.tenant.id,
    clinicId: fixture.clinic.id,
    doctorId: fixture.doctor.id,
    appointmentTypeId: fixture.type.id,
    bookedById: fixture.user.id,
  };

  // 1. Identical slots. The obvious case.
  const identical = await race(
    { ...base, slotStart: at(DAY, "09:00"), slotEnd: at(DAY, "09:30") },
    { ...base, slotStart: at(DAY, "09:00"), slotEnd: at(DAY, "09:30") },
  );
  check(
    "two concurrent bookings of the identical slot: exactly one wins",
    identical.won === 1 && identical.taken === 1,
    identical,
  );
  check("no unexpected error in the identical race", identical.other.length === 0, identical.other);

  const after09 = await prisma.appointment.count({
    where: { doctorId: fixture.doctor.id, slotStart: at(DAY, "09:00") },
  });
  check("only one row exists for that slot", after09 === 1, after09);

  // 2. PARTIALLY overlapping slots with DIFFERENT start times. This is the case
  //    the unique index cannot see, so it is the one that proves the lock is
  //    doing real work rather than the index carrying it.
  const partial = await race(
    { ...base, slotStart: at(DAY, "11:00"), slotEnd: at(DAY, "11:30") },
    { ...base, slotStart: at(DAY, "11:15"), slotEnd: at(DAY, "11:45") },
  );
  check(
    "two concurrent PARTIALLY overlapping bookings: exactly one wins",
    partial.won === 1 && partial.taken === 1,
    partial,
  );
  check("no unexpected error in the partial-overlap race", partial.other.length === 0, partial.other);

  // 3. Adjacent slots must BOTH succeed, or the half-open convention is wrong
  //    and the schedule would lose a slot at every boundary.
  const adjacent = await race(
    { ...base, slotStart: at(DAY, "13:00"), slotEnd: at(DAY, "13:30") },
    { ...base, slotStart: at(DAY, "13:30"), slotEnd: at(DAY, "14:00") },
  );
  check(
    "two adjacent bookings both succeed — [start, end) is half-open",
    adjacent.won === 2 && adjacent.taken === 0,
    adjacent,
  );

  // 4. Different doctors, same time. The lock must not serialise unrelated work.
  const crossDoctor = await race(
    { ...base, slotStart: at(DAY, "16:00"), slotEnd: at(DAY, "16:30") },
    {
      ...base,
      doctorId: fixture.otherDoctor.id,
      slotStart: at(DAY, "16:00"),
      slotEnd: at(DAY, "16:30"),
    },
  );
  check(
    "two doctors can be booked at the same time",
    crossDoctor.won === 2 && crossDoctor.taken === 0,
    crossDoctor,
  );

  // 5. Cancelling frees the slot — and keeps the row.
  const taken = await prisma.appointment.findFirst({
    where: { doctorId: fixture.doctor.id, slotStart: at(DAY, "09:00") },
    select: { id: true, slotStart: true, slotEnd: true },
  });
  if (taken) {
    await prisma.appointment.update({
      where: { id: taken.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledById: fixture.user.id,
        cancellationReason: "verify",
        // Released by the SAME single column write that changes the status, so
        // the index and the overlap query cannot disagree.
        activeSlotStart: activeSlotStartForStatus("CANCELLED", taken.slotStart),
      },
    });

    const rebooked = await bookWithLock(prisma as PrismaClient, {
      ...base,
      slotStart: at(DAY, "09:00"),
      slotEnd: at(DAY, "09:30"),
    });
    check("a cancelled slot can be booked again", typeof rebooked === "string");

    const kept = await prisma.appointment.findUnique({
      where: { id: taken.id },
      select: { id: true, status: true, slotStart: true, slotEnd: true },
    });
    check(
      "the cancelled appointment still exists, with its original times intact",
      kept !== null &&
        kept.status === "CANCELLED" &&
        kept.slotStart.getTime() === taken.slotStart.getTime() &&
        kept.slotEnd.getTime() === taken.slotEnd.getTime(),
      kept,
    );
  }

  // 6. The backstop, proven INDEPENDENTLY of the lock. If a future code path
  //    ever forgets the protocol, this is what turns a silent double-booking
  //    into a loud constraint violation.
  await expectThrows(
    "the unique index alone still rejects a duplicate active start",
    isUniqueViolation,
    () =>
      prisma.appointment.create({
        data: {
          ...base,
          name: "Bypass",
          mobileNumber: "9000000003",
          amount: new Prisma.Decimal("500.00"),
          slotStart: at(DAY, "13:00"),
          slotEnd: at(DAY, "13:30"),
          activeSlotStart: at(DAY, "13:00"),
          status: "SCHEDULED",
        },
      }),
  );

  // 7. Many released rows may share a doctor and a start time. This is what
  //    makes the nullable sentinel a workable substitute for a partial index.
  const releasedA = await prisma.appointment.create({
    data: {
      ...base,
      name: "Released A",
      mobileNumber: "9000000004",
      amount: new Prisma.Decimal("500.00"),
      slotStart: at(DAY, "18:00"),
      slotEnd: at(DAY, "18:30"),
      activeSlotStart: null,
      status: "CANCELLED",
    },
  });
  const releasedB = await prisma.appointment.create({
    data: {
      ...base,
      name: "Released B",
      mobileNumber: "9000000005",
      amount: new Prisma.Decimal("500.00"),
      slotStart: at(DAY, "18:00"),
      slotEnd: at(DAY, "18:30"),
      activeSlotStart: null,
      status: "NO_SHOW",
    },
  });
  check(
    "many released rows may share a doctor and start time (NULLs are distinct)",
    releasedA.id !== releasedB.id,
  );

  // 8. A CONVERTED appointment KEEPS the slot. The patient arrived and was seen.
  const convertedSlot = at(DAY, "19:00");
  await prisma.appointment.create({
    data: {
      ...base,
      name: "Converted",
      mobileNumber: "9000000006",
      amount: new Prisma.Decimal("500.00"),
      slotStart: convertedSlot,
      slotEnd: at(DAY, "19:30"),
      activeSlotStart: activeSlotStartForStatus("CONVERTED", convertedSlot),
      status: "CONVERTED",
    },
  });
  let convertedBlocked = false;
  try {
    await bookWithLock(prisma as PrismaClient, {
      ...base,
      slotStart: convertedSlot,
      slotEnd: at(DAY, "19:30"),
    });
  } catch (error: unknown) {
    convertedBlocked = error instanceof SlotTakenError || isUniqueViolation(error);
  }
  check(
    "a CONVERTED appointment still blocks its slot — the visit happened",
    convertedBlocked,
  );
}

async function checkInvariant(fixture: Fixture): Promise<void> {
  console.log("\nThe activeSlotStart / status invariant");

  const rows = await prisma.appointment.findMany({
    where: { tenantId: fixture.tenant.id },
    select: { id: true, status: true, slotStart: true, activeSlotStart: true },
  });
  check("there are rows to check the invariant against", rows.length > 0);

  const broken = rows.filter((row) => {
    const expected = activeSlotStartForStatus(
      row.status as AppointmentStatus,
      row.slotStart,
    );
    if (expected === null) return row.activeSlotStart !== null;
    return row.activeSlotStart?.getTime() !== expected.getTime();
  });
  check(
    "every row's activeSlotStart matches what its status requires",
    broken.length === 0,
    broken,
  );

  const occupying = rows.filter((row) =>
    OCCUPYING_STATUSES.includes(row.status as AppointmentStatus),
  );
  check(
    "every occupying row mirrors its slotStart",
    occupying.every(
      (row) => row.activeSlotStart?.getTime() === row.slotStart.getTime(),
    ),
  );
}

async function checkDoubleConversion(fixture: Fixture): Promise<void> {
  console.log("\nDouble-conversion guard");

  const appointment = await prisma.appointment.findFirst({
    where: { tenantId: fixture.tenant.id, status: "SCHEDULED" },
    select: { id: true },
  });
  if (!appointment) {
    check("an appointment was available to convert", false);
    return;
  }

  const patient = await prisma.patient.create({
    data: {
      tenantId: fixture.tenant.id,
      clinicId: fixture.clinic.id,
      patientCode: `PT-CONV-${Date.now()}`,
      name: "Converted Patient",
      mobileNumber: "9000000007",
    },
  });

  const first = await prisma.registration.create({
    data: {
      clinicId: fixture.clinic.id,
      patientId: patient.id,
      doctorId: fixture.doctor.id,
      department: "General",
      amount: new Prisma.Decimal("500.00"),
      visitDate: at(DAY, "09:00"),
      createdBy: fixture.user.id,
      appointmentId: appointment.id,
    },
  });
  check("an appointment can be converted once", first !== null);

  await expectThrows(
    "the same appointment cannot be converted twice — the UNIQUE refuses it",
    isUniqueViolation,
    () =>
      prisma.registration.create({
        data: {
          clinicId: fixture.clinic.id,
          patientId: patient.id,
          doctorId: fixture.doctor.id,
          department: "General",
          amount: new Prisma.Decimal("500.00"),
          visitDate: at(DAY, "09:00"),
          createdBy: fixture.user.id,
          appointmentId: appointment.id,
        },
      }),
  );

  // Unlimited walk-ins may coexist: MySQL permits many NULLs under a UNIQUE.
  const walkInA = await prisma.registration.create({
    data: {
      clinicId: fixture.clinic.id,
      patientId: patient.id,
      department: "General",
      amount: new Prisma.Decimal("100.00"),
      visitDate: at(DAY, "10:00"),
      createdBy: fixture.user.id,
    },
  });
  const walkInB = await prisma.registration.create({
    data: {
      clinicId: fixture.clinic.id,
      patientId: patient.id,
      department: "General",
      amount: new Prisma.Decimal("100.00"),
      visitDate: at(DAY, "10:30"),
      createdBy: fixture.user.id,
    },
  });
  check(
    "many walk-in registrations coexist with appointment_id NULL",
    walkInA.appointmentId === null && walkInB.appointmentId === null,
  );
}

async function checkIdempotence(): Promise<void> {
  console.log("\nRe-running the seed is a no-op");

  const before = await Promise.all([
    prisma.feature.count(),
    prisma.planFeature.count(),
    prisma.plan.count(),
  ]);
  const result = await seedFeatureCatalogue(prisma);
  const after = await Promise.all([
    prisma.feature.count(),
    prisma.planFeature.count(),
    prisma.plan.count(),
  ]);

  check(
    "a second seedFeatureCatalogue creates nothing",
    result.createdFeatures.length === 0 &&
      result.linkedFeatures.length === 0 &&
      result.createdPlan === false,
    result,
  );
  check(
    "the feature, plan and link counts are unchanged",
    before[0] === after[0] && before[1] === after[1] && before[2] === after[2],
    { before, after },
  );
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("AP-1 appointment schema verification\n");

  const before = await countEverything();

  await checkMigrations();
  await checkTables();
  await checkIndexes();
  await checkExistingData();
  await checkCatalogue();
  await checkPermissions();
  await checkIdempotence();

  const fixture = await build();
  try {
    await checkSeededRoles(fixture);
    await checkScopeConstraints(fixture);
    await checkConcurrency(fixture);
    await checkInvariant(fixture);
    await checkDoubleConversion(fixture);
  } finally {
    await teardown(fixture);
  }

  console.log("\nPre-existing data");
  const after = await countEverything();
  for (const key of Object.keys(before) as (keyof typeof before)[]) {
    check(
      `${key} count unchanged (${before[key]})`,
      before[key] === after[key],
      { before: before[key], after: after[key] },
    );
  }

  console.log(
    failures === 0
      ? "\nAll checks passed."
      : `\n${failures} check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main()
  .catch((error: unknown) => {
    console.error("\nScript error:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
