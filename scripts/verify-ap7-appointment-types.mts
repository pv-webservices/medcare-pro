/**
 * AP-7 verification — the price list screen, against a LOCAL database.
 *
 *     npm run verify:ap7-appointment-types
 *
 * AP-7 adds no API, no domain mutation and no schema change: the appointment
 * type endpoints have existed since AP-3. What it adds is a SCREEN, and a
 * screen makes claims about the server that a component test cannot check.
 * tests/unit/appointmentTypeView.test.ts already covers the wording and the
 * arithmetic. This script exists for the seven claims underneath it:
 *
 *   1. THE ROW-LEVEL PERMISSION THE PAGE COMPUTES IS THE ONE THE SERVER
 *      ENFORCES. /appointments/types decides per row whether to draw Edit and
 *      Retire, by asking `can(actor, "appointment:type:manage", clinicId)` —
 *      tenant-wide for a shared service, that clinic for a clinic's own. If
 *      that prediction and `updateAppointmentType`'s own refusal ever
 *      disagree, the screen offers a button that 403s, or hides one that would
 *      have worked. Every scope pairing is asserted BOTH ways here.
 *   2. THE ADD FORM OFFERS ONLY CLINICS THE SERVER WILL ACCEPT — the same
 *      prediction, for creation rather than editing, including the tenant-wide
 *      option that a clinic-scoped admin must not be given.
 *   3. READ-ONLY IS REAL. A role with `appointment:read` and nothing else can
 *      list the price list and change none of it — and `includeInactive` is
 *      ignored for them, so "Show retired" cannot be forged by typing
 *      ?retired=true.
 *   4. RETIRING IS NOT COSMETIC. The button's whole promise is that a retired
 *      service stops being bookable. That is a claim about
 *      lib/appointments.ts, not about the list.
 *   5. RE-PRICING DOES NOT MOVE MONEY ALREADY QUOTED. The form says so in a
 *      hint; an appointment booked before the change must keep its amount.
 *   6. THE FEATURE GATE COMES FIRST, as everywhere else in this module.
 *   7. THE AUDIT TRAIL SEPARATES RENAMED FROM RETIRED, and carries no patient
 *      data — a price list is configuration, and must stay that way in the log.
 *
 * Everything it creates lives under tenants named `verify-ap7-types` and is torn
 * down at the end. Row counts on every pre-existing table are asserted before
 * and after, so a bug here that touched real data would be visible.
 *
 * Refuses to run unless DATABASE_URL points at localhost.
 */

import { prisma } from "@/lib/prisma";
import { ConflictError } from "@/lib/apiHandler";
import { createAppointment } from "@/lib/appointments";
import {
  createAppointmentType,
  listAppointmentTypes,
  updateAppointmentType,
} from "@/lib/appointmentTypes";
import { AUDIT_ACTIONS } from "@/lib/audit";
import { describeAuditAction } from "@/lib/auditDescriptions";
import { DEFAULT_PLAN_KEY, seedFeatureCatalogue } from "@/lib/defaultFeatures";
import { ROLE_KEYS, seedDefaultRoles } from "@/lib/defaultRoles";
import { FeatureError } from "@/lib/featureResolution";
import { can, PermissionError, ScopeError, type ActorContext } from "@/lib/rbac";

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
const isFeatureError = (error: unknown): boolean => error instanceof FeatureError;

const TEST_TENANT_NAME = "verify-ap7-types";

/** The working day the one booking in this script sits on. */
const DAY = "2027-03-15";

const iso = (day: string, time: string): string => `${day}T${time}:00.000Z`;
const dayOnly = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

/** Distinctive enough that finding any of it in an audit row is unambiguous. */
const PII = {
  name: "Zzyzx Ap7 Patient",
  mobileNumber: "9876500077",
  address: "77 Disclosure Drive",
  city: "Leakstown",
  gender: "female",
  age: 918277,
};

