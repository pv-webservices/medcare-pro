import { beforeEach, describe, expect, it, vi } from "vitest";

const domain = vi.hoisted(() => ({
  getDoctor: vi.fn(),
  getSlots: vi.fn(),
  listDoctors: vi.fn(),
  listTypes: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));

vi.mock("@/lib/appointmentAvailability", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/appointmentAvailability")
  >();
  return {
    ...actual,
    getAppointmentDoctorForScope: domain.getDoctor,
    getAppointmentSlotsForScope: domain.getSlots,
    listAppointmentDoctorsForClinic: domain.listDoctors,
    listAppointmentTypesForClinic: domain.listTypes,
  };
});

import {
  buildDoctorMenuForClinic,
  handleAppointmentTypeMenuInput,
  handleDoctorMenuInput,
  handleSlotMenuInput,
  parseSignedIdState,
  parseSignedPageState,
} from "@/lib/telephony/availability";
import {
  buildAppointmentTypeMenuPrompt,
  buildDoctorMenuPrompt,
  formatClockTimeForSpeech,
  paginateIvrItems,
} from "@/lib/telephony/ivr";
import { ScopeError } from "@/lib/rbac";

const ORIGIN = "https://medcare-tunnel.example";
const INPUT_URL = `${ORIGIN}/api/webhooks/plivo/input`;
const DOCTOR_URL = `${ORIGIN}/api/webhooks/plivo/availability/doctor?page=0`;
const CLINIC = Object.freeze({
  clinicId: "clinic-a",
  tenantId: "tenant-a",
  clinicName: "Sunrise & <Care>",
  timezone: "Asia/Kolkata",
  publicPhoneNumber: null,
  receptionPhoneNumber: null,
  urgentPhoneNumber: null,
});
const DOCTORS = Array.from({ length: 9 }, (_, index) => ({
  id: `doctor-${index + 1}`,
  name: `Doctor ${index + 1}`,
  department: "General",
}));
const TYPES = Array.from({ length: 9 }, (_, index) => ({
  id: `type-${index + 1}`,
  name: `Type ${index + 1}`,
  durationMinutes: 30,
}));

function slotResult(overrides: Record<string, unknown> = {}) {
  return {
    date: "2026-09-02",
    clinicId: "clinic-a",
    doctorId: "doctor-1",
    doctorName: "Doctor One",
    appointmentTypeId: "type-1",
    appointmentTypeName: "Consultation",
    durationMinutes: 30,
    outcome: "ok" as const,
    slots: [
      { start: "09:00", end: "09:30", status: "available" as const },
    ],
    ...overrides,
  };
}

describe("IVR pagination and speech helpers", () => {
  it("uses seven named options and wraps an invalid page to page zero", () => {
    expect(paginateIvrItems(DOCTORS, 0, 7)).toMatchObject({
      items: DOCTORS.slice(0, 7),
      page: 0,
      hasNext: true,
    });
    expect(paginateIvrItems(DOCTORS, 1, 7)).toMatchObject({
      items: DOCTORS.slice(7),
      page: 1,
      hasNext: false,
    });
    expect(paginateIvrItems(DOCTORS, 999, 7).page).toBe(0);
  });

  it("announces doctor and appointment-type controls deterministically", () => {
    expect(buildDoctorMenuPrompt(DOCTORS.slice(0, 2), true)).toBe(
      "Select a doctor. Press 1 for Doctor 1. Press 2 for Doctor 2. " +
        "Press 8 for more doctors. Press 9 for the main menu.",
    );
    expect(buildAppointmentTypeMenuPrompt(TYPES.slice(0, 1), false)).toBe(
      "Select an appointment type. Press 1 for Type 1. " +
        "Press 9 for the main menu.",
    );
  });

  it.each([
    ["00:00", "12 AM"],
    ["00:05", "12:05 AM"],
    ["09:00", "9 AM"],
    ["09:30", "9:30 AM"],
    ["11:59", "11:59 AM"],
    ["12:00", "12 PM"],
    ["13:15", "1:15 PM"],
    ["18:00", "6 PM"],
    ["23:59", "11:59 PM"],
  ])("formats %s as %s", (clock, spoken) => {
    expect(formatClockTimeForSpeech(clock)).toBe(spoken);
  });

  it.each(["9:00", "24:00", "12:60", "noon", ""])(
    "rejects malformed clock value %j",
    (clock) => expect(() => formatClockTimeForSpeech(clock)).toThrow(),
  );

  it("bounds and sanitizes signed query state", () => {
    expect(parseSignedPageState(`${DOCTOR_URL}`, "page")).toBe(0);
    expect(parseSignedPageState(`${ORIGIN}/x?page=12`, "page")).toBe(12);
    expect(parseSignedPageState(`${ORIGIN}/x?page=-1`, "page")).toBe(0);
    expect(parseSignedPageState(`${ORIGIN}/x?page=10001`, "page")).toBe(0);
    expect(parseSignedPageState(`${ORIGIN}/x?page=1.5`, "page")).toBe(0);
    expect(parseSignedIdState(`${ORIGIN}/x?doctorId=%20doctor-a%20`, "doctorId"))
      .toBe("doctor-a");
    expect(parseSignedIdState(`${ORIGIN}/x`, "doctorId")).toBeNull();
  });
});

