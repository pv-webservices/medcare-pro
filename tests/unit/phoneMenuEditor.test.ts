import { describe, expect, it } from "vitest";
import {
  CLINIC_IVR_BUSINESS_DIGITS,
  CLINIC_IVR_GREETING_MAX_LENGTH,
  CLINIC_IVR_MENU_ACTIONS,
  DEFAULT_CLINIC_IVR_GREETING_TEMPLATE,
  DEFAULT_CLINIC_IVR_ITEMS,
  PLIVO_SPEAK_LANGUAGES,
  replaceClinicIvrProfileSchema,
} from "@/lib/telephony/ivrProfileContract";
import {
  PHONE_MENU_ACTION_LABELS,
  addPhoneMenuItem,
  buildPhoneMenuPreview,
  canAddPhoneMenuItem,
  changePhoneMenuLanguage,
  isPhoneMenuDraftDirty,
  movePhoneMenuItem,
  phoneMenuPutPayload,
  profileToPhoneMenuDraft,
  removePhoneMenuItem,
  updatePhoneMenuItem,
  validatePhoneMenuDraft,
  type PhoneMenuProfile,
} from "@/lib/telephony/phoneMenuEditor";

function profile(overrides: Partial<PhoneMenuProfile> = {}): PhoneMenuProfile {
  return {
    clinicId: "clinic-a",
    source: "default",
    greetingTemplate: DEFAULT_CLINIC_IVR_GREETING_TEMPLATE,
    language: "en-US",
    voice: "WOMAN",
    items: DEFAULT_CLINIC_IVR_ITEMS,
    updatedAt: null,
    ...overrides,
  };
}

