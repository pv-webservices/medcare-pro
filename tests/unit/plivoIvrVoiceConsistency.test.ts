import { describe, expect, it } from "vitest";
import { compileCustomClinicIvrRuntimeMenu } from "@/lib/telephony/ivrRuntime";
import {
  buildAppointmentTypeSelectionXml,
  buildBookingSlotSelectionXml,
  buildClinicInformationMenuXml,
  buildDoctorSelectionXml,
  buildEffectiveClinicMainMenuXml,
  buildFinalBookingConfirmationXml,
  buildPatientConfirmationXml,
  buildReceptionFailureThenMainMenuXml,
  buildReceptionTransferXml,
  buildSlotSelectionXml,
  buildUrgentAssistanceMenuXml,
  buildUrgentTransferFailureXml,
  buildUrgentTransferNotConfiguredXml,
  buildUrgentTransferTemporarilyUnavailableXml,
  buildUrgentTransferXml,
} from "@/lib/telephony/plivo";
import { buildTelephonyTestMainMenuXml } from "@/lib/telephony/testCallIvr";

const ACTION_URL = "https://voice.example/api/webhooks/plivo/action";
const CUSTOM_RUNTIME = compileCustomClinicIvrRuntimeMenu("Sharma Clinic", {
  greetingTemplate: "Welcome to {clinicName}.",
  language: "en-IN",
  voice: "WOMAN",
  items: [
    {
      digit: 1,
      label: "tomorrow slots",
      action: "TOMORROW_SLOTS",
      position: 0,
      enabled: true,
    },
  ],
});

function expectEverySpeakUsesCustomProfile(
  xml: string,
  expectedCount?: number,
): void {
  const tags = xml.match(/<Speak(?:\s[^>]*)?>/g) ?? [];
  expect(tags.length).toBeGreaterThan(0);
  if (expectedCount !== undefined) expect(tags).toHaveLength(expectedCount);
  for (const tag of tags) {
    expect(tag).toContain('language="en-IN"');
    expect(tag).toContain('voice="WOMAN"');
  }
}

