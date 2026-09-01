import { describe, expect, it } from "vitest";
import {
  compileCustomClinicIvrRuntimeMenu,
  defaultClinicIvrRuntimeMenu,
} from "@/lib/telephony/ivrRuntime";
import {
  buildClinicMainMenuXml,
  buildEffectiveClinicMainMenuXml,
} from "@/lib/telephony/plivo";

const INPUT_URL = "https://voice.example/api/webhooks/plivo/input";

function customMenu() {
  return compileCustomClinicIvrRuntimeMenu("A & B Clinic", {
    greetingTemplate: "Thank you for calling {clinicName}.",
    language: "en-GB",
    voice: "MAN",
    items: [
      {
        digit: 4,
        label: "care & information",
        action: "CLINIC_INFORMATION",
        position: 1,
        enabled: true,
      },
      {
        digit: 2,
        label: "appointment booking",
        action: "APPOINTMENT_BOOKING",
        position: 0,
        enabled: true,
      },
    ],
  });
}

describe("runtime clinic main-menu Plivo XML", () => {
  it("uses the exact legacy XML path for default clinics", () => {
    const runtimeMenu = defaultClinicIvrRuntimeMenu("Sunrise Clinic");
    expect(
      buildEffectiveClinicMainMenuXml({
        inputActionUrl: INPUT_URL,
        clinicName: "Sunrise Clinic",
        runtimeMenu,
      }),
    ).toBe(buildClinicMainMenuXml(INPUT_URL, "Sunrise Clinic"));
  });

  it("applies custom voice/language only to the custom top-level prompt", () => {
    const menu = customMenu();
    const xml = buildEffectiveClinicMainMenuXml({
      inputActionUrl: INPUT_URL,
      clinicName: "A & B Clinic",
      runtimeMenu: menu,
    });

    expect(xml).toContain('numDigits="1"');
    expect(xml).toContain('inputType="dtmf"');
    expect(xml).toContain(`ivrRev=${menu.revision}`);
    expect(xml).toContain('language="en-GB"');
    expect(xml).toContain('voice="MAN"');
    expect(xml).toContain("Thank you for calling A &amp; B Clinic.");
    expect(xml).toContain("Press 2 for appointment booking.");
    expect(xml).toContain("Press 4 for care &amp; information.");
    expect(xml.indexOf("Press 2")).toBeLessThan(xml.indexOf("Press 4"));
    expect(xml).toContain("Press 9 to repeat these options.");
  });

  it("keeps leading system messages on the existing default Speak behavior", () => {
    const menu = customMenu();
    const xml = buildEffectiveClinicMainMenuXml({
      message: "Our phone menu has just changed.",
      inputActionUrl: INPUT_URL,
      clinicName: "A & B Clinic",
      runtimeMenu: menu,
    });

    expect(xml).toContain(
      "<Speak>Our phone menu has just changed.</Speak><GetInput",
    );
    expect(xml.match(/language="en-GB"/g)).toHaveLength(1);
    expect(xml.match(/voice="MAN"/g)).toHaveLength(1);
  });
});
