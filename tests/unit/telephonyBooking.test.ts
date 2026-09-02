import { beforeEach, describe, expect, it, vi } from "vitest";

const domain = vi.hoisted(() => ({
  getDoctor: vi.fn(),
  getSlots: vi.fn(),
  listDoctors: vi.fn(),
  listTypes: vi.fn(),
  resolvePatient: vi.fn(),
  createRequest: vi.fn(),
  createAppointment: vi.fn(),
  getExisting: vi.fn(),
  observeCallEvents: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));

vi.mock("@/lib/appointmentAvailability", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/appointmentAvailability")>()),
  getAppointmentDoctorForScope: domain.getDoctor,
  getAppointmentSlotsForScope: domain.getSlots,
  listAppointmentDoctorsForClinic: domain.listDoctors,
  listAppointmentTypesForClinic: domain.listTypes,
}));

vi.mock("@/lib/telephony/bookingIdentity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/telephony/bookingIdentity")>()),
  resolveTelephonePatient: domain.resolvePatient,
  createTelephonyBookingRequest: domain.createRequest,
}));

vi.mock("@/lib/appointmentBooking", () => ({
  buildPhoneBookingSourceRef: () => `plivo:${"a".repeat(64)}`,
  createAppointmentForScope: domain.createAppointment,
  getPhoneIvrAppointmentForCall: domain.getExisting,
}));

vi.mock("@/lib/telephony/callObservability", () => ({
  observeProductionCallEvents: domain.observeCallEvents,
}));

import {
  beginTelephoneBooking,
  handleBookingConfirmationInput,
  handleBookingSlotInput,
} from "@/lib/telephony/booking";

const clinic = Object.freeze({
  clinicId: "clinic-a",
  tenantId: "tenant-a",
  clinicName: "Sunrise Clinic",
  timezone: "Asia/Kolkata",
  publicPhoneNumber: null,
  receptionPhoneNumber: null,
  urgentPhoneNumber: null,
});
const sensitivePatient = {
  id: "patient-secret-id",
  name: "Sensitive Name",
  mobileNumber: "+919876543210",
  age: 42,
  gender: "Female",
  address: "Sensitive Address",
  city: "Pune",
};
const base = {
  requestUrl: "https://medcare.example/api/webhooks/plivo/input",
  clinic,
  from: "+919876543210",
  callUuid: "call-uuid-123456",
  now: new Date("2026-09-01T06:00:00.000Z"),
};

function slots(available = true) {
  return {
    date: "2026-09-02",
    clinicId: "clinic-a",
    doctorId: "doctor-a",
    doctorName: "Dr Rao",
    appointmentTypeId: "type-a",
    appointmentTypeName: "Consultation",
    durationMinutes: 30,
    outcome: "ok" as const,
    slots: [
      { start: "09:00", end: "09:30", status: available ? "available" as const : "booked" as const },
      { start: "09:30", end: "10:00", status: "available" as const },
    ],
  };
}