describe("custom IVR voice consistency", () => {
  it("covers main-menu message, invalid, prompt, and no-input speech", () => {
    const xml = buildEffectiveClinicMainMenuXml({
      inputActionUrl: ACTION_URL,
      clinicName: "Sharma Clinic",
      runtimeMenu: CUSTOM_RUNTIME,
      message: "The menu was refreshed.",
      invalidSelection: true,
    });

    expectEverySpeakUsesCustomProfile(xml, 4);
  });

  it("covers doctor-selection speech", () => {
    const xml = buildDoctorSelectionXml({
      actionUrl: ACTION_URL,
      doctors: [{ id: "doctor-a", name: "Doctor A" }],
      hasNext: false,
      invalidSelection: true,
      runtimeMenu: CUSTOM_RUNTIME,
    });

    expectEverySpeakUsesCustomProfile(xml, 3);
  });

  it("covers appointment-type speech", () => {
    const xml = buildAppointmentTypeSelectionXml({
      actionUrl: ACTION_URL,
      appointmentTypes: [{ id: "type-a", name: "Consultation" }],
      hasNext: false,
      invalidSelection: true,
      runtimeMenu: CUSTOM_RUNTIME,
    });

    expectEverySpeakUsesCustomProfile(xml, 3);
  });

  it("covers slot speech on the first and next pages", () => {
    const pageOne = buildSlotSelectionXml({
      actionUrl: `${ACTION_URL}?offset=0`,
      doctorName: "Doctor A",
      appointmentTypeName: "Consultation",
      slotTimes: ["09:00", "09:30"],
      hasNext: true,
      runtimeMenu: CUSTOM_RUNTIME,
    });
    const pageTwo = buildSlotSelectionXml({
      actionUrl: `${ACTION_URL}?offset=6`,
      doctorName: "Doctor A",
      appointmentTypeName: "Consultation",
      slotTimes: ["12:00"],
      hasNext: false,
      invalidSelection: true,
      runtimeMenu: CUSTOM_RUNTIME,
    });

    expect(pageOne).toContain("Press 8 to hear more available times.");
    expectEverySpeakUsesCustomProfile(pageOne, 2);
    expectEverySpeakUsesCustomProfile(pageTwo, 3);
  });

  it("covers clinic-information speech", () => {
    const xml = buildClinicInformationMenuXml({
      actionUrl: ACTION_URL,
      prompt: "The clinic is open. Press 9 for the main menu.",
      invalidSelection: true,
      runtimeMenu: CUSTOM_RUNTIME,
    });

    expectEverySpeakUsesCustomProfile(xml, 3);
  });

  it("covers booking, callback, and confirmation speech", () => {
    const callback = buildEffectiveClinicMainMenuXml({
      inputActionUrl: ACTION_URL,
      clinicName: "Sharma Clinic",
      runtimeMenu: CUSTOM_RUNTIME,
      message: "Your callback request has been saved.",
    });
    const patient = buildPatientConfirmationXml({
      actionUrl: ACTION_URL,
      invalidSelection: true,
      runtimeMenu: CUSTOM_RUNTIME,
    });
    const slots = buildBookingSlotSelectionXml({
      actionUrl: ACTION_URL,
      doctorName: "Doctor A",
      appointmentTypeName: "Consultation",
      slotTimes: ["09:00"],
      hasNext: false,
      leadingMessage: "That appointment time is no longer available.",
      runtimeMenu: CUSTOM_RUNTIME,
    });
    const finalConfirmation = buildFinalBookingConfirmationXml({
      actionUrl: ACTION_URL,
      doctorName: "Doctor A",
      appointmentTypeName: "Consultation",
      startTime: "09:00",
      invalidSelection: true,
      runtimeMenu: CUSTOM_RUNTIME,
    });

    for (const xml of [callback, patient, slots, finalConfirmation]) {
      expectEverySpeakUsesCustomProfile(xml);
    }
  });

  it("covers urgent menu, transfer, and failure speech without changing Dial", () => {
    const menu = buildUrgentAssistanceMenuXml({
      actionUrl: ACTION_URL,
      invalidSelection: true,
      runtimeMenu: CUSTOM_RUNTIME,
    });
    const transfer = buildUrgentTransferXml({
      actionUrl: ACTION_URL,
      callerId: "+919000000001",
      destination: "+919000000002",
      runtimeMenu: CUSTOM_RUNTIME,
    });
    const failure = buildUrgentTransferFailureXml(CUSTOM_RUNTIME);
    const notConfigured = buildUrgentTransferNotConfiguredXml(CUSTOM_RUNTIME);
    const unavailable =
      buildUrgentTransferTemporarilyUnavailableXml(CUSTOM_RUNTIME);

    expectEverySpeakUsesCustomProfile(menu, 3);
    expectEverySpeakUsesCustomProfile(transfer, 1);
    expectEverySpeakUsesCustomProfile(failure, 1);
    expectEverySpeakUsesCustomProfile(notConfigured, 1);
    expectEverySpeakUsesCustomProfile(unavailable, 1);
    expect(transfer).toContain('callerId="+919000000001"');
    expect(transfer).toContain("<Number>+919000000002</Number>");
  });

  it("covers reception pre-connect speech without changing Dial", () => {
    const xml = buildReceptionTransferXml({
      actionUrl: ACTION_URL,
      callerId: "+919000000001",
      destination: "+919000000003",
      runtimeMenu: CUSTOM_RUNTIME,
    });

    expectEverySpeakUsesCustomProfile(xml, 1);
    expect(xml).toContain('callerId="+919000000001"');
    expect(xml).toContain("<Number>+919000000003</Number>");

    const fallback = buildReceptionFailureThenMainMenuXml(
      ACTION_URL,
      "Sharma Clinic",
      CUSTOM_RUNTIME,
    );
    expectEverySpeakUsesCustomProfile(fallback, 3);
  });

  it("covers Phase 5 prefix, acknowledgement, replay, and invalid speech", () => {
    const xml = buildTelephonyTestMainMenuXml({
      requestUrl: "https://voice.example/api/webhooks/plivo/test-call/answer",
      testCallId: "test-call-a",
      clinicName: "Sharma Clinic",
      runtimeMenu: CUSTOM_RUNTIME,
      includePrefix: true,
      message: "Test successful. This option is mapped to clinic information.",
      invalidSelection: true,
    });

    expect(xml).toContain("This is a MEDCARE PRO phone menu test.");
    expectEverySpeakUsesCustomProfile(xml, 4);
    expect(xml).not.toContain("<Dial");
  });
});
