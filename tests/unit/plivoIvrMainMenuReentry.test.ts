import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));
import {
  handleAppointmentTypeMenuInput,
  handleDoctorMenuInput,
  handleSlotMenuInput,
} from "@/lib/telephony/availability";
import {
  handleBookingConfirmationInput,
  handleBookingDoctorInput,
  handleBookingIdentityInput,
  handleBookingSlotInput,
  handleBookingTypeInput,
} from "@/lib/telephony/booking";
import type { InboundClinicContext } from "@/lib/telephony/clinicConfig";
import { compileCustomClinicIvrRuntimeMenu } from "@/lib/telephony/ivrRuntime";

const clinic: InboundClinicContext = Object.freeze({
  clinicId: "clinic-a",
  tenantId: "tenant-a",
  clinicName: "Sunrise Clinic",
  timezone: "Asia/Kolkata",
  publicPhoneNumber: null,
  receptionPhoneNumber: null,
  urgentPhoneNumber: null,
});

const runtimeMenu = compileCustomClinicIvrRuntimeMenu(clinic.clinicName, {
  greetingTemplate: "Return to the custom menu for {clinicName}.",
  language: "en-US",
  voice: "WOMAN",
  items: [
    {
      digit: 4,
      label: "clinic information",
      action: "CLINIC_INFORMATION",
      position: 0,
      enabled: true,
    },
  ],
});

const baseInput = {
  requestUrl: "https://voice.example/api/webhooks/plivo/downstream",
  clinic,
  digits: "9",
  runtimeMenu,
};

describe("custom IVR main-menu re-entry", () => {
  it.each([
    ["availability doctor", () => handleDoctorMenuInput(baseInput)],
    ["availability type", () => handleAppointmentTypeMenuInput(baseInput)],
    ["availability slots", () => handleSlotMenuInput(baseInput)],
    [
      "booking identity",
      () =>
        handleBookingIdentityInput({
          ...baseInput,
          from: "+919000000002",
          callUuid: "call-a",
        }),
    ],
    [
      "booking doctor",
      () =>
        handleBookingDoctorInput({
          ...baseInput,
          from: "+919000000002",
          callUuid: "call-a",
        }),
    ],
    [
      "booking type",
      () =>
        handleBookingTypeInput({
          ...baseInput,
          from: "+919000000002",
          callUuid: "call-a",
        }),
    ],
    [
      "booking slots",
      () =>
        handleBookingSlotInput({
          ...baseInput,
          from: "+919000000002",
          callUuid: "call-a",
        }),
    ],
    [
      "booking confirmation",
      () =>
        handleBookingConfirmationInput({
          ...baseInput,
          from: "+919000000002",
          callUuid: "call-a",
        }),
    ],
  ])("retains the custom profile from %s", async (_name, render) => {
    const xml = await render();
    expect(xml).toContain("Return to the custom menu for Sunrise Clinic.");
    expect(xml).toContain(`ivrRev=${runtimeMenu.revision}`);
    expect(xml).toContain("Press 4 for clinic information.");
    expect(xml).not.toContain("Press 1 for tomorrow slots.");
  });
});
