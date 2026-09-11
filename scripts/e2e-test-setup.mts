import { PrismaClient, Prisma, AppointmentStatus, AppointmentBookingSource, TaskPriority, TaskStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import { seedDefaultRoles, ROLE_KEYS } from "../src/lib/defaultRoles";
import { doctorDefaultDashboardLayout, DASHBOARD_LAYOUT_VERSION } from "../src/lib/dashboardWidgets";
import {
  todayDateOnly,
  parseDateTime,
  tomorrowDateOnlyInTimeZone,
  parseDateOnly,
  formatDateOnly,
} from "../src/lib/dates";

const prisma = new PrismaClient();

const TEST_PASSWORD = "TestDoctor#2026!";
const TENANT_SLUG = "e2e-acceptance-tenant";

export async function setupE2ETestData() {
  console.log("Setting up E2E Acceptance Test Tenant & Entities...");
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 12);

  // 1. Create or get Tenant
  let tenant = await prisma.tenant.findFirst({
    where: { slug: TENANT_SLUG },
  });

  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: {
        businessName: "E2E Acceptance Medical Center",
        slug: TENANT_SLUG,
        status: "ACTIVE",
        email: "e2e-tenant@medcare.test",
        phone: "+919876543210",
        address: "100 Medical Lane",
        city: "New Delhi",
        emailVerifiedAt: new Date(),
        planId: "cmt7ovhf1000aw288iqtmazx9",
      },
    });
    console.log("Created Tenant:", tenant.id);
  } else {
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { planId: "cmt7ovhf1000aw288iqtmazx9" },
    });
    console.log("Using existing Tenant and assigned Standard plan:", tenant.id);
  }

  // Seed default roles for tenant
  await seedDefaultRoles(prisma, tenant.id);

  // 2. Create Clinics: Clinic A and Clinic B
  let clinicA = await prisma.clinic.findFirst({
    where: { tenantId: tenant.id, name: "E2E Clinic A" },
  });
  if (!clinicA) {
    clinicA = await prisma.clinic.create({
      data: {
        tenantId: tenant.id,
        name: "E2E Clinic A",
        city: "New Delhi",
        address: "Clinic A Building, Ground Floor",
      },
    });
    console.log("Created Clinic A:", clinicA.id);
  }

  let clinicB = await prisma.clinic.findFirst({
    where: { tenantId: tenant.id, name: "E2E Clinic B" },
  });
  if (!clinicB) {
    clinicB = await prisma.clinic.create({
      data: {
        tenantId: tenant.id,
        name: "E2E Clinic B",
        city: "Gurugram",
        address: "Clinic B Tower, Suite 400",
      },
    });
    console.log("Created Clinic B:", clinicB.id);
  }

  // 3. Ensure Appointment Types exist for Clinic A and Clinic B
  let consultationType = await prisma.appointmentType.findFirst({
    where: { tenantId: tenant.id, name: "Consultation" },
  });
  if (!consultationType) {
    consultationType = await prisma.appointmentType.create({
      data: {
        tenantId: tenant.id,
        name: "Consultation",
        durationMinutes: 30,
        defaultAmount: 500,
        isActive: true,
      },
    });
  }

  let followUpType = await prisma.appointmentType.findFirst({
    where: { tenantId: tenant.id, name: "Follow-up" },
  });
  if (!followUpType) {
    followUpType = await prisma.appointmentType.create({
      data: {
        tenantId: tenant.id,
        name: "Follow-up",
        durationMinutes: 30,
        defaultAmount: 300,
        isActive: true,
      },
    });
  }

  let reviewType = await prisma.appointmentType.findFirst({
    where: { tenantId: tenant.id, name: "Review" },
  });
  if (!reviewType) {
    reviewType = await prisma.appointmentType.create({
      data: {
        tenantId: tenant.id,
        name: "Review",
        durationMinutes: 30,
        defaultAmount: 200,
        isActive: true,
      },
    });
  }

  // 4. Fetch Roles
  const ownerRole = await prisma.role.findFirstOrThrow({
    where: { tenantId: tenant.id, key: ROLE_KEYS.OWNER },
  });
  const adminRole = await prisma.role.findFirstOrThrow({
    where: { tenantId: tenant.id, key: ROLE_KEYS.CLINIC_ADMIN },
  });
  const doctorRole = await prisma.role.findFirstOrThrow({
    where: { tenantId: tenant.id, key: ROLE_KEYS.DOCTOR },
  });
  const receptionistRole = await prisma.role.findFirstOrThrow({
    where: { tenantId: tenant.id, key: ROLE_KEYS.RECEPTIONIST },
  });

  // Ensure Doctor Role has appointment:self:read and NOT appointment:read
  const doctorPerms = (doctorRole.permissions as string[]).filter(p => p !== "appointment:read");
  if (!doctorPerms.includes("appointment:self:read")) {
    doctorPerms.push("appointment:self:read");
  }
  await prisma.role.update({
    where: { id: doctorRole.id },
    data: { permissions: doctorPerms },
  });

  // Ensure Admin Role has appointment:read and appointment:self:read
  const adminPerms = [...(adminRole.permissions as string[])];
  if (!adminPerms.includes("appointment:self:read")) {
    adminPerms.push("appointment:self:read");
  }
  await prisma.role.update({
    where: { id: adminRole.id },
    data: { permissions: adminPerms },
  });

  // Ensure Doctor Role has default dashboard layout
  await prisma.dashboardLayout.upsert({
    where: { tenantId_roleId: { tenantId: tenant.id, roleId: doctorRole.id } },
    create: {
      tenantId: tenant.id,
      roleId: doctorRole.id,
      version: DASHBOARD_LAYOUT_VERSION,
      layout: doctorDefaultDashboardLayout() as unknown as Prisma.InputJsonValue,
    },
    update: {
      layout: doctorDefaultDashboardLayout() as unknown as Prisma.InputJsonValue,
    },
  });

  // Enable Appointments feature for Doctor, Admin, Receptionist roles (PREMIUM tier requires explicit layer-3 grant)
  const apptFeature = await prisma.feature.findFirstOrThrow({ where: { key: "appointments" } });
  for (const r of [doctorRole, adminRole, receptionistRole]) {
    await prisma.roleFeatureAccess.upsert({
      where: { roleId_featureId: { roleId: r.id, featureId: apptFeature.id } },
      create: { roleId: r.id, featureId: apptFeature.id, enabled: true },
      update: { enabled: true },
    });
  }

  // Create custom "Create-Only Doctor Manager" Role (has doctor:create, doctor:read, NO doctor:edit)
  let createOnlyRole = await prisma.role.findFirst({
    where: { tenantId: tenant.id, name: "Doctor Creator" },
  });
  if (!createOnlyRole) {
    createOnlyRole = await prisma.role.create({
      data: {
        tenantId: tenant.id,
        name: "Doctor Creator",
        description: "Can create doctor profiles but cannot edit or link portal users",
        permissions: [
          "clinic:read",
          "doctor:read",
          "doctor:create",
          "dashboard:view",
        ],
      },
    });
  }

  // 5. Helper to create or update test users
  async function ensureUser(email: string, name: string) {
    return prisma.user.upsert({
      where: { email },
      create: {
        tenantId: tenant!.id,
        email,
        name,
        passwordHash,
        accountStatus: "ACTIVE",
        membershipStatus: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
      update: {
        tenantId: tenant!.id,
        passwordHash,
        accountStatus: "ACTIVE",
        membershipStatus: "ACTIVE",
      },
    });
  }

  const ownerUser = await ensureUser("e2e-owner@medcare.test", "E2E Owner");
  const adminUser = await ensureUser("e2e-admin@medcare.test", "E2E Admin");
  const receptionistUser = await ensureUser("e2e-receptionist@medcare.test", "E2E Receptionist");
  const doctorAUser = await ensureUser("e2e-doctor-a@medcare.test", "Dr. E2E Alice");
  const doctorBUser = await ensureUser("e2e-doctor-b@medcare.test", "Dr. E2E Bob");
  const unlinkedDoctorUser = await ensureUser("e2e-doctor-unlinked@medcare.test", "Dr. E2E Unlinked");
  const createOnlyUser = await ensureUser("e2e-createonly@medcare.test", "E2E Creator Staff");
  const mixedUser = await ensureUser("e2e-mixed@medcare.test", "Dr. E2E Mixed");

  // Helper to assign role
  async function assignRole(userId: string, roleId: string, clinicId: string | null) {
    const existing = await prisma.userRole.findFirst({
      where: { userId, roleId, clinicId },
    });
    if (!existing) {
      await prisma.userRole.create({
        data: { userId, roleId, clinicId },
      });
    }
  }

  // Clear existing role assignments for test users to keep them deterministic
  await prisma.userRole.deleteMany({
    where: {
      userId: {
        in: [
          ownerUser.id,
          adminUser.id,
          receptionistUser.id,
          doctorAUser.id,
          doctorBUser.id,
          unlinkedDoctorUser.id,
          createOnlyUser.id,
          mixedUser.id,
        ],
      },
    },
  });

  // Assign roles
  await assignRole(ownerUser.id, ownerRole.id, null); // Tenant-wide Owner
  await assignRole(adminUser.id, adminRole.id, clinicA.id); // Admin in Clinic A
  await assignRole(adminUser.id, adminRole.id, clinicB.id); // Admin in Clinic B
  await assignRole(receptionistUser.id, receptionistRole.id, clinicA.id); // Receptionist in Clinic A
  await assignRole(doctorAUser.id, doctorRole.id, clinicA.id); // Doctor in Clinic A
  await assignRole(doctorAUser.id, doctorRole.id, clinicB.id); // Doctor in Clinic B
  await assignRole(doctorBUser.id, doctorRole.id, clinicA.id); // Doctor in Clinic A only
  await assignRole(unlinkedDoctorUser.id, doctorRole.id, clinicA.id); // Doctor role, no doctor profile
  await assignRole(createOnlyUser.id, createOnlyRole.id, clinicA.id); // Create-only in Clinic A
  await assignRole(mixedUser.id, doctorRole.id, clinicA.id); // Doctor in Clinic A
  await assignRole(mixedUser.id, adminRole.id, clinicB.id); // Admin in Clinic B

  // 6. Doctor Profiles
  // Clean up any old doctor links for these users
  await prisma.doctor.updateMany({
    where: { userId: { in: [doctorAUser.id, doctorBUser.id, mixedUser.id] } },
    data: { userId: null },
  });

  // Doctor A in Clinic A
  let docA_ClinicA = await prisma.doctor.findFirst({
    where: { clinicId: clinicA.id, name: "Dr. Alice (Clinic A)" },
  });
  if (!docA_ClinicA) {
    docA_ClinicA = await prisma.doctor.create({
      data: {
        clinicId: clinicA.id,
        userId: doctorAUser.id,
        name: "Dr. Alice (Clinic A)",
        department: "General Medicine",
        phone: "+919111111111",
      },
    });
  } else {
    docA_ClinicA = await prisma.doctor.update({
      where: { id: docA_ClinicA.id },
      data: { userId: doctorAUser.id },
    });
  }

  // Doctor A in Clinic B (Multi-clinic)
  let docA_ClinicB = await prisma.doctor.findFirst({
    where: { clinicId: clinicB.id, name: "Dr. Alice (Clinic B)" },
  });
  if (!docA_ClinicB) {
    docA_ClinicB = await prisma.doctor.create({
      data: {
        clinicId: clinicB.id,
        userId: doctorAUser.id,
        name: "Dr. Alice (Clinic B)",
        department: "General Medicine",
        phone: "+919111111111",
      },
    });
  } else {
    docA_ClinicB = await prisma.doctor.update({
      where: { id: docA_ClinicB.id },
      data: { userId: doctorAUser.id },
    });
  }

  // Doctor B in Clinic A
  let docB_ClinicA = await prisma.doctor.findFirst({
    where: { clinicId: clinicA.id, name: "Dr. Bob (Clinic A)" },
  });
  if (!docB_ClinicA) {
    docB_ClinicA = await prisma.doctor.create({
      data: {
        clinicId: clinicA.id,
        userId: doctorBUser.id,
        name: "Dr. Bob (Clinic A)",
        department: "Cardiology",
        phone: "+919222222222",
      },
    });
  } else {
    docB_ClinicA = await prisma.doctor.update({
      where: { id: docB_ClinicA.id },
      data: { userId: doctorBUser.id },
    });
  }

  // Unlinked Doctor Profile in Clinic A
  let docUnlinked_ClinicA = await prisma.doctor.findFirst({
    where: { clinicId: clinicA.id, name: "Dr. Charlie Unlinked" },
  });
  if (!docUnlinked_ClinicA) {
    docUnlinked_ClinicA = await prisma.doctor.create({
      data: {
        clinicId: clinicA.id,
        userId: null,
        name: "Dr. Charlie Unlinked",
        department: "Dermatology",
        phone: "+919333333333",
      },
    });
  }

  // Mixed Doctor profile in Clinic A
  let docMixed_ClinicA = await prisma.doctor.findFirst({
    where: { clinicId: clinicA.id, name: "Dr. Mixed Profile" },
  });
  if (!docMixed_ClinicA) {
    docMixed_ClinicA = await prisma.doctor.create({
      data: {
        clinicId: clinicA.id,
        userId: mixedUser.id,
        name: "Dr. Mixed Profile",
        department: "Pediatrics",
        phone: "+919444444444",
      },
    });
  } else {
    docMixed_ClinicA = await prisma.doctor.update({
      where: { id: docMixed_ClinicA.id },
      data: { userId: mixedUser.id },
    });
  }

  // 7. Controlled Appointments for Doctor A, Doctor B, and Doctor A in Clinic B
  // Delete existing appointments for our test doctors to recreate a clean schedule
  await prisma.appointment.deleteMany({
    where: {
      doctorId: {
        in: [docA_ClinicA.id, docA_ClinicB.id, docB_ClinicA.id, docUnlinked_ClinicA.id, docMixed_ClinicA.id],
      },
    },
  });

  const todayStr = todayDateOnly();
  const tomorrowStr = tomorrowDateOnlyInTimeZone(new Date(), "Asia/Kolkata");
  const nextDay = parseDateOnly(tomorrowStr);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const dayAfterStr = formatDateOnly(nextDay);

  function slot(dateStr: string, timeStr: string) {
    return parseDateTime(dateStr, timeStr);
  }

  // Slots for Doctor A in Clinic A (Today):
  // 1. 09:00 - 09:30: Patient A1 (CONVERTED - Completed)
  // 2. 10:00 - 10:30: Patient A2 (CHECKED_IN - Waiting now)
  // 3. 11:30 - 12:00: Patient A3 (CONFIRMED - Next / Upcoming)
  // 4. 15:30 - 16:00: Patient A4 (SCHEDULED - Upcoming)
  // 5. 16:30 - 17:00: Patient A5 (CANCELLED)
  // 6. 17:30 - 18:00: Patient A6 (NO_SHOW)
  // 7. 18:30 - 19:00: Patient A7 (RESCHEDULED)

  const docA_A1 = await prisma.appointment.create({
    data: {
      tenantId: tenant.id,
      clinicId: clinicA.id,
      doctorId: docA_ClinicA.id,
      appointmentTypeId: consultationType.id,
      name: "Patient A1 Consultation",
      mobileNumber: "+919811100001",
      age: 32,
      gender: "Male",
      amount: 500,
      slotStart: slot(todayStr, "09:00"),
      slotEnd: slot(todayStr, "09:30"),
      activeSlotStart: slot(todayStr, "09:00"),
      status: AppointmentStatus.CONVERTED,
      bookingSource: AppointmentBookingSource.STAFF,
      bookedById: receptionistUser.id,
    },
  });

  await prisma.appointment.create({
    data: {
      tenantId: tenant.id,
      clinicId: clinicA.id,
      doctorId: docA_ClinicA.id,
      appointmentTypeId: followUpType.id,
      name: "Patient A2 Follow-up",
      mobileNumber: "+919811100002",
      age: 28,
      gender: "Female",
      amount: 300,
      slotStart: slot(todayStr, "10:00"),
      slotEnd: slot(todayStr, "10:30"),
      activeSlotStart: slot(todayStr, "10:00"),
      status: AppointmentStatus.CHECKED_IN,
      checkedInAt: slot(todayStr, "09:55"),
      checkedInById: receptionistUser.id,
      bookingSource: AppointmentBookingSource.STAFF,
      bookedById: receptionistUser.id,
    },
  });

  await prisma.appointment.create({
    data: {
      tenantId: tenant.id,
      clinicId: clinicA.id,
      doctorId: docA_ClinicA.id,
      appointmentTypeId: consultationType.id,
      name: "Patient A3 Consultation",
      mobileNumber: "+919811100003",
      age: 45,
      gender: "Male",
      amount: 500,
      slotStart: slot(todayStr, "11:30"),
      slotEnd: slot(todayStr, "12:00"),
      activeSlotStart: slot(todayStr, "11:30"),
      status: AppointmentStatus.CONFIRMED,
      bookingSource: AppointmentBookingSource.STAFF,
      bookedById: receptionistUser.id,
    },
  });

  await prisma.appointment.create({
    data: {
      tenantId: tenant.id,
      clinicId: clinicA.id,
      doctorId: docA_ClinicA.id,
      appointmentTypeId: reviewType.id,
      name: "Patient A4 Review",
      mobileNumber: "+919811100004",
      age: 50,
      gender: "Female",
      amount: 200,
      slotStart: slot(todayStr, "15:30"),
      slotEnd: slot(todayStr, "16:00"),
      activeSlotStart: slot(todayStr, "15:30"),
      status: AppointmentStatus.SCHEDULED,
      bookingSource: AppointmentBookingSource.STAFF,
      bookedById: receptionistUser.id,
    },
  });

  // Terminal statuses
  await prisma.appointment.create({
    data: {
      tenantId: tenant.id,
      clinicId: clinicA.id,
      doctorId: docA_ClinicA.id,
      appointmentTypeId: consultationType.id,
      name: "Patient A5 Cancelled",
      mobileNumber: "+919811100005",
      age: 22,
      gender: "Male",
      amount: 500,
      slotStart: slot(todayStr, "16:30"),
      slotEnd: slot(todayStr, "17:00"),
      activeSlotStart: null,
      status: AppointmentStatus.CANCELLED,
      cancelledAt: slot(todayStr, "14:00"),
      cancellationReason: "Patient called to cancel",
      cancelledById: receptionistUser.id,
      bookingSource: AppointmentBookingSource.STAFF,
      bookedById: receptionistUser.id,
    },
  });

  await prisma.appointment.create({
    data: {
      tenantId: tenant.id,
      clinicId: clinicA.id,
      doctorId: docA_ClinicA.id,
      appointmentTypeId: consultationType.id,
      name: "Patient A6 No-Show",
      mobileNumber: "+919811100006",
      age: 38,
      gender: "Female",
      amount: 500,
      slotStart: slot(todayStr, "17:30"),
      slotEnd: slot(todayStr, "18:00"),
      activeSlotStart: null,
      status: AppointmentStatus.NO_SHOW,
      bookingSource: AppointmentBookingSource.STAFF,
      bookedById: receptionistUser.id,
    },
  });

  await prisma.appointment.create({
    data: {
      tenantId: tenant.id,
      clinicId: clinicA.id,
      doctorId: docA_ClinicA.id,
      appointmentTypeId: consultationType.id,
      name: "Patient A7 Rescheduled",
      mobileNumber: "+919811100007",
      age: 29,
      gender: "Female",
      amount: 500,
      slotStart: slot(todayStr, "18:30"),
      slotEnd: slot(todayStr, "19:00"),
      activeSlotStart: null,
      status: AppointmentStatus.RESCHEDULED,
      bookingSource: AppointmentBookingSource.STAFF,
      bookedById: receptionistUser.id,
    },
  });

  // Future Appointments for Doctor A (Next 7 days)
  await prisma.appointment.create({
    data: {
      tenantId: tenant.id,
      clinicId: clinicA.id,
      doctorId: docA_ClinicA.id,
      appointmentTypeId: consultationType.id,
      name: "Patient A Future Tomorrow",
      mobileNumber: "+919811100008",
      age: 40,
      gender: "Male",
      amount: 500,
      slotStart: slot(tomorrowStr, "10:00"),
      slotEnd: slot(tomorrowStr, "10:30"),
      activeSlotStart: slot(tomorrowStr, "10:00"),
      status: AppointmentStatus.CONFIRMED,
      bookingSource: AppointmentBookingSource.STAFF,
      bookedById: receptionistUser.id,
    },
  });

  await prisma.appointment.create({
    data: {
      tenantId: tenant.id,
      clinicId: clinicA.id,
      doctorId: docA_ClinicA.id,
      appointmentTypeId: consultationType.id,
      name: "Patient A Future Day After",
      mobileNumber: "+919811100009",
      age: 41,
      gender: "Female",
      amount: 500,
      slotStart: slot(dayAfterStr, "14:00"),
      slotEnd: slot(dayAfterStr, "14:30"),
      activeSlotStart: slot(dayAfterStr, "14:00"),
      status: AppointmentStatus.SCHEDULED,
      bookingSource: AppointmentBookingSource.STAFF,
      bookedById: receptionistUser.id,
    },
  });

  // Appointments for Doctor A in Clinic B:
  await prisma.appointment.create({
    data: {
      tenantId: tenant.id,
      clinicId: clinicB.id,
      doctorId: docA_ClinicB.id,
      appointmentTypeId: consultationType.id,
      name: "Patient A-B1 Clinic B Consultation",
      mobileNumber: "+919811100010",
      age: 35,
      gender: "Male",
      amount: 500,
      slotStart: slot(todayStr, "12:00"),
      slotEnd: slot(todayStr, "12:30"),
      activeSlotStart: slot(todayStr, "12:00"),
      status: AppointmentStatus.CONFIRMED,
      bookingSource: AppointmentBookingSource.STAFF,
      bookedById: adminUser.id,
    },
  });

  // Slots for Doctor B in Clinic A (Today):
  // 1. 09:30 - 10:00: Patient B1 (SCHEDULED)
  // 2. 12:30 - 13:00: Patient B2 (CHECKED_IN)
  // 3. 16:30 - 17:00: Patient B3 (CONFIRMED)
  const docB_B1 = await prisma.appointment.create({
    data: {
      tenantId: tenant.id,
      clinicId: clinicA.id,
      doctorId: docB_ClinicA.id,
      appointmentTypeId: consultationType.id,
      name: "Patient B1 Consultation",
      mobileNumber: "+919822200001",
      age: 55,
      gender: "Female",
      amount: 500,
      slotStart: slot(todayStr, "09:30"),
      slotEnd: slot(todayStr, "10:00"),
      activeSlotStart: slot(todayStr, "09:30"),
      status: AppointmentStatus.SCHEDULED,
      bookingSource: AppointmentBookingSource.STAFF,
      bookedById: receptionistUser.id,
    },
  });

  await prisma.appointment.create({
    data: {
      tenantId: tenant.id,
      clinicId: clinicA.id,
      doctorId: docB_ClinicA.id,
      appointmentTypeId: followUpType.id,
      name: "Patient B2 Follow-up",
      mobileNumber: "+919822200002",
      age: 60,
      gender: "Male",
      amount: 300,
      slotStart: slot(todayStr, "12:30"),
      slotEnd: slot(todayStr, "13:00"),
      activeSlotStart: slot(todayStr, "12:30"),
      status: AppointmentStatus.CHECKED_IN,
      checkedInAt: slot(todayStr, "12:20"),
      checkedInById: receptionistUser.id,
      bookingSource: AppointmentBookingSource.STAFF,
      bookedById: receptionistUser.id,
    },
  });

  await prisma.appointment.create({
    data: {
      tenantId: tenant.id,
      clinicId: clinicA.id,
      doctorId: docB_ClinicA.id,
      appointmentTypeId: reviewType.id,
      name: "Patient B3 Review",
      mobileNumber: "+919822200003",
      age: 48,
      gender: "Female",
      amount: 200,
      slotStart: slot(todayStr, "16:30"),
      slotEnd: slot(todayStr, "17:00"),
      activeSlotStart: slot(todayStr, "16:30"),
      status: AppointmentStatus.CONFIRMED,
      bookingSource: AppointmentBookingSource.STAFF,
      bookedById: receptionistUser.id,
    },
  });

  // Future appointment for Doctor B
  await prisma.appointment.create({
    data: {
      tenantId: tenant.id,
      clinicId: clinicA.id,
      doctorId: docB_ClinicA.id,
      appointmentTypeId: consultationType.id,
      name: "Patient B Future Tomorrow",
      mobileNumber: "+919822200004",
      age: 39,
      gender: "Male",
      amount: 500,
      slotStart: slot(tomorrowStr, "11:00"),
      slotEnd: slot(tomorrowStr, "11:30"),
      activeSlotStart: slot(tomorrowStr, "11:00"),
      status: AppointmentStatus.CONFIRMED,
      bookingSource: AppointmentBookingSource.STAFF,
      bookedById: receptionistUser.id,
    },
  });

  // 8. Tasks for Doctor A
  await prisma.task.deleteMany({
    where: { assignedToId: doctorAUser.id },
  });

  const yesterdayDate = parseDateOnly(todayStr);
  yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
  const yesterdayStr = formatDateOnly(yesterdayDate);

  await prisma.task.create({
    data: {
      tenantId: tenant.id,
      clinicId: clinicA.id,
      title: "Review Lab Reports for Patient A1",
      description: "Urgent biochemistry panel review",
      priority: TaskPriority.HIGH,
      status: TaskStatus.OPEN,
      dueAt: slot(todayStr, "18:00"),
      createdById: adminUser.id,
      assignedToId: doctorAUser.id,
    },
  });

  await prisma.task.create({
    data: {
      tenantId: tenant.id,
      clinicId: clinicA.id,
      title: "Update Discharge Summary",
      description: "Patient from yesterday",
      priority: TaskPriority.MEDIUM,
      status: TaskStatus.IN_PROGRESS,
      dueAt: slot(todayStr, "12:00"),
      createdById: adminUser.id,
      assignedToId: doctorAUser.id,
    },
  });

  await prisma.task.create({
    data: {
      tenantId: tenant.id,
      clinicId: clinicA.id,
      title: "Overdue Care Plan Review",
      description: "Review chronic kidney patient chart",
      priority: TaskPriority.URGENT,
      status: TaskStatus.OPEN,
      dueAt: slot(yesterdayStr, "10:00"),
      createdById: adminUser.id,
      assignedToId: doctorAUser.id,
    },
  });

  await prisma.task.create({
    data: {
      tenantId: tenant.id,
      clinicId: clinicA.id,
      title: "Morning Huddle Protocol Completed",
      description: "Signed off morning clinic checks",
      priority: TaskPriority.LOW,
      status: TaskStatus.COMPLETED,
      dueAt: slot(todayStr, "09:00"),
      completedAt: slot(todayStr, "08:50"),
      completedById: doctorAUser.id,
      createdById: adminUser.id,
      assignedToId: doctorAUser.id,
    },
  });

  console.log("=== E2E SETUP COMPLETE ===");
  console.log("Tenant:", tenant.id, tenant.businessName);
  console.log("Clinic A:", clinicA.id);
  console.log("Clinic B:", clinicB.id);
  console.log("Doctor A profile (Clinic A):", docA_ClinicA.id);
  console.log("Doctor A profile (Clinic B):", docA_ClinicB.id);
  console.log("Doctor B profile (Clinic A):", docB_ClinicA.id);
  console.log("Doctor B appointment ID (for direct URL security test):", docB_B1.id);
  console.log("Doctor A appointment ID:", docA_A1.id);
  console.log("Users configured with password:", TEST_PASSWORD);
}

setupE2ETestData()
  .catch((e) => {
    console.error("Setup failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
