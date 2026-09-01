import { describe, expect, it } from "vitest";
import {
  CLINIC_IVR_MAX_MENU_ITEMS,
  DEFAULT_CLINIC_IVR_ITEMS,
  PLIVO_SPEAK_LANGUAGES,
  PLIVO_SPEAK_LANGUAGE_VOICES,
  defaultClinicIvrProfile,
  renderClinicIvrGreeting,
  replaceClinicIvrProfileSchema,
} from "@/lib/telephony/ivrProfile";
import {
  MAIN_MENU_ROUTES,
  resolveMainMenuAction,
} from "@/lib/telephony/routing";
import { buildMainMenuPrompt } from "@/lib/telephony/ivr";

function validProfile() {
  return {
    greetingTemplate: "Thank you for calling {clinicName}.",
    language: "en-US",
    voice: "WOMAN",
    items: [
      {
        digit: 1,
        label: "tomorrow slots",
        action: "TOMORROW_SLOTS",
        position: 0,
        enabled: true,
      },
      {
        digit: 3,
        label: "urgent assistance",
        action: "URGENT_ASSISTANCE",
        position: 1,
        enabled: true,
      },
    ],
  };
}

describe("clinic IVR virtual defaults", () => {
  it("matches the current deterministic business menu without persisting repeat", () => {
    const profile = defaultClinicIvrProfile("clinic-a");
    const runtimeActions = {
      TOMORROW_SLOTS: "tomorrow-slots",
      APPOINTMENT_BOOKING: "appointment-booking",
      URGENT_ASSISTANCE: "urgent-assistance",
      CLINIC_INFORMATION: "clinic-information",
    } as const;

    expect(profile).toMatchObject({
      clinicId: "clinic-a",
      source: "default",
      greetingTemplate: "Welcome to {clinicName}.",
      language: "en-US",
      voice: "WOMAN",
      updatedAt: null,
    });
    expect(profile.items).toEqual(DEFAULT_CLINIC_IVR_ITEMS);
    expect(
      profile.items.map((item) => [
        String(item.digit),
        runtimeActions[item.action],
      ]),
    ).toEqual([
      ["1", MAIN_MENU_ROUTES["1"].action],
      ["2", MAIN_MENU_ROUTES["2"].action],
      ["3", MAIN_MENU_ROUTES["3"].action],
      ["4", MAIN_MENU_ROUTES["4"].action],
    ]);
    expect(profile.items.some((item) => item.digit === 9)).toBe(false);
    expect(resolveMainMenuAction("9")).toBe("repeat-menu");
  });

  it("keeps the production prompt and dispatch unchanged", () => {
    expect(buildMainMenuPrompt("MedCare Clinic")).toBe(
      "Welcome to MedCare Clinic. Press 1 for tomorrow slots. " +
        "Press 2 for appointment booking. Press 3 for urgent assistance. " +
        "Press 4 for clinic information. Press 9 to repeat these options.",
    );
    expect(Object.keys(MAIN_MENU_ROUTES)).toEqual(["1", "2", "3", "4", "9"]);
  });

  it("renders only the documented clinic-name placeholder as plain text", () => {
    expect(
      renderClinicIvrGreeting(
        "Thank you for calling {clinicName}.",
        "  Sunrise   Clinic ",
      ),
    ).toBe("Thank you for calling Sunrise Clinic.");
  });
});

describe("clinic IVR profile validation", () => {
  it("accepts and canonicalizes a valid complete profile", () => {
    const input = validProfile();
    input.items.reverse();
    const parsed = replaceClinicIvrProfileSchema.parse(input);
    expect(parsed.items.map((item) => item.position)).toEqual([0, 1]);
  });

  it.each([
    ["digit", { ...validProfile().items[1], digit: 1 }],
    ["action", { ...validProfile().items[1], action: "TOMORROW_SLOTS" }],
    ["position", { ...validProfile().items[1], position: 0 }],
  ])("rejects a duplicate %s", (_field, second) => {
    const input = validProfile();
    input.items[1] = second;
    expect(replaceClinicIvrProfileSchema.safeParse(input).success).toBe(false);
  });

  it.each([0, 8, 9, 10, 12, -1])("rejects reserved or invalid digit %s", (digit) => {
    const input = validProfile();
    input.items[0].digit = digit;
    expect(replaceClinicIvrProfileSchema.safeParse(input).success).toBe(false);
  });

  it("rejects an unknown action", () => {
    const input = validProfile();
    input.items[0].action = "ARBITRARY_WEBHOOK";
    expect(replaceClinicIvrProfileSchema.safeParse(input).success).toBe(false);
  });

  it.each(["tenantId", "clinicId", "profileId", "unknownField"])(
    "rejects attacker-controlled or unknown body field %s",
    (field) => {
      expect(
        replaceClinicIvrProfileSchema.safeParse({
          ...validProfile(),
          [field]: "attacker-value",
        }).success,
      ).toBe(false);
    },
  );

  it.each([
    ["empty", "   "],
    ["unknown placeholder", "Welcome {patientName}."],
    ["malformed placeholder", "Welcome {clinicName."],
    ["SSML", "<prosody rate='fast'>Welcome</prosody>"],
    ["HTML", "<strong>Welcome</strong>"],
    ["control character", "Welcome\n{clinicName}."],
  ])("rejects %s greeting text", (_case, greetingTemplate) => {
    expect(
      replaceClinicIvrProfileSchema.safeParse({
        ...validProfile(),
        greetingTemplate,
      }).success,
    ).toBe(false);
  });

  it.each([
    ["empty", "   "],
    ["markup", "<speak>appointments</speak>"],
    ["control character", "appointments\tplease"],
  ])("rejects a %s menu label", (_case, label) => {
    const input = validProfile();
    input.items[0].label = label;
    expect(replaceClinicIvrProfileSchema.safeParse(input).success).toBe(false);
  });

  it("rejects an empty menu and a menu with no enabled actions", () => {
    expect(
      replaceClinicIvrProfileSchema.safeParse({
        ...validProfile(),
        items: [],
      }).success,
    ).toBe(false);
    expect(
      replaceClinicIvrProfileSchema.safeParse({
        ...validProfile(),
        items: validProfile().items.map((item) => ({ ...item, enabled: false })),
      }).success,
    ).toBe(false);
  });

  it("rejects more menu items than the seven available business digits", () => {
    const base = validProfile().items[0];
    const items = Array.from({ length: CLINIC_IVR_MAX_MENU_ITEMS + 1 }, (_, index) => ({
      ...base,
      digit: index + 1,
      position: index,
    }));
    expect(
      replaceClinicIvrProfileSchema.safeParse({ ...validProfile(), items }).success,
    ).toBe(false);
  });

  it("accepts only documented Speak languages and compatible voices", () => {
    expect(PLIVO_SPEAK_LANGUAGES).toContain("en-US");
    expect(PLIVO_SPEAK_LANGUAGE_VOICES["en-IN"]).toEqual(["WOMAN"]);
    expect(
      replaceClinicIvrProfileSchema.safeParse({
        ...validProfile(),
        language: "en-IN",
        voice: "MAN",
      }).success,
    ).toBe(false);
    expect(
      replaceClinicIvrProfileSchema.safeParse({
        ...validProfile(),
        language: "unsupported",
      }).success,
    ).toBe(false);
    expect(
      replaceClinicIvrProfileSchema.safeParse({
        ...validProfile(),
        voice: "Polly.Arbitrary",
      }).success,
    ).toBe(false);
  });
});