describe("doctor selection", () => {
  beforeEach(() => {
    Object.values(domain).forEach((mock) => mock.mockReset());
    domain.listDoctors.mockResolvedValue(DOCTORS);
    domain.listTypes.mockResolvedValue(TYPES);
    domain.getDoctor.mockResolvedValue(DOCTORS[0]);
    domain.getSlots.mockResolvedValue(slotResult());
  });

  it("returns a safe main menu when the scoped clinic has no doctors", async () => {
    domain.listDoctors.mockResolvedValueOnce([]);
    const xml = await buildDoctorMenuForClinic(INPUT_URL, CLINIC);

    expect(xml).toContain(
      "No doctors are currently available for telephone appointment lookup.",
    );
    expect(xml).toContain("Welcome to Sunrise &amp; &lt;Care&gt;.");
    expect(xml).toContain("/api/webhooks/plivo/input");
  });

  it("renders seven doctors, advertises more, and escapes XML-sensitive names", async () => {
    domain.listDoctors.mockResolvedValueOnce([
      { id: "xml", name: "A & B <C> > D", department: "General" },
      ...DOCTORS.slice(1),
    ]);
    const xml = await buildDoctorMenuForClinic(INPUT_URL, CLINIC);

    expect(xml).toContain("Press 1 for A &amp; B &lt;C&gt; &gt; D.");
    expect(xml).toContain("Press 7 for Doctor 7.");
    expect(xml).not.toContain("Press 8 for Doctor 8");
    expect(xml).toContain("Press 8 for more doctors.");
    expect(xml).toContain('numDigits="1"');
    expect(xml).toContain('method="POST"');
  });

  it("moves to the next doctor page and never treats 8 as a doctor", async () => {
    const xml = await handleDoctorMenuInput({
      requestUrl: DOCTOR_URL,
      clinic: CLINIC,
      digits: "8",
    });

    expect(xml).toContain("Press 1 for Doctor 8.");
    expect(xml).toContain("Press 2 for Doctor 9.");
    expect(xml).not.toContain("more doctors");
    expect(xml).toContain("page=1");
    expect(domain.listTypes).not.toHaveBeenCalled();
  });

  it("replays the same page for invalid input or 8 on the final page", async () => {
    const invalid = await handleDoctorMenuInput({
      requestUrl: DOCTOR_URL,
      clinic: CLINIC,
      digits: "0",
    });
    const finalEight = await handleDoctorMenuInput({
      requestUrl: `${ORIGIN}/api/webhooks/plivo/availability/doctor?page=1`,
      clinic: CLINIC,
      digits: "8",
    });

    expect(invalid).toContain("That selection was not recognized.");
    expect(invalid).toContain("page=0");
    expect(finalEight).toContain("That selection was not recognized.");
    expect(finalEight).toContain("Press 1 for Doctor 8.");
  });

  it("returns directly to the clinic main menu on digit 9", async () => {
    const xml = await handleDoctorMenuInput({
      requestUrl: DOCTOR_URL,
      clinic: CLINIC,
      digits: "9",
    });

    expect(xml).toContain("Welcome to Sunrise &amp; &lt;Care&gt;.");
    expect(domain.listDoctors).not.toHaveBeenCalled();
  });

  it("selects a doctor by the visible-page digit and starts type pagination", async () => {
    const xml = await handleDoctorMenuInput({
      requestUrl: `${ORIGIN}/api/webhooks/plivo/availability/doctor?page=1`,
      clinic: CLINIC,
      digits: "2",
    });

    expect(xml).toContain("Select an appointment type.");
    expect(xml).toContain("doctorId=doctor-9");
    expect(xml).toContain("page=0");
    expect(xml).not.toContain("clinicId=");
    expect(xml).not.toContain("tenantId=");
  });

  it("handles a clinic with no eligible appointment types", async () => {
    domain.listTypes.mockResolvedValueOnce([]);
    const xml = await handleDoctorMenuInput({
      requestUrl: DOCTOR_URL,
      clinic: CLINIC,
      digits: "1",
    });

    expect(xml).toContain(
      "No appointment types are currently available for telephone scheduling.",
    );
    expect(xml).toContain("Welcome to Sunrise");
  });
});

