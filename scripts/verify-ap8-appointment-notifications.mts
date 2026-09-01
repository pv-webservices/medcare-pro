/**
 * AP-8 verification — appointment notifications and reminders, against a LOCAL
 * database.
 *
 *     npm run verify:ap8-appointment-notifications
 *
 * NOTHING IN THIS SCRIPT SENDS A REAL WHATSAPP MESSAGE, and that is enforced by
 * construction rather than by hoping. Every appointment it books carries the
 * mobile number SAFE_UNSENDABLE_NUMBER, which is deliberately too short to be a
 * phone number. `deliverTemplate` normalises the number FIRST and short-circuits
 * anything under ten digits before it calls the gateway or even the
 * is-this-on-WhatsApp pre-check — so the reminder path runs end to end, writes
 * its history row, and never opens a socket. WHATSAPP_BSP_API_KEY is set in
 * this project's .env, so a script that used a realistic number would text
 * whoever owns it.
 *
 * tests/unit/appointmentReminderRules.test.ts already pins which statuses are
 * remindable and what a reminder says. This script exists for the eight things
 * it cannot reach:
 *
 *   1. THAT THE FEED ACTUALLY FILLS. A notification is written by a
 *      post-commit side effect of four different mutations across three
 *      modules; only a real booking proves the call site is wired.
 *   2. THAT CHECKING IN AND CONVERTING RAISE NOTHING EXTRA. Both are
 *      deliberate absences, and an absence is exactly what a unit test of the
 *      type list cannot demonstrate.
 *   3. THAT A FEED ROW NEVER FAILS ITS ACTION — asserted by cancelling an
 *      appointment whose notification cannot be written, and finding the
 *      cancellation committed anyway.
 *   4. SCOPE. Notifications carry the clinic, and a neighbouring organisation's
 *      feed must not show any of them.
 *   5. THAT THE MESSAGES CARRY NO PATIENT CONTACT DETAILS — a name, and nothing
 *      else that identifies or reaches somebody.
 *   6. THE REMINDER'S AUTHORISATION — `message:send`, not any appointment
 *      permission, at the appointment's own clinic, behind the module gate.
 *   7. THE REMINDER'S REFUSALS over real rows, including the AP-8 limitation:
 *      a booking with no patient record cannot be messaged.
 *   8. THAT A SENT REMINDER IS RECORDED against the patient, with the template
 *      name denormalised, exactly as the Messages screen records one.
 *
 * Everything it creates lives under tenants named `verify-ap8-notify` and is
 * torn down at the end. Row counts on every pre-existing table are asserted
 * before and after.
 *
 * Refuses to run unless DATABASE_URL points at localhost.
 */

import { BadRequestError } from "@/lib/apiHandler";
import { prisma } from "@/lib/prisma";
import {
  cancelAppointment,
  checkInAppointment,
  markAppointmentNoShow,
} from "@/lib/appointmentLifecycle";
import { NO_PATIENT_MESSAGE } from "@/lib/appointmentReminderRules";
import { sendAppointmentReminder } from "@/lib/appointmentReminders";
import { rescheduleAppointment } from "@/lib/appointmentReschedule";
import { createAppointment } from "@/lib/appointments";
import { createAppointmentType } from "@/lib/appointmentTypes";
import { convertAppointmentToRegistration } from "@/lib/appointmentConversion";
import { DEFAULT_PLAN_KEY, seedFeatureCatalogue } from "@/lib/defaultFeatures";
import { ROLE_KEYS, seedDefaultRoles } from "@/lib/defaultRoles";
import { FeatureError } from "@/lib/featureResolution";
import { listNotificationsForActor } from "@/lib/notifications";
import { PermissionError, ScopeError, type ActorContext } from "@/lib/rbac";
import { createTemplate } from "@/lib/whatsappTemplates";

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
const isBadRequestError = (error: unknown): boolean =>
  error instanceof BadRequestError;
const isFeatureError = (error: unknown): boolean => error instanceof FeatureError;

const TEST_TENANT_NAME = "verify-ap8-notify";

