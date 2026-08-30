import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  doctorFindFirst: vi.fn(),
  doctorFindMany: vi.fn(),
  typeFindFirst: vi.fn(),
  typeFindMany: vi.fn(),
  availabilityFindMany: vi.fn(),
  leaveFindMany: vi.fn(),
  appointmentFindMany: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    doctor: {
      findFirst: db.doctorFindFirst,
      findMany: db.doctorFindMany,
    },
    appointmentType: {
      findFirst: db.typeFindFirst,
      findMany: db.typeFindMany,
    },
    doctorAvailability: { findMany: db.availabilityFindMany },
    doctorLeave: { findMany: db.leaveFindMany },
    appointment: { findMany: db.appointmentFindMany },
  },
}));

import {
  getAppointmentDoctorForScope,
  getAppointmentSlotsForScope,
  getAppointmentTypeForScope,
  listAppointmentDoctorsForClinic,
  listAppointmentTypesForClinic,
} from "@/lib/appointmentAvailability";
import { ScopeError } from "@/lib/rbac";

const SCOPE = { tenantId: "tenant-a", clinicId: "clinic-a" } as const;
const DATE = "2026-09-01";
const DOCTOR = {
  id: "doctor-a",
  name: "Asha & Sons <Care>",
  department: "General",
};
const TYPE_ROW = {
  id: "type-a",
  tenantId: "tenant-a",
  clinicId: null,
  name: "Consultation",
  durationMinutes: 30,
  isActive: true,
};

function primeSuccessfulRead(): void {
  db.doctorFindFirst.mockResolvedValue(DOCTOR);
  db.typeFindFirst.mockResolvedValue(TYPE_ROW);
  db.availabilityFindMany.mockResolvedValue([
    {
      date: new Date(`${DATE}T00:00:00.000Z`),
      startTime: "09:00",
      endTime: "10:30",
    },
  ]);
  db.leaveFindMany.mockResolvedValue([]);
  db.appointmentFindMany.mockResolvedValue([]);
}