const QUOTED_AMOUNT = 600;
const REPRICED_AMOUNT = 1450;

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

  const clinic = await makeClinic(tenant.id, "AP-7 Alpha");
  const sibling = await makeClinic(tenant.id, "AP-7 Beta");
  const rivalClinic = await makeClinic(rival.id, "AP-7 Rival");

  const doctor = await prisma.doctor.create({
    data: { clinicId: clinic.id, name: "AP-7 Dr Alpha", department: "AP-7 ENT" },
    select: { id: true },
  });

  await prisma.doctorAvailability.create({
    data: {
      doctorId: doctor.id,
      date: dayOnly(DAY),
      startTime: "09:00",
      endTime: "17:00",
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
  const rivalAdminRoleId = await roleId(rival.id, ROLE_KEYS.CLINIC_ADMIN);

  // Holds the manage permission but has NO layer-3 row, so the module denies
  // before the permission is ever consulted.
  const unentitledRole = await prisma.role.create({
    data: {
      tenantId: tenant.id,
      name: "AP-7 Admin, module off",
      permissions: ["appointment:read", "appointment:type:manage"],
      isSystem: false,
    },
    select: { id: true },
  });

  // `appointments` is PREMIUM, so an ABSENT RoleFeatureAccess row DENIES.
  for (const id of [adminRoleId, receptionRoleId, rivalAdminRoleId]) {
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
  const alphaAdminUser = await makeUser("alpha-admin", tenant.id);
  const receptionUser = await makeUser("reception", tenant.id);
  const noModuleUser = await makeUser("nomodule", tenant.id);
  const rivalUser = await makeUser("rival", rival.id);

  const assign = (userId: string, roleId: string, clinicId: string | null) =>
    prisma.userRole.create({ data: { userId, roleId, clinicId } });

  await assign(adminUser.id, adminRoleId, null);
  // Clinic-scoped to Alpha ONLY — the subject of every per-row assertion.
  await assign(alphaAdminUser.id, adminRoleId, clinic.id);
  await assign(receptionUser.id, receptionRoleId, null);
  await assign(noModuleUser.id, unentitledRole.id, null);
  await assign(rivalUser.id, rivalAdminRoleId, null);

  const actor = (userId: string, tenantId: string): ActorContext => ({
    userId,
    tenantId,
  });

  return {
    stamp,
    tenant,
    rival,
    clinic,
    sibling,
    rivalClinic,
    doctor,
    actors: {
      admin: actor(adminUser.id, tenant.id),
      alphaAdmin: actor(alphaAdminUser.id, tenant.id),
      reception: actor(receptionUser.id, tenant.id),
      noModule: actor(noModuleUser.id, tenant.id),
      rival: actor(rivalUser.id, rival.id),
    },
  };
}

type Fixture = Awaited<ReturnType<typeof build>>;

async function purgeTenant(tenantId: string): Promise<void> {
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
// 1 + 2. The prediction the screen makes, against the refusal the server gives
// ---------------------------------------------------------------------------

/**
 * The exact expression /appointments/types uses to decide whether a row gets
 * its buttons. Restated here rather than imported, because the point is to
 * prove that this RULE matches the server — importing the page's own helper
 * would make the two agree by construction and test nothing.
 */
function predictRowIsEditable(
  serviceClinicId: string | null,
  manageableClinicIds: Set<string>,
  canScopeTenantWide: boolean,
): boolean {
  return serviceClinicId
    ? manageableClinicIds.has(serviceClinicId)
    : canScopeTenantWide;
}

async function checkRowPermissions(f: Fixture): Promise<void> {
  console.log("\nThe buttons the screen draws are the ones the server honours");

  const shared = await createAppointmentType(f.actors.admin, {
    clinicId: null,
    name: "AP-7 Shared Consultation",
    durationMinutes: 30,
    defaultAmount: 400,
  });
  const alphaOwn = await createAppointmentType(f.actors.admin, {
    clinicId: f.clinic.id,
    name: "AP-7 Alpha Scan",
    durationMinutes: 45,
    defaultAmount: 900,
  });
  const betaOwn = await createAppointmentType(f.actors.admin, {
    clinicId: f.sibling.id,
    name: "AP-7 Beta Scan",
    durationMinutes: 45,
    defaultAmount: 900,
  });

  const cases = [
    {
      who: "the account-wide admin",
      actor: f.actors.admin,
      clinics: [f.clinic.id, f.sibling.id],
    },
    {
      who: "an admin scoped to Alpha only",
      actor: f.actors.alphaAdmin,
      clinics: [f.clinic.id, f.sibling.id],
    },
  ];

  for (const subject of cases) {
    // Exactly what the page resolves before rendering.
    const canScopeTenantWide = await can(
      subject.actor,
      "appointment:type:manage",
    );
    const manageableClinicIds = new Set<string>();
    for (const clinicId of subject.clinics) {
      if (await can(subject.actor, "appointment:type:manage", clinicId)) {
        manageableClinicIds.add(clinicId);
      }
    }

    for (const service of [
      { label: "the shared service", row: shared },
      { label: "Alpha's own service", row: alphaOwn },
      { label: "Beta's service", row: betaOwn },
    ]) {
      const predicted = predictRowIsEditable(
        service.row.clinicId,
        manageableClinicIds,
        canScopeTenantWide,
      );

      // The server's answer, obtained by actually attempting the edit the
      // button would have performed.
      let allowed: boolean;
      try {
        await updateAppointmentType(subject.actor, service.row.id, {
          durationMinutes: service.row.durationMinutes,
        });
        allowed = true;
      } catch (error: unknown) {
        if (!(error instanceof PermissionError) && !(error instanceof ScopeError)) {
          throw error;
        }
        allowed = false;
      }

      check(
        `${subject.who}: the screen and the server agree on ${service.label} (${predicted ? "editable" : "read-only"})`,
        predicted === allowed,
        { predicted, allowed },
      );
    }
  }

  // 2. The Add form's clinic list, same prediction for creation.
  const alphaCanTenantWide = await can(
    f.actors.alphaAdmin,
    "appointment:type:manage",
  );
  check(
    "a clinic-scoped admin is not offered the All clinics option",
    alphaCanTenantWide === false,
  );
  await expectThrows(
    "and is refused if they send it anyway",
    isPermissionError,
    () =>
      createAppointmentType(f.actors.alphaAdmin, {
        clinicId: null,
        name: "AP-7 Smuggled Account-wide",
        durationMinutes: 30,
        defaultAmount: 100,
      }),
  );
  // WHICH REFUSAL COMES BACK, AND WHY IT IS TWO DIFFERENT ONES.
  // `requirePermission` checks tenant membership before the permission (see
  // lib/rbac.ts), so the order decides the code:
  //
  //   a sibling clinic, inside the tenant  → 403, the permission refusing
  //   an id matching nothing               → 404, the tenant check refusing
  //   another organisation's clinic        → 404, likewise
  //
  // The tenant boundary is therefore never crossed by either answer. What the
  // pair does distinguish, for someone already inside the organisation, is a
  // clinic id that exists in it from one that does not — no name, no data, and
  // the behaviour of `requirePermission` itself since AP-1, which every module
  // shares. Pinned here rather than changed: AP-7 adds no API and is not the
  // stage to alter a refusal code every route depends on.
  await expectThrows(
    "and cannot add a service to a clinic the form would not list",
    isPermissionError,
    () =>
      createAppointmentType(f.actors.alphaAdmin, {
        clinicId: f.sibling.id,
        name: "AP-7 Smuggled Beta",
        durationMinutes: 30,
        defaultAmount: 100,
      }),
  );

  await expectThrows(
    "and a clinic id matching nothing is refused by the tenant check first",
    isScopeError,
    () =>
      createAppointmentType(f.actors.alphaAdmin, {
        clinicId: `${f.sibling.id}-nonexistent`,
        name: "AP-7 Smuggled Nowhere",
        durationMinutes: 30,
        defaultAmount: 100,
      }),
  );

  await expectThrows(
    "while an account-wide admin meets a 404 for another organisation's clinic",
    isScopeError,
    () =>
      createAppointmentType(f.actors.admin, {
        clinicId: f.rivalClinic.id,
        name: "AP-7 Smuggled Cross Tenant",
        durationMinutes: 30,
        defaultAmount: 100,
      }),
  );

  const alphaMade = await createAppointmentType(f.actors.alphaAdmin, {
    clinicId: f.clinic.id,
    name: "AP-7 Alpha Physio",
    durationMinutes: 20,
    defaultAmount: 350,
  });
  check(
    "but can add one to the clinic the form does list",
    alphaMade.clinicId === f.clinic.id,
    alphaMade,
  );

  // The duplicate check the form surfaces verbatim. Normalised, so a differently
  // cased name is the same name.
  await expectThrows(
    "a name that differs only by case and spacing is refused as a duplicate",
    isConflictError,
    () =>
      createAppointmentType(f.actors.admin, {
        clinicId: null,
        name: "  ap-7   shared   consultation  ",
        durationMinutes: 30,
        defaultAmount: 400,
      }),
  );

  // Cross-tenant: the neighbour cannot see or touch any of it.
  const rivalSees = await listAppointmentTypes(f.actors.rival, {});
  check(
    "the neighbouring organisation sees none of these services",
    rivalSees.every((row) => !row.name.startsWith("AP-7")),
    rivalSees.map((row) => row.name),
  );
  await expectThrows(
    "and cannot edit one by id",
    isScopeError,
    () =>
      updateAppointmentType(f.actors.rival, shared.id, { defaultAmount: 1 }),
  );
}

// ---------------------------------------------------------------------------
// 3. Read-only is real
// ---------------------------------------------------------------------------

async function checkReadOnly(f: Fixture): Promise<void> {
  console.log("\nA role that may read the price list may not change it");

  const visible = await listAppointmentTypes(f.actors.reception, {});
  check(
    "the front desk can read the services it books against",
    visible.length > 0,
    visible.length,
  );

  await expectThrows(
    "but cannot add one",
    isPermissionError,
    () =>
      createAppointmentType(f.actors.reception, {
        clinicId: f.clinic.id,
        name: "AP-7 Desk Invention",
        durationMinutes: 30,
        defaultAmount: 100,
      }),
  );

  const anyService = visible[0];
  await expectThrows(
    "and cannot re-price one",
    isPermissionError,
    () =>
      updateAppointmentType(f.actors.reception, anyService.id, {
        defaultAmount: 1,
      }),
  );

  // Retire something, then prove ?retired=true cannot be forged.
  const doomed = await createAppointmentType(f.actors.admin, {
    clinicId: f.clinic.id,
    name: "AP-7 Withdrawn Service",
    durationMinutes: 15,
    defaultAmount: 250,
  });
  await updateAppointmentType(f.actors.admin, doomed.id, { isActive: false });

  const deskAsking = await listAppointmentTypes(f.actors.reception, {
    includeInactive: true,
  });
  check(
    "'Show retired' cannot be forged by a role that cannot manage types",
    deskAsking.every((row) => row.id !== doomed.id),
    deskAsking.map((row) => row.name),
  );
  check(
    "and every row it does return is bookable",
    deskAsking.every((row) => row.isActive),
  );

  const adminAsking = await listAppointmentTypes(f.actors.admin, {
    includeInactive: true,
  });
  check(
    "while an admin asking the same question sees the retired one",
    adminAsking.some((row) => row.id === doomed.id),
  );

  const adminDefault = await listAppointmentTypes(f.actors.admin, {});
  check(
    "and does not see it without asking",
    adminDefault.every((row) => row.id !== doomed.id),
  );
}

// ---------------------------------------------------------------------------
// 4 + 5. Retiring bites, and re-pricing does not reach backwards
// ---------------------------------------------------------------------------

async function checkRetireAndReprice(f: Fixture): Promise<void> {
  console.log("\nRetiring stops bookings; re-pricing leaves quoted money alone");

  const service = await createAppointmentType(f.actors.admin, {
    clinicId: f.clinic.id,
    name: "AP-7 Priced Consultation",
    durationMinutes: 30,
    defaultAmount: QUOTED_AMOUNT,
  });

  const booking = await createAppointment(f.actors.reception, {
    clinicId: f.clinic.id,
    doctorId: f.doctor.id,
    appointmentTypeId: service.id,
    patientId: null,
    ...PII,
    slotStart: iso(DAY, "09:00"),
    slotEnd: iso(DAY, "09:30"),
  });

  // 5. The hint on the form says this in so many words.
  await updateAppointmentType(f.actors.admin, service.id, {
    defaultAmount: REPRICED_AMOUNT,
  });

  const afterReprice = await prisma.appointment.findUniqueOrThrow({
    where: { id: booking.id },
    select: { amount: true },
  });
  check(
    "an appointment already booked keeps the price it was quoted",
    afterReprice.amount.toFixed(2) === QUOTED_AMOUNT.toFixed(2),
    { quoted: QUOTED_AMOUNT, now: afterReprice.amount.toFixed(2) },
  );

  // 4. The Retire button's entire promise.
  await updateAppointmentType(f.actors.admin, service.id, { isActive: false });

  await expectThrows(
    "a retired service cannot be booked, not merely hidden from the list",
    isScopeError,
    () =>
      createAppointment(f.actors.reception, {
        clinicId: f.clinic.id,
        doctorId: f.doctor.id,
        appointmentTypeId: service.id,
        patientId: null,
        ...PII,
        slotStart: iso(DAY, "11:00"),
        slotEnd: iso(DAY, "11:30"),
      }),
  );

  const stillThere = await prisma.appointment.findUniqueOrThrow({
    where: { id: booking.id },
    select: { id: true, appointmentTypeId: true },
  });
  check(
    "and the appointment booked with it before is untouched",
    stillThere.appointmentTypeId === service.id,
    stillThere,
  );

  // Restore, and it works again.
  await updateAppointmentType(f.actors.admin, service.id, { isActive: true });
  const rebooked = await createAppointment(f.actors.reception, {
    clinicId: f.clinic.id,
    doctorId: f.doctor.id,
    appointmentTypeId: service.id,
    patientId: null,
    ...PII,
    slotStart: iso(DAY, "11:00"),
    slotEnd: iso(DAY, "11:30"),
  });
  check("restoring a service makes it bookable again", Boolean(rebooked.id));
  check(
    "and a booking made after the change takes the NEW price",
    rebooked.amount === REPRICED_AMOUNT.toFixed(2),
    rebooked.amount,
  );

  // A scope change that would strand booked appointments is refused — the
  // message the edit form shows verbatim.
  await expectThrows(
    "a shared service that has been booked cannot be narrowed onto one clinic",
    isConflictError,
    async () => {
      const sharedBooked = await createAppointmentType(f.actors.admin, {
        clinicId: null,
        name: "AP-7 Shared And Booked",
        durationMinutes: 30,
        defaultAmount: 300,
      });
      await createAppointment(f.actors.reception, {
        clinicId: f.clinic.id,
        doctorId: f.doctor.id,
        appointmentTypeId: sharedBooked.id,
        patientId: null,
        ...PII,
        slotStart: iso(DAY, "13:00"),
        slotEnd: iso(DAY, "13:30"),
      });
      return updateAppointmentType(f.actors.admin, sharedBooked.id, {
        clinicId: f.sibling.id,
      });
    },
  );
}

// ---------------------------------------------------------------------------
// 6. The feature gate
// ---------------------------------------------------------------------------

async function checkFeatureGate(f: Fixture): Promise<void> {
  console.log("\nThe module gate refuses before the permission is consulted");

  await expectThrows(
    "a role holding appointment:type:manage without the module cannot list",
    isFeatureError,
    () => listAppointmentTypes(f.actors.noModule, {}),
  );
  await expectThrows(
    "nor create",
    isFeatureError,
    () =>
      createAppointmentType(f.actors.noModule, {
        clinicId: f.clinic.id,
        name: "AP-7 Unentitled",
        durationMinutes: 30,
        defaultAmount: 100,
      }),
  );
}

// ---------------------------------------------------------------------------
// 7. The audit trail
// ---------------------------------------------------------------------------

async function checkAudit(f: Fixture): Promise<void> {
  console.log("\nThe log tells renamed from retired, and holds no patient data");

  const service = await createAppointmentType(f.actors.admin, {
    clinicId: f.clinic.id,
    name: "AP-7 Audited Service",
    durationMinutes: 30,
    defaultAmount: 500,
  });

  await updateAppointmentType(f.actors.admin, service.id, {
    name: "AP-7 Audited Service Renamed",
  });
  await updateAppointmentType(f.actors.admin, service.id, { isActive: false });
  await updateAppointmentType(f.actors.admin, service.id, { isActive: true });

  const rows = await prisma.auditLog.findMany({
    where: { targetType: "AppointmentType", targetId: service.id },
    orderBy: { createdAt: "asc" },
    select: { action: true, afterValue: true, beforeValue: true },
  });

  const actions = rows.map((row) => row.action);
  check(
    "creating, renaming, retiring and restoring are four separate actions",
    actions.join(",") ===
      [
        AUDIT_ACTIONS.APPOINTMENT_TYPE_CREATED,
        AUDIT_ACTIONS.APPOINTMENT_TYPE_UPDATED,
        AUDIT_ACTIONS.APPOINTMENT_TYPE_DEACTIVATED,
        AUDIT_ACTIONS.APPOINTMENT_TYPE_ACTIVATED,
      ].join(","),
    actions,
  );

  for (const action of new Set(actions)) {
    check(
      `${action} has a plain-language description on the activity log`,
      Boolean(describeAuditAction(action)),
    );
  }

  // A price list is configuration. Nothing a patient told the desk belongs in
  // it, and the appointment booked against this service is a separate record.
  const serialised = JSON.stringify(rows);
  for (const [field, value] of Object.entries(PII)) {
    check(
      `no ${field} from any patient reached these rows`,
      !serialised.includes(String(value)),
    );
  }

  const renamed = rows.find(
    (row) => row.action === AUDIT_ACTIONS.APPOINTMENT_TYPE_UPDATED,
  );
  check(
    "the rename records both the old name and the new one",
    JSON.stringify(renamed?.beforeValue).includes("AP-7 Audited Service") &&
      JSON.stringify(renamed?.afterValue).includes("Renamed"),
    renamed,
  );

  // Retiring must not be filed as a generic update — that is the distinction
  // the API route's comment promises a reader of the log.
  const retired = rows.find(
    (row) => row.action === AUDIT_ACTIONS.APPOINTMENT_TYPE_DEACTIVATED,
  );
  check(
    "retiring records only the flag that changed",
    JSON.stringify(retired?.afterValue) === JSON.stringify({ isActive: false }),
    retired?.afterValue,
  );
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("AP-7 — the bookable services screen\n");

  await sweepLeftovers();

  const before = await countEverything();
  let fixture: Fixture | null = null;

  try {
    fixture = await build();

    await checkRowPermissions(fixture);
    await checkReadOnly(fixture);
    await checkRetireAndReprice(fixture);
    await checkFeatureGate(fixture);
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