const DAY = "2027-05-10";
const OTHER_DAY = "2027-05-11";

const iso = (day: string, time: string): string => `${day}T${time}:00.000Z`;
const dayOnly = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

/**
 * THE SAFETY INTERLOCK. Five digits: a valid booking contact as far as the
 * appointment schema is concerned (it allows five characters and up), and far
 * too short for `toDigits` to produce a sendable number — so `deliverTemplate`
 * refuses it locally, before the gateway or the number-check call.
 *
 * Do not "fix" this to look like a real number. It is the only thing standing
 * between this script and texting a stranger.
 */
const SAFE_UNSENDABLE_NUMBER = "12345";

/** Loud enough that finding any of it in a notification is unambiguous. */
const PII = {
  mobileNumber: SAFE_UNSENDABLE_NUMBER,
  address: "88 Disclosure Drive",
  city: "Leakstown",
  gender: "Female" as const,
  age: 48,
};

const PATIENT_NAME = "Zzyzx Ap8 Patient";
const DEPARTMENT = "AP-8 Cardiology";

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
    roles,
    userRoles,
    features,
    auditLogs,
    notifications,
    whatsappMessages,
    whatsappTemplates,
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
    prisma.role.count(),
    prisma.userRole.count(),
    prisma.feature.count(),
    prisma.auditLog.count(),
    prisma.notification.count(),
    prisma.whatsappMessage.count(),
    prisma.whatsappTemplate.count(),
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
    roles,
    userRoles,
    features,
    auditLogs,
    notifications,
    whatsappMessages,
    whatsappTemplates,
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
  const whatsappFeature = await prisma.feature.findUniqueOrThrow({
    where: { key: "whatsapp" },
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
  const rival = await makeTenant("rival");

  await seedDefaultRoles(prisma, tenant.id);
  await seedDefaultRoles(prisma, rival.id);

  const makeClinic = (tenantId: string, name: string) =>
    prisma.clinic.create({ data: { tenantId, name }, select: { id: true } });

  const clinic = await makeClinic(tenant.id, "AP-8 Alpha");
  const sibling = await makeClinic(tenant.id, "AP-8 Beta");
  const rivalClinic = await makeClinic(rival.id, "AP-8 Rival");

  const makeDoctor = (clinicId: string, name: string) =>
    prisma.doctor.create({
      data: { clinicId, name, department: DEPARTMENT },
      select: { id: true, clinicId: true },
    });

  const doctor = await makeDoctor(clinic.id, "AP-8 Dr Alpha");
  const siblingDoctor = await makeDoctor(sibling.id, "AP-8 Dr Beta");

  for (const d of [doctor, siblingDoctor]) {
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
  const rivalAdminRoleId = await roleId(rival.id, ROLE_KEYS.CLINIC_ADMIN);

  // Runs the whole appointment desk and may NOT message. The subject of the
  // 403: the only difference from Receptionist is `message:send`, so a refusal
  // can only be that permission doing its job.
  const noMessageRole = await prisma.role.create({
    data: {
      tenantId: tenant.id,
      name: "AP-8 Desk without messaging",
      permissions: [
        "appointment:read",
        "appointment:create",
        "appointment:checkin",
        "appointment:cancel",
        "appointment:convert",
        "appointment:reschedule",
        "registration:create",
        "registration:read",
      ],
      isSystem: false,
    },
    select: { id: true },
  });

  // Holds message:send but has no appointments module, so layer 3 denies first.
  const unentitledRole = await prisma.role.create({
    data: {
      tenantId: tenant.id,
      name: "AP-8 Messenger, module off",
      permissions: ["appointment:read", "message:send"],
      isSystem: false,
    },
    select: { id: true },
  });

  for (const id of [
    adminRoleId,
    receptionRoleId,
    rivalAdminRoleId,
    noMessageRole.id,
  ]) {
    for (const feature of [appointmentsFeature, whatsappFeature]) {
      await prisma.roleFeatureAccess.create({
        data: { roleId: id, featureId: feature.id, enabled: true },
      });
    }
  }
  // The unentitled role gets WhatsApp but NOT appointments, so the refusal it
  // meets can only be the appointments gate.
  await prisma.roleFeatureAccess.create({
    data: { roleId: unentitledRole.id, featureId: whatsappFeature.id, enabled: true },
  });

  const makeUser = (suffix: string, tenantId: string) =>
    prisma.user.create({
      data: {
        tenantId,
        email: `${TEST_TENANT_NAME}-${suffix}-${stamp}@example.test`,
        name: `AP-8 ${suffix}`,
        passwordHash: "x",
        accountStatus: "ACTIVE",
        membershipStatus: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
      select: { id: true },
    });

  const adminUser = await makeUser("admin", tenant.id);
  const receptionUser = await makeUser("reception", tenant.id);
  const siblingUser = await makeUser("sibling", tenant.id);
  const noMessageUser = await makeUser("nomessage", tenant.id);
  const noModuleUser = await makeUser("nomodule", tenant.id);
  const rivalUser = await makeUser("rival", rival.id);

  const assign = (userId: string, roleId: string, clinicId: string | null) =>
    prisma.userRole.create({ data: { userId, roleId, clinicId } });

  await assign(adminUser.id, adminRoleId, null);
  await assign(receptionUser.id, receptionRoleId, null);
  // Clinic-scoped to the SIBLING only — the notification-scope subject.
  await assign(siblingUser.id, adminRoleId, sibling.id);
  await assign(noMessageUser.id, noMessageRole.id, null);
  await assign(noModuleUser.id, unentitledRole.id, null);
  await assign(rivalUser.id, rivalAdminRoleId, null);

  const actor = (userId: string, tenantId: string): ActorContext => ({
    userId,
    tenantId,
  });

  const actors = {
    admin: actor(adminUser.id, tenant.id),
    reception: actor(receptionUser.id, tenant.id),
    sibling: actor(siblingUser.id, tenant.id),
    noMessage: actor(noMessageUser.id, tenant.id),
    noModule: actor(noModuleUser.id, tenant.id),
    rival: actor(rivalUser.id, rival.id),
  };

  const service = await createAppointmentType(actors.admin, {
    clinicId: clinic.id,
    name: "AP-8 Consultation",
    durationMinutes: 30,
    defaultAmount: 500,
  });
  const siblingService = await createAppointmentType(actors.admin, {
    clinicId: sibling.id,
    name: "AP-8 Beta Consultation",
    durationMinutes: 30,
    defaultAmount: 500,
  });

  const template = await createTemplate(actors.admin, {
    name: "AP-8 Reminder",
    body: "Hello {patientName}, your {serviceName} with {doctorName} at {clinicName} is on {appointmentDate} at {appointmentTime}.",
    footer: "",
    mediaType: "",
    mediaUrl: "",
  });

  const rivalTemplate = await createTemplate(actors.rival, {
    name: "AP-8 Rival Reminder",
    body: "Hello {patientName}.",
    footer: "",
    mediaType: "",
    mediaUrl: "",
  });

  // An existing patient, so a booking can carry a patient record from the start.
  const patient = await prisma.patient.create({
    data: {
      tenantId: tenant.id,
      clinicId: clinic.id,
      patientCode: `PT-AP8-${stamp}`,
      name: PATIENT_NAME,
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
    siblingDoctor,
    service,
    siblingService,
    template,
    rivalTemplate,
    patient,
    actors,
  };
}

type Fixture = Awaited<ReturnType<typeof build>>;

/** Books one appointment. `withPatient` decides whether it has a patient record. */
async function book(
  f: Fixture,
  time: string,
  options: {
    withPatient?: boolean;
    day?: string;
    actor?: ActorContext;
    clinicId?: string;
    doctorId?: string;
    typeId?: string;
  } = {},
): Promise<string> {
  const day = options.day ?? DAY;
  const end = `${String(Number(time.slice(0, 2)) + (time.slice(3) === "30" ? 1 : 0)).padStart(2, "0")}:${time.slice(3) === "30" ? "00" : "30"}`;

  const created = await createAppointment(options.actor ?? f.actors.reception, {
    clinicId: options.clinicId ?? f.clinic.id,
    doctorId: options.doctorId ?? f.doctor.id,
    appointmentTypeId: options.typeId ?? f.service.id,
    patientId: options.withPatient ? f.patient.id : null,
    name: PATIENT_NAME,
    ...PII,
    slotStart: iso(day, time),
    slotEnd: iso(day, end),
  });

  return created.id;
}

async function notificationsFor(
  tenantId: string,
  appointmentId: string,
): Promise<{ type: string; message: string; clinicId: string | null }[]> {
  return prisma.notification.findMany({
    where: { tenantId, relatedRecordId: appointmentId },
    orderBy: { createdAt: "asc" },
    select: { type: true, message: true, clinicId: true },
  });
}

/**
 * The column checkFeedNeverFailsTheAction adds to make a notification insert
 * fail. Named so a leftover is obviously this script's.
 *
 * A NOT NULL column with NO DEFAULT is the least invasive way to do this on
 * MySQL. Adding it backfills the rows that already exist with an implicit zero
 * and revalidates nothing, but an INSERT that does not name the column — which
 * is every insert Prisma issues, since the column is not in the schema — fails
 * under strict mode. Two alternatives were tried and rejected: narrowing
 * `message` has to revalidate every existing row and fails on real data, and a
 * BEFORE INSERT trigger cannot be created over MySQL's prepared-statement
 * protocol, which is the only one Prisma speaks.
 */
const BLOCK_COLUMN = "ap8_verify_block";

async function blockColumnExists(): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) AS n
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'notifications'
      AND column_name = ${BLOCK_COLUMN}
  `;
  return Number(rows[0]?.n ?? 0) > 0;
}

/** MySQL 8 has no DROP COLUMN IF EXISTS, hence the lookup first. */
async function dropBlockingColumn(): Promise<void> {
  if (await blockColumnExists()) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE notifications DROP COLUMN ${BLOCK_COLUMN}`,
    );
  }
}

async function purgeTenant(tenantId: string): Promise<void> {
  await prisma.whatsappMessage.deleteMany({
    where: { clinic: { tenantId } },
  });
  await prisma.whatsappTemplate.deleteMany({ where: { tenantId } });
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
  // A previous run killed mid-test could have left this behind, and while it
  // exists NOTHING in the application can write a notification.
  await dropBlockingColumn();

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
// 1 + 2. The four events, and the two deliberate silences
// ---------------------------------------------------------------------------

async function checkFeedFills(f: Fixture): Promise<void> {
  console.log("\nEvery appointment event an Admin reviews raises a feed item");

  const booked = await book(f, "09:00");
  const afterBooking = await notificationsFor(f.tenant.id, booked);
  check(
    "booking raises exactly one appointment.created",
    afterBooking.length === 1 && afterBooking[0].type === "appointment.created",
    afterBooking,
  );
  check(
    "naming the patient, the doctor, the clinic and the slot",
    afterBooking[0]?.message.includes(PATIENT_NAME) === true &&
      afterBooking[0]?.message.includes("AP-8 Dr Alpha") === true &&
      afterBooking[0]?.message.includes("AP-8 Alpha") === true &&
      afterBooking[0]?.message.includes(`${DAY} at 09:00`) === true,
    afterBooking[0]?.message,
  );
  check(
    "and filed against the clinic it was booked at",
    afterBooking[0]?.clinicId === f.clinic.id,
  );

  // Cancelling, with a reason the feed should carry.
  const cancelled = await book(f, "09:30");
  await cancelAppointment(f.actors.reception, cancelled, {
    reason: "Patient rang, unwell",
  });
  const afterCancel = await notificationsFor(f.tenant.id, cancelled);
  check(
    "cancelling adds an appointment.cancelled beside the booking",
    afterCancel.map((row) => row.type).join(",") ===
      "appointment.created,appointment.cancelled",
    afterCancel.map((row) => row.type),
  );
  check(
    "and repeats the reason the desk gave",
    afterCancel[1]?.message.includes("Patient rang, unwell") === true,
    afterCancel[1]?.message,
  );

  // No-show.
  const missed = await book(f, "10:00");
  await markAppointmentNoShow(f.actors.reception, missed, {});
  const afterNoShow = await notificationsFor(f.tenant.id, missed);
  check(
    "marking a no-show adds an appointment.no_show",
    afterNoShow.some((row) => row.type === "appointment.no_show"),
    afterNoShow.map((row) => row.type),
  );

  // Rescheduling — the item must point at the REPLACEMENT.
  const moved = await book(f, "10:30");
  const result = await rescheduleAppointment(f.actors.reception, moved, {
    slotStart: iso(OTHER_DAY, "11:00"),
    slotEnd: iso(OTHER_DAY, "11:30"),
  });
  const onOriginal = await notificationsFor(f.tenant.id, moved);
  const onReplacement = await notificationsFor(f.tenant.id, result.appointment.id);
  check(
    "moving an appointment files the item against the NEW slot",
    onReplacement.some((row) => row.type === "appointment.rescheduled"),
    onReplacement.map((row) => row.type),
  );
  check(
    "not against the slot it left",
    onOriginal.every((row) => row.type !== "appointment.rescheduled"),
    onOriginal.map((row) => row.type),
  );
  const movedMessage = onReplacement.find(
    (row) => row.type === "appointment.rescheduled",
  )?.message;
  check(
    "and names both the old slot and the new one",
    movedMessage?.includes(`${DAY} at 10:30`) === true &&
      movedMessage?.includes(`${OTHER_DAY} at 11:00`) === true,
    movedMessage,
  );

  // 2. The two deliberate silences.
  const arriving = await book(f, "11:00");
  await checkInAppointment(f.actors.reception, arriving);
  const afterCheckIn = await notificationsFor(f.tenant.id, arriving);
  check(
    "checking a patient in raises NOTHING — it would bury the rest",
    afterCheckIn.map((row) => row.type).join(",") === "appointment.created",
    afterCheckIn.map((row) => row.type),
  );

  await convertAppointmentToRegistration(f.actors.reception, arriving);
  const afterConvert = await notificationsFor(f.tenant.id, arriving);
  check(
    "converting raises no second appointment item",
    afterConvert.map((row) => row.type).join(",") === "appointment.created",
    afterConvert.map((row) => row.type),
  );
  const registrationItems = await prisma.notification.count({
    where: { tenantId: f.tenant.id, type: "registration.created" },
  });
  check(
    "because AP-5 already raises registration.created for it",
    registrationItems === 1,
    registrationItems,
  );
}

// ---------------------------------------------------------------------------
// 3. A feed row can never fail the action that caused it
// ---------------------------------------------------------------------------

async function checkFeedNeverFailsTheAction(f: Fixture): Promise<void> {
  console.log("\nA notification that cannot be written still lets the work commit");

  const doomed = await book(f, "12:00");

  // Force the notification insert to fail for real — see BLOCK_COLUMN for why
  // it is done this way. Dropped in the `finally`, and swept at startup in
  // case a previous run died holding it.
  await dropBlockingColumn();
  await prisma.$executeRawUnsafe(
    `ALTER TABLE notifications ADD COLUMN ${BLOCK_COLUMN} INT NOT NULL`,
  );

  let cancelledCleanly = true;
  try {
    await cancelAppointment(f.actors.reception, doomed, { reason: "still works" });
  } catch {
    cancelledCleanly = false;
  } finally {
    await dropBlockingColumn();
  }

  check(
    "cancelling succeeds even though its notification could not be written",
    cancelledCleanly,
  );

  const row = await prisma.appointment.findUniqueOrThrow({
    where: { id: doomed },
    select: { status: true, cancellationReason: true },
  });
  check(
    "and the cancellation is committed, reason and all",
    row.status === "CANCELLED" && row.cancellationReason === "still works",
    row,
  );

  const audit = await prisma.auditLog.count({
    where: { targetType: "Appointment", targetId: doomed },
  });
  check(
    "with its audit row intact — that one IS inside the transaction",
    audit >= 1,
    audit,
  );

  const feed = await notificationsFor(f.tenant.id, doomed);
  check(
    "and no cancellation item, which is the trade being made",
    feed.every((row) => row.type !== "appointment.cancelled"),
    feed.map((row) => row.type),
  );
}

// ---------------------------------------------------------------------------
// 4 + 5. Scope, and what the messages may contain
// ---------------------------------------------------------------------------

async function checkScopeAndDisclosure(f: Fixture): Promise<void> {
  console.log("\nThe feed is scoped, and says no more than it needs to");

  await book(f, "09:00", {
    day: OTHER_DAY,
    clinicId: f.sibling.id,
    doctorId: f.siblingDoctor.id,
    typeId: f.siblingService.id,
    actor: f.actors.admin,
  });

  const rivalFeed = await listNotificationsForActor(f.actors.rival, {});
  check(
    "a neighbouring organisation sees none of these",
    rivalFeed.items.every((item) => !item.message.includes(PATIENT_NAME)),
    rivalFeed.items.map((item) => item.message),
  );

  const siblingFeed = await listNotificationsForActor(f.actors.sibling, {});
  check(
    "an admin scoped to one clinic sees only that clinic's items",
    siblingFeed.items.length > 0 &&
      siblingFeed.items.every((item) => item.clinicId === f.sibling.id),
    siblingFeed.items.map((item) => item.clinicId),
  );

  const adminFeed = await listNotificationsForActor(f.actors.admin, {});
  const appointmentItems = adminFeed.items.filter((item) =>
    item.type.startsWith("appointment."),
  );
  check(
    "an account-wide admin sees both clinics'",
    new Set(appointmentItems.map((item) => item.clinicId)).size === 2,
    appointmentItems.map((item) => item.clinicId),
  );

  check(
    "every appointment item deep-links to the appointment",
    appointmentItems.every((item) => item.href?.startsWith("/appointments/")),
    appointmentItems.map((item) => item.href),
  );
  check(
    "and carries a plain-language label, never the raw type",
    appointmentItems.every(
      (item) => item.typeLabel !== item.type && !/[._]/.test(item.typeLabel),
    ),
    appointmentItems.map((item) => item.typeLabel),
  );

  // 5. The name is the only thing about the patient that belongs in a feed
  // read across a whole account.
  const serialised = JSON.stringify(appointmentItems);
  for (const [field, value] of Object.entries(PII)) {
    check(
      `no ${field} reached any notification`,
      !serialised.includes(String(value)),
    );
  }
}

// ---------------------------------------------------------------------------
// 6 + 7. Who may remind, and which appointments can be
// ---------------------------------------------------------------------------

async function checkReminderAuthorisation(f: Fixture): Promise<void> {
  console.log("\nReminding answers to message:send, at the appointment's clinic");

  const target = await book(f, "13:00", { withPatient: true });

  await expectThrows(
    "a role that runs the whole appointment desk but cannot message is refused",
    isPermissionError,
    () =>
      sendAppointmentReminder(f.actors.noMessage, target, {
        templateId: f.template.id,
      }),
  );

  await expectThrows(
    "the appointments module gate refuses before the permission",
    isFeatureError,
    () =>
      sendAppointmentReminder(f.actors.noModule, target, {
        templateId: f.template.id,
      }),
  );

  await expectThrows(
    "a neighbouring organisation cannot reach the appointment at all",
    isScopeError,
    () =>
      sendAppointmentReminder(f.actors.rival, target, {
        templateId: f.rivalTemplate.id,
      }),
  );

  await expectThrows(
    "and another organisation's template cannot be borrowed",
    isScopeError,
    () =>
      sendAppointmentReminder(f.actors.reception, target, {
        templateId: f.rivalTemplate.id,
      }),
  );

  console.log("\nOnly a slot still ahead of the patient can be reminded");

  const noPatient = await book(f, "13:30");
  await expectThrows(
    "a booking with no patient record is refused, with the reason why",
    (error) =>
      isBadRequestError(error) && (error as Error).message === NO_PATIENT_MESSAGE,
    () =>
      sendAppointmentReminder(f.actors.reception, noPatient, {
        templateId: f.template.id,
      }),
  );

  const arrived = await book(f, "14:00", { withPatient: true });
  await checkInAppointment(f.actors.reception, arrived);
  await expectThrows(
    "a patient already in the waiting room is not reminded",
    isBadRequestError,
    () =>
      sendAppointmentReminder(f.actors.reception, arrived, {
        templateId: f.template.id,
      }),
  );

  const gone = await book(f, "14:30", { withPatient: true });
  await cancelAppointment(f.actors.reception, gone, {});
  await expectThrows(
    "nor is a cancelled appointment",
    isBadRequestError,
    () =>
      sendAppointmentReminder(f.actors.reception, gone, {
        templateId: f.template.id,
      }),
  );
}

// ---------------------------------------------------------------------------
// 8. A reminder that goes out is recorded like any other message
// ---------------------------------------------------------------------------

async function checkReminderRecorded(f: Fixture): Promise<void> {
  console.log("\nA reminder is recorded against the patient, and never sent here");

  const target = await book(f, "15:00", { withPatient: true });

  const before = await prisma.whatsappMessage.count();
  const result = await sendAppointmentReminder(f.actors.reception, target, {
    templateId: f.template.id,
  });
  const after = await prisma.whatsappMessage.count();

  check("exactly one history row is written", after === before + 1, {
    before,
    after,
  });

  // The interlock. SAFE_UNSENDABLE_NUMBER is refused by deliverTemplate's own
  // length check, BEFORE the gateway or the is-on-WhatsApp call — so this
  // failure is proof no network request was made, not a disappointment.
  check(
    "and it failed locally, proving the gateway was never called",
    result.status === "failed" &&
      result.failureReason?.includes("not a valid WhatsApp number") === true,
    result,
  );

  const row = await prisma.whatsappMessage.findFirstOrThrow({
    where: { clinicId: f.clinic.id },
    orderBy: { sentAt: "desc" },
    select: {
      patientId: true,
      clinicId: true,
      templateName: true,
      status: true,
      failureReason: true,
    },
  });

  check(
    "filed against the patient the appointment names",
    row.patientId === f.patient.id,
    row,
  );
  check("and against that patient's clinic", row.clinicId === f.clinic.id);
  check(
    "with the template NAME denormalised, so history survives a rename",
    row.templateName === "AP-8 Reminder",
    row.templateName,
  );
  check("and the failure recorded, not swallowed", row.status === "failed");

  // The preview the desk was shown is the substitution that actually ran.
  check(
    "the confirmation echoes the real rendering, with the APPOINTMENT's date",
    result.preview.includes(`is on ${DAY} at 15:00`) &&
      result.preview.includes(PATIENT_NAME) &&
      result.preview.includes("AP-8 Consultation"),
    result.preview,
  );
  check(
    "and leaves no placeholder unsubstituted",
    !/\{[a-zA-Z]+\}/.test(result.preview),
    result.preview,
  );

  // A reminder is not a lifecycle event.
  const appointment = await prisma.appointment.findUniqueOrThrow({
    where: { id: target },
    select: { status: true },
  });
  check(
    "and the appointment's own status is untouched by being reminded",
    appointment.status === "SCHEDULED",
    appointment.status,
  );
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("AP-8 — appointment notifications and reminders\n");

  await sweepLeftovers();

  const before = await countEverything();
  let fixture: Fixture | null = null;

  try {
    fixture = await build();

    await checkFeedFills(fixture);
    await checkFeedNeverFailsTheAction(fixture);
    await checkScopeAndDisclosure(fixture);
    await checkReminderAuthorisation(fixture);
    await checkReminderRecorded(fixture);
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