describe("trusted appointment availability core", () => {
  beforeEach(() => {
    Object.values(db).forEach((mock) => mock.mockReset());
    primeSuccessfulRead();
  });

  it("proves a doctor belongs to both the clinic and tenant", async () => {
    await getAppointmentDoctorForScope({ ...SCOPE, doctorId: "doctor-a" });

    expect(db.doctorFindFirst).toHaveBeenCalledWith({
      where: {
        id: "doctor-a",
        clinicId: "clinic-a",
        clinic: { tenantId: "tenant-a" },
      },
      select: { id: true, name: true, department: true },
    });
  });

  it.each([
    ["outside the requested clinic"],
    ["outside the requested tenant"],
  ])("rejects a doctor %s", async () => {
    db.doctorFindFirst.mockResolvedValueOnce(null);

    await expect(
      getAppointmentSlotsForScope({
        ...SCOPE,
        doctorId: "doctor-other",
        appointmentTypeId: "type-a",
        date: DATE,
      }),
    ).rejects.toBeInstanceOf(ScopeError);
    expect(db.availabilityFindMany).not.toHaveBeenCalled();
  });

  it.each([
    ["another tenant", { ...TYPE_ROW, tenantId: "tenant-b" }],
    ["another clinic", { ...TYPE_ROW, clinicId: "clinic-b" }],
    ["inactive", { ...TYPE_ROW, isActive: false }],
  ])("rejects an appointment type from %s", async (_label, row) => {
    db.typeFindFirst.mockResolvedValueOnce(row);

    await expect(
      getAppointmentSlotsForScope({
        ...SCOPE,
        doctorId: "doctor-a",
        appointmentTypeId: row.id,
        date: DATE,
      }),
    ).rejects.toBeInstanceOf(ScopeError);
    expect(db.availabilityFindMany).not.toHaveBeenCalled();
  });

  it.each([
    ["tenant-wide", null],
    ["clinic-specific", "clinic-a"],
  ])("allows an active %s appointment type", async (_label, clinicId) => {
    db.typeFindFirst.mockResolvedValueOnce({ ...TYPE_ROW, clinicId });

    const result = await getAppointmentSlotsForScope({
      ...SCOPE,
      doctorId: "doctor-a",
      appointmentTypeId: "type-a",
      date: DATE,
    });

    expect(result.outcome).toBe("ok");
    expect(result.slots.map((slot) => slot.start)).toEqual([
      "09:00",
      "09:30",
      "10:00",
    ]);
  });

  it("loads only exact-date availability and keeps another date unusable", async () => {
    db.availabilityFindMany.mockResolvedValueOnce([
      {
        date: new Date("2026-08-31T00:00:00.000Z"),
        startTime: "09:00",
        endTime: "12:00",
      },
    ]);

    const result = await getAppointmentSlotsForScope({
      ...SCOPE,
      doctorId: "doctor-a",
      appointmentTypeId: "type-a",
      date: DATE,
    });

    expect(db.availabilityFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          doctorId: "doctor-a",
          date: new Date(`${DATE}T00:00:00.000Z`),
        },
      }),
    );
    expect(result.outcome).toBe("no-availability");
    expect(result.slots).toEqual([]);
  });

  it("reports leave without selecting or exposing its reason", async () => {
    db.leaveFindMany.mockResolvedValueOnce([
      {
        startDate: new Date(`${DATE}T00:00:00.000Z`),
        endDate: new Date(`${DATE}T00:00:00.000Z`),
      },
    ]);

    const result = await getAppointmentSlotsForScope({
      ...SCOPE,
      doctorId: "doctor-a",
      appointmentTypeId: "type-a",
      date: DATE,
    });

    expect(result.outcome).toBe("on-leave");
    expect(db.leaveFindMany.mock.calls[0][0].select).toEqual({
      startDate: true,
      endDate: true,
    });
    expect(JSON.stringify(result)).not.toContain("reason");
  });

  it("marks an occupying appointment booked but ignores a cancelled one", async () => {
    db.appointmentFindMany.mockResolvedValueOnce([
      {
        id: "booking-secret",
        slotStart: new Date(`${DATE}T09:00:00.000Z`),
        slotEnd: new Date(`${DATE}T09:30:00.000Z`),
        status: "SCHEDULED",
      },
      {
        id: "cancelled-secret",
        slotStart: new Date(`${DATE}T09:30:00.000Z`),
        slotEnd: new Date(`${DATE}T10:00:00.000Z`),
        status: "CANCELLED",
      },
    ]);

    const result = await getAppointmentSlotsForScope({
      ...SCOPE,
      doctorId: "doctor-a",
      appointmentTypeId: "type-a",
      date: DATE,
    });

    expect(result.slots).toEqual([
      expect.objectContaining({
        start: "09:00",
        status: "booked",
        bookingId: "booking-secret",
      }),
      expect.objectContaining({ start: "09:30", status: "available" }),
      expect.objectContaining({ start: "10:00", status: "available" }),
    ]);
    expect(db.appointmentFindMany.mock.calls[0][0].where.status).toEqual({
      in: ["SCHEDULED", "CONFIRMED", "CHECKED_IN", "CONVERTED"],
    });
  });

  it("never selects patient data for slot computation", async () => {
    const result = await getAppointmentSlotsForScope({
      ...SCOPE,
      doctorId: "doctor-a",
      appointmentTypeId: "type-a",
      date: DATE,
    });

    expect(db.appointmentFindMany.mock.calls[0][0].select).toEqual({
      id: true,
      slotStart: true,
      slotEnd: true,
      status: true,
    });
    expect(JSON.stringify(result)).not.toMatch(/patient|mobileNumber/i);
  });
});

describe("telephone option read models", () => {
  beforeEach(() => {
    Object.values(db).forEach((mock) => mock.mockReset());
  });

  it("lists doctors in stable scoped order with minimal fields", async () => {
    db.doctorFindMany.mockResolvedValue([]);
    await listAppointmentDoctorsForClinic(SCOPE);

    expect(db.doctorFindMany).toHaveBeenCalledWith({
      where: {
        clinicId: "clinic-a",
        clinic: { tenantId: "tenant-a" },
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, name: true, department: true },
    });
  });

  it("lists only active tenant-wide or current-clinic appointment types", async () => {
    db.typeFindMany.mockResolvedValue([]);
    await listAppointmentTypesForClinic(SCOPE);

    expect(db.typeFindMany).toHaveBeenCalledWith({
      where: {
        tenantId: "tenant-a",
        isActive: true,
        OR: [{ clinicId: null }, { clinicId: "clinic-a" }],
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, name: true, durationMinutes: true },
    });
  });

  it("returns null when a scoped type becomes inactive or moves clinics", async () => {
    db.typeFindFirst.mockResolvedValue({ ...TYPE_ROW, isActive: false });
    await expect(
      getAppointmentTypeForScope({ ...SCOPE, appointmentTypeId: "type-a" }),
    ).resolves.toBeNull();
  });
});