describe("safe telephone booking flow", () => {
  beforeEach(() => {
    Object.values(domain).forEach((mock) => mock.mockReset());
    domain.resolvePatient.mockResolvedValue({
      kind: "one",
      callerNumber: "+919876543210",
      patient: sensitivePatient,
    });
    domain.createRequest.mockResolvedValue({ id: "request-a", reason: "NO_PATIENT_MATCH", status: "PENDING" });
    domain.getExisting.mockResolvedValue(null);
    domain.getDoctor.mockResolvedValue({ id: "doctor-a", name: "Dr Rao", department: "General" });
    domain.listDoctors.mockResolvedValue([{ id: "doctor-a", name: "Dr Rao", department: "General" }]);
    domain.listTypes.mockResolvedValue([{ id: "type-a", name: "Consultation", durationMinutes: 30 }]);
    domain.getSlots.mockResolvedValue(slots());
    domain.createAppointment.mockResolvedValue({ id: "appointment-a" });
    domain.observeCallEvents.mockResolvedValue("recorded");
  });

  it("uses a neutral confirmation and never speaks exact-match demographics", async () => {
    const xml = await beginTelephoneBooking(base);
    expect(xml).toContain("one patient record");
    for (const secret of Object.values(sensitivePatient).map(String)) {
      expect(xml).not.toContain(secret);
    }
  });

  it.each(["none", "ambiguous"] as const)(
    "creates only a generic callback request for a %s match",
    async (kind) => {
      domain.resolvePatient.mockResolvedValue({
        kind,
        callerNumber: "+919876543210",
      });
      const xml = await beginTelephoneBooking(base);
      expect(domain.createRequest).toHaveBeenCalledOnce();
      expect(domain.createAppointment).not.toHaveBeenCalled();
      expect(domain.observeCallEvents).toHaveBeenCalledWith({
        clinicId: "clinic-a",
        providerCallUuid: "call-uuid-123456",
        events: ["BOOKING_FOLLOW_UP_CREATED"],
      });
      expect(xml).not.toContain("Sensitive");
      expect(xml).not.toContain("+919876543210");
      expect(xml).not.toMatch(/two|multiple|zero patients/i);
    },
  );

  it("does not write when CallUUID is missing", async () => {
    const xml = await beginTelephoneBooking({ ...base, callUuid: undefined });
    expect(xml).toContain("call identifier is unavailable");
    expect(domain.createRequest).not.toHaveBeenCalled();
    expect(domain.createAppointment).not.toHaveBeenCalled();
  });

  it("maps digits only over the fresh available slot list", async () => {
    domain.getSlots.mockResolvedValueOnce(slots(false));
    const xml = await handleBookingSlotInput({
      ...base,
      requestUrl: "https://medcare.example/api/webhooks/plivo/booking/slots?doctorId=doctor-a&appointmentTypeId=type-a&offset=0",
      digits: "1",
    });
    expect(xml).toContain("9:30 AM");
    expect(xml).not.toContain("9 AM");
    expect(xml).toContain("/api/webhooks/plivo/booking/confirm");
  });

  it("revalidates and invokes the shared booking core with system provenance", async () => {
    const xml = await handleBookingConfirmationInput({
      ...base,
      requestUrl: "https://medcare.example/api/webhooks/plivo/booking/confirm?doctorId=doctor-a&appointmentTypeId=type-a&startTime=09%3A00",
      digits: "1",
    });
    expect(domain.getSlots).toHaveBeenCalledOnce();
    expect(domain.createAppointment).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-a",
        clinicId: "clinic-a",
        patientId: "patient-secret-id",
        patientSnapshot: sensitivePatient,
        provenance: expect.objectContaining({
          bookingSource: "PHONE_IVR",
          bookedById: null,
          auditActorUserId: null,
          bookingSourceRef: expect.stringMatching(/^plivo:[a-f0-9]{64}$/),
        }),
      }),
    );
    expect(xml).toContain("booked with Dr Rao tomorrow at 9 AM");
    expect(xml).not.toContain("Sensitive Name");
  });

  it("treats a same-call retry as success without making a second booking", async () => {
    domain.getExisting.mockResolvedValueOnce({ id: "appointment-a" });
    const xml = await handleBookingConfirmationInput({
      ...base,
      requestUrl: "https://medcare.example/api/webhooks/plivo/booking/confirm?doctorId=other&appointmentTypeId=other&startTime=11%3A00",
      digits: "1",
    });
    expect(domain.createAppointment).not.toHaveBeenCalled();
    expect(xml).toContain("appointment is confirmed");
  });

  it("returns a lost slot to the current selectable slot menu", async () => {
    domain.getSlots.mockResolvedValueOnce(slots(false)).mockResolvedValueOnce(slots(false));
    const xml = await handleBookingConfirmationInput({
      ...base,
      requestUrl: "https://medcare.example/api/webhooks/plivo/booking/confirm?doctorId=doctor-a&appointmentTypeId=type-a&startTime=09%3A00",
      digits: "1",
    });
    expect(domain.createAppointment).not.toHaveBeenCalled();
    expect(xml).toContain("That appointment time is no longer available.");
    expect(xml).toContain("Press 1 for 9:30 AM");
  });
});