describe("Phone menu editor domain", () => {
  it("hydrates the virtual default from the shared production definition", () => {
    const draft = profileToPhoneMenuDraft(profile());
    expect(draft.greetingTemplate).toBe("Welcome to {clinicName}.");
    expect(draft.items.map((item) => [item.digit, item.action])).toEqual([
      [1, "TOMORROW_SLOTS"],
      [2, "APPOINTMENT_BOOKING"],
      [3, "URGENT_ASSISTANCE"],
      [4, "CLINIC_INFORMATION"],
    ]);
    expect(draft.items.every((item) => item.enabled)).toBe(true);
  });

  it("hydrates a custom greeting, language, voice and rows exactly", () => {
    const custom = profile({
      source: "custom",
      greetingTemplate: "Thank you for calling {clinicName}.",
      language: "en-GB",
      voice: "MAN",
      items: [
        { digit: 7, label: "urgent help", action: "URGENT_ASSISTANCE", position: 1, enabled: false },
        { digit: 2, label: "appointments", action: "APPOINTMENT_BOOKING", position: 0, enabled: true },
      ],
      updatedAt: "2026-09-02T08:00:00.000Z",
    });
    expect(profileToPhoneMenuDraft(custom)).toEqual({
      greetingTemplate: custom.greetingTemplate,
      language: "en-GB",
      voice: "MAN",
      items: [
        { digit: 2, label: "appointments", action: "APPOINTMENT_BOOKING", position: 0, enabled: true },
        { digit: 7, label: "urgent help", action: "URGENT_ASSISTANCE", position: 1, enabled: false },
      ],
    });
  });

  it("substitutes clinic name in preview without changing the saved template", () => {
    const draft = profileToPhoneMenuDraft(profile());
    expect(buildPhoneMenuPreview(draft, "Sharma Clinic").greeting).toBe(
      "Welcome to Sharma Clinic.",
    );
    expect(draft.greetingTemplate).toBe("Welcome to {clinicName}.");
  });

  it.each([
    ["unsupported placeholder", "Welcome {patientName}."],
    ["markup", "Welcome <speak>{clinicName}</speak>."],
    ["control character", "Welcome\n{clinicName}."],
    ["too long", "x".repeat(CLINIC_IVR_GREETING_MAX_LENGTH + 1)],
  ])("rejects invalid greeting content: %s", (_name, greetingTemplate) => {
    const draft = {
      ...profileToPhoneMenuDraft(profile()),
      greetingTemplate,
    };
    expect(validatePhoneMenuDraft(draft).valid).toBe(false);
  });

  it("keeps business digits closed to 1 through 7", () => {
    expect(CLINIC_IVR_BUSINESS_DIGITS).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const digit of [0, 8, 9, 10]) {
      const draft = updatePhoneMenuItem(profileToPhoneMenuDraft(profile()), 0, { digit });
      expect(validatePhoneMenuDraft(draft).valid).toBe(false);
    }
  });

  it("rejects duplicate digits and keeps 8 out of the top-level preview", () => {
    let draft = profileToPhoneMenuDraft(profile());
    draft = updatePhoneMenuItem(draft, 1, { digit: 1 });
    expect(validatePhoneMenuDraft(draft).formError).toContain("unique digit");
    expect(buildPhoneMenuPreview(profileToPhoneMenuDraft(profile()), "Clinic").options.join(" ")).not.toContain("Press 8");
  });

  it("exposes exactly four friendly labels over the closed stored actions", () => {
    expect(CLINIC_IVR_MENU_ACTIONS).toEqual([
      "TOMORROW_SLOTS",
      "APPOINTMENT_BOOKING",
      "URGENT_ASSISTANCE",
      "CLINIC_INFORMATION",
    ]);
    expect(PHONE_MENU_ACTION_LABELS.APPOINTMENT_BOOKING).toBe("Book an appointment");
    expect(Object.keys(PHONE_MENU_ACTION_LABELS)).toEqual(CLINIC_IVR_MENU_ACTIONS);
  });

  it("rejects duplicate and arbitrary actions", () => {
    const base = profileToPhoneMenuDraft(profile());
    expect(
      validatePhoneMenuDraft(
        updatePhoneMenuItem(base, 1, { action: "TOMORROW_SLOTS" }),
      ).formError,
    ).toContain("unique action");
    expect(
      replaceClinicIvrProfileSchema.safeParse({
        ...base,
        items: [{ ...base.items[0], action: "CUSTOM_WEBHOOK" }],
      }).success,
    ).toBe(false);
  });

  it("omits disabled rows from preview but keeps them editable in the draft", () => {
    const draft = updatePhoneMenuItem(profileToPhoneMenuDraft(profile()), 1, {
      enabled: false,
      label: "still editable",
    });
    const preview = buildPhoneMenuPreview(draft, "Clinic");
    expect(draft.items[1]).toMatchObject({ enabled: false, label: "still editable" });
    expect(preview.options.join(" ")).not.toContain("still editable");
    expect(preview.repeat).toBe("Press 9 to repeat these options.");
  });

  it("requires at least one enabled row and at least one row", () => {
    const base = profileToPhoneMenuDraft(profile());
    const disabled = {
      ...base,
      items: base.items.map((item) => ({ ...item, enabled: false })),
    };
    expect(validatePhoneMenuDraft(disabled).formError).toContain("At least one business action");
    expect(replaceClinicIvrProfileSchema.safeParse({ ...base, items: [] }).success).toBe(false);
  });

  it("moves spoken position without changing digit or action mapping", () => {
    const base = profileToPhoneMenuDraft(profile());
    const moved = movePhoneMenuItem(base, 3, -1);
    expect(moved.items.map((item) => item.position)).toEqual([0, 1, 2, 3]);
    expect(moved.items[2]).toMatchObject({ digit: 4, action: "CLINIC_INFORMATION" });
    expect(moved.items[3]).toMatchObject({ digit: 3, action: "URGENT_ASSISTANCE" });
    expect(buildPhoneMenuPreview(moved, "Clinic").options[2]).toContain("Press 4");
  });

  it("adds only an unused action/digit and stops after all four actions", () => {
    let draft = profileToPhoneMenuDraft(
      profile({ items: [DEFAULT_CLINIC_IVR_ITEMS[0]!] }),
    );
    draft = addPhoneMenuItem(draft);
    expect(draft.items[1]).toMatchObject({ digit: 2, action: "APPOINTMENT_BOOKING" });
    draft = addPhoneMenuItem(addPhoneMenuItem(draft));
    expect(draft.items).toHaveLength(4);
    expect(canAddPhoneMenuItem(draft)).toBe(false);
    expect(addPhoneMenuItem(draft)).toBe(draft);
  });

  it("does not remove the last row and normalizes positions after removal", () => {
    const one = profileToPhoneMenuDraft(
      profile({ items: [DEFAULT_CLINIC_IVR_ITEMS[0]!] }),
    );
    expect(removePhoneMenuItem(one, 0)).toBe(one);
    const removed = removePhoneMenuItem(profileToPhoneMenuDraft(profile()), 1);
    expect(removed.items.map((item) => item.position)).toEqual([0, 1, 2]);
  });

  it("switches incompatible voice deterministically when language changes", () => {
    const draft = { ...profileToPhoneMenuDraft(profile()), voice: "MAN" as const };
    expect(changePhoneMenuLanguage(draft, "hi-IN")).toMatchObject({
      language: "hi-IN",
      voice: "WOMAN",
    });
    expect(changePhoneMenuLanguage(draft, "en-GB").voice).toBe("MAN");
    expect(PLIVO_SPEAK_LANGUAGES).toContain("en-IN");
  });

  it("builds an exact full PUT payload with no scope or infrastructure ids", () => {
    const payload = phoneMenuPutPayload(profileToPhoneMenuDraft(profile()));
    expect(Object.keys(payload).sort()).toEqual([
      "greetingTemplate",
      "items",
      "language",
      "voice",
    ]);
    expect(JSON.stringify(payload)).not.toMatch(/clinicId|tenantId|profileId|provider/i);
  });

  it("tracks dirty state without mutating the canonical profile", () => {
    const canonical = profile();
    const clean = profileToPhoneMenuDraft(canonical);
    expect(isPhoneMenuDraftDirty(clean, canonical)).toBe(false);
    const changed = { ...clean, greetingTemplate: "Hello {clinicName}." };
    expect(isPhoneMenuDraftDirty(changed, canonical)).toBe(true);
    expect(canonical.greetingTemplate).toBe(DEFAULT_CLINIC_IVR_GREETING_TEMPLATE);
  });
});