describe("appointment-type selection and spoken slot results", () => {
  beforeEach(() => {
    Object.values(domain).forEach((mock) => mock.mockReset());
    domain.listDoctors.mockResolvedValue(DOCTORS);
    domain.listTypes.mockResolvedValue(TYPES);
    domain.getDoctor.mockResolvedValue(DOCTORS[0]);
    domain.getSlots.mockResolvedValue(slotResult());
  });

  const typeUrl = (page = 0, doctorId = "doctor-1") =>
    `${ORIGIN}/api/webhooks/plivo/availability/type?doctorId=${doctorId}&page=${page}`;

  it("revalidates doctor state before reading appointment types", async () => {
    domain.getDoctor.mockResolvedValueOnce(null);
    const xml = await handleAppointmentTypeMenuInput({
      requestUrl: typeUrl(),
      clinic: CLINIC,
      digits: "1",
    });

    expect(domain.getDoctor).toHaveBeenCalledWith({
      ...CLINIC,
      doctorId: "doctor-1",
    });
    expect(xml).toContain(
      "That doctor is no longer available for telephone scheduling.",
    );
    expect(domain.listTypes).not.toHaveBeenCalled();
  });

  it("paginates types and preserves only doctor state", async () => {
    const xml = await handleAppointmentTypeMenuInput({
      requestUrl: typeUrl(),
      clinic: CLINIC,
      digits: "8",
    });

    expect(xml).toContain("Press 1 for Type 8.");
    expect(xml).toContain("Press 2 for Type 9.");
    expect(xml).toContain("doctorId=doctor-1");
    expect(xml).toContain("page=1");
    expect(xml).not.toContain("clinicId=");
    expect(xml).not.toContain("tenantId=");
  });

  it("replays an invalid type digit and returns on 9", async () => {
    const invalid = await handleAppointmentTypeMenuInput({
      requestUrl: typeUrl(),
      clinic: CLINIC,
      digits: "0",
    });
    const main = await handleAppointmentTypeMenuInput({
      requestUrl: typeUrl(),
      clinic: CLINIC,
      digits: "9",
    });

    expect(invalid).toContain("That selection was not recognized.");
    expect(invalid).toContain("Select an appointment type.");
    expect(main).toContain("Welcome to Sunrise");
    expect(domain.getSlots).not.toHaveBeenCalled();
  });

  it("computes tomorrow from the clinic timezone and uses the shared core", async () => {
    await handleAppointmentTypeMenuInput({
      requestUrl: typeUrl(),
      clinic: CLINIC,
      digits: "1",
      now: new Date("2026-08-31T20:00:00.000Z"),
    });

    expect(domain.getSlots).toHaveBeenCalledWith({
      ...CLINIC,
      doctorId: "doctor-1",
      appointmentTypeId: "type-1",
      date: "2026-09-02",
    });
  });

  it("speaks only available times and never exposes booking or patient data", async () => {
    domain.getSlots.mockResolvedValueOnce(
      slotResult({
        slots: [
          {
            start: "09:00",
            end: "09:30",
            status: "booked",
            bookingId: "booking-secret",
          },
          { start: "09:30", end: "10:00", status: "available" },
        ],
      }),
    );
    const xml = await handleAppointmentTypeMenuInput({
      requestUrl: typeUrl(),
      clinic: CLINIC,
      digits: "1",
      now: new Date("2026-09-01T00:00:00.000Z"),
    });

    expect(xml).toContain("9:30 AM");
    expect(xml).not.toContain("9 AM");
    expect(xml).not.toContain("booking-secret");
    expect(xml).not.toMatch(/patient|mobileNumber/i);
  });

  it.each([
    ["on-leave", "Doctor One is unavailable tomorrow."],
    [
      "no-availability",
      "Doctor One has no availability configured for tomorrow.",
    ],
    [
      "invalid-duration",
      "This appointment type is temporarily unavailable for telephone scheduling.",
    ],
  ] as const)("renders the safe %s outcome", async (outcome, message) => {
    domain.getSlots.mockResolvedValueOnce(slotResult({ outcome, slots: [] }));
    const xml = await handleAppointmentTypeMenuInput({
      requestUrl: typeUrl(),
      clinic: CLINIC,
      digits: "1",
    });

    expect(xml).toContain(message);
    expect(xml).toContain("Welcome to Sunrise");
  });

  it("uses the fully-booked wording for ok with no free slots", async () => {
    domain.getSlots.mockResolvedValueOnce(
      slotResult({
        slots: [
          {
            start: "09:00",
            end: "09:30",
            status: "booked",
            bookingId: "opaque-id",
          },
        ],
      }),
    );
    const xml = await handleAppointmentTypeMenuInput({
      requestUrl: typeUrl(),
      clinic: CLINIC,
      digits: "1",
    });

    expect(xml).toContain(
      "No appointment slots are available tomorrow for Doctor One for Consultation.",
    );
    expect(xml).not.toContain("opaque-id");
  });

  it("fails safely when a selected type moves outside scope before lookup", async () => {
    domain.getSlots.mockRejectedValueOnce(new ScopeError());
    const xml = await handleAppointmentTypeMenuInput({
      requestUrl: typeUrl(),
      clinic: CLINIC,
      digits: "1",
    });

    expect(xml).toContain(
      "That scheduling selection is no longer available for telephone scheduling.",
    );
    expect(xml).not.toContain("clinic-b");
    expect(xml).not.toContain("tenant-b");
  });

  it("limits slot speech to six times and advertises a next page", async () => {
    domain.getSlots.mockResolvedValueOnce(
      slotResult({
        slots: Array.from({ length: 8 }, (_, index) => ({
          start: `${String(9 + Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}`,
          end: "23:59",
          status: "available",
        })),
      }),
    );
    const xml = await handleAppointmentTypeMenuInput({
      requestUrl: typeUrl(),
      clinic: CLINIC,
      digits: "1",
    });

    expect(xml).toContain("9 AM, 9:30 AM, 10 AM, 10:30 AM, 11 AM, 11:30 AM");
    expect(xml).not.toContain("12 AM");
    expect(xml).toContain("Press 8 to hear more available times.");
    expect(xml).toContain("appointmentTypeId=type-1");
    expect(xml).toContain("offset=0");
  });
});

describe("slot-page callbacks", () => {
  const slotsUrl = (offset: number) =>
    `${ORIGIN}/api/webhooks/plivo/availability/slots?doctorId=doctor-1&appointmentTypeId=type-1&offset=${offset}`;

  beforeEach(() => {
    Object.values(domain).forEach((mock) => mock.mockReset());
    domain.getSlots.mockResolvedValue(
      slotResult({
        slots: Array.from({ length: 8 }, (_, index) => ({
          start: `${String(9 + Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}`,
          end: "23:59",
          status: "available",
        })),
      }),
    );
  });

  it("recomputes current tomorrow availability and advances by six", async () => {
    const xml = await handleSlotMenuInput({
      requestUrl: slotsUrl(0),
      clinic: CLINIC,
      digits: "8",
      now: new Date("2026-08-31T20:00:00.000Z"),
    });

    expect(domain.getSlots).toHaveBeenCalledWith({
      ...CLINIC,
      doctorId: "doctor-1",
      appointmentTypeId: "type-1",
      date: "2026-09-02",
    });
    expect(xml).toContain("12 PM, 12:30 PM");
    expect(xml).not.toContain("Press 8 to hear more");
    expect(xml).toContain("offset=6");
  });

  it("replays the current page for invalid input or an unavailable next page", async () => {
    const invalid = await handleSlotMenuInput({
      requestUrl: slotsUrl(6),
      clinic: CLINIC,
      digits: "1",
    });
    const finalEight = await handleSlotMenuInput({
      requestUrl: slotsUrl(6),
      clinic: CLINIC,
      digits: "8",
    });

    expect(invalid).toContain("That selection was not recognized.");
    expect(invalid).toContain("12 PM, 12:30 PM");
    expect(finalEight).toContain("That selection was not recognized.");
    expect(finalEight).toContain("offset=6");
  });

  it("caps a stale or huge offset to the first current page", async () => {
    const xml = await handleSlotMenuInput({
      requestUrl: slotsUrl(9999),
      clinic: CLINIC,
      digits: "0",
    });

    expect(xml).toContain("9 AM, 9:30 AM");
    expect(xml).toContain("offset=0");
  });

  it("returns to main menu on 9 without querying slots", async () => {
    const xml = await handleSlotMenuInput({
      requestUrl: slotsUrl(0),
      clinic: CLINIC,
      digits: "9",
    });

    expect(xml).toContain("Welcome to Sunrise");
    expect(domain.getSlots).not.toHaveBeenCalled();
  });

  it("fails safely when doctor or type state is missing", async () => {
    const xml = await handleSlotMenuInput({
      requestUrl: `${ORIGIN}/api/webhooks/plivo/availability/slots?offset=0`,
      clinic: CLINIC,
      digits: "8",
    });

    expect(xml).toContain(
      "That scheduling selection is no longer available for telephone scheduling.",
    );
    expect(domain.getSlots).not.toHaveBeenCalled();
  });

  it("fails safely when signed IDs no longer belong to the resolved scope", async () => {
    domain.getSlots.mockRejectedValueOnce(new ScopeError());
    const xml = await handleSlotMenuInput({
      requestUrl: slotsUrl(0),
      clinic: CLINIC,
      digits: "8",
    });

    expect(xml).toContain(
      "That scheduling selection is no longer available for telephone scheduling.",
    );
    expect(xml).not.toContain("clinic-b");
    expect(xml).not.toContain("tenant-b");
  });
});
