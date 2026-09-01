import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMainMenuPrompt } from "@/lib/telephony/ivr";
import {
  compileCustomClinicIvrRuntimeMenu,
  defaultClinicIvrRuntimeMenu,
  getClinicIvrRuntimeMenuForTrustedClinic,
  resolveRuntimeMainMenuAction,
} from "@/lib/telephony/ivrRuntime";

function storedProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: "profile-a",
    greetingTemplate: "Thank you for calling {clinicName}.",
    language: "en-US",
    voice: "MAN",
    items: [
      {
        digit: 7,
        label: "urgent assistance",
        action: "URGENT_ASSISTANCE",
        position: 2,
        enabled: true,
      },
      {
        digit: 2,
        label: "appointment booking",
        action: "APPOINTMENT_BOOKING",
        position: 0,
        enabled: true,
      },
      {
        digit: 4,
        label: "clinic information",
        action: "CLINIC_INFORMATION",
        position: 1,
        enabled: true,
      },
      {
        digit: 1,
        label: "tomorrow slots",
        action: "TOMORROW_SLOTS",
        position: 3,
        enabled: false,
      },
    ],
    ...overrides,
  };
}

describe("clinic IVR runtime compilation", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps the exact static menu authoritative when no custom profile exists", async () => {
    const lookup = vi.fn().mockResolvedValue(null);
    const menu = await getClinicIvrRuntimeMenuForTrustedClinic(
      { clinicId: "clinic-a", clinicName: "Sunrise Clinic" },
      lookup,
    );

    expect(lookup).toHaveBeenCalledWith("clinic-a");
    expect(menu.source).toBe("default");
    expect(menu.prompt).toBe(buildMainMenuPrompt("Sunrise Clinic"));
    expect(["1", "2", "3", "4", "9"].map((digit) =>
      resolveRuntimeMainMenuAction(menu, digit),
    )).toEqual([
      "tomorrow-slots",
      "appointment-booking",
      "urgent-assistance",
      "clinic-information",
      "repeat-menu",
    ]);
    expect(resolveRuntimeMainMenuAction(menu, "8")).toBe("invalid-input");
  });

  it("compiles enabled items by position and maps only closed existing actions", () => {
    const menu = compileCustomClinicIvrRuntimeMenu(
      "Sharma Clinic",
      storedProfile(),
    );

    expect(menu.source).toBe("custom");
    expect(menu.greeting).toBe("Thank you for calling Sharma Clinic.");
    expect(menu.items.map((item) => [item.position, item.digit, item.action])).toEqual([
      [0, 2, "appointment-booking"],
      [1, 4, "clinic-information"],
      [2, 7, "urgent-assistance"],
    ]);
    expect(menu.prompt).toBe(
      "Thank you for calling Sharma Clinic. Press 2 for appointment booking. Press 4 for clinic information. Press 7 for urgent assistance. Press 9 to repeat these options.",
    );
    expect(resolveRuntimeMainMenuAction(menu, "2")).toBe(
      "appointment-booking",
    );
    expect(resolveRuntimeMainMenuAction(menu, "4")).toBe(
      "clinic-information",
    );
    expect(resolveRuntimeMainMenuAction(menu, "7")).toBe(
      "urgent-assistance",
    );
    expect(resolveRuntimeMainMenuAction(menu, "1")).toBe("invalid-input");
    expect(resolveRuntimeMainMenuAction(menu, "8")).toBe("invalid-input");
    expect(resolveRuntimeMainMenuAction(menu, "9")).toBe("repeat-menu");
  });

  it("produces a stable revision and changes it for behavior callers hear", () => {
    const baseline = compileCustomClinicIvrRuntimeMenu("Sharma Clinic", storedProfile());
    const same = compileCustomClinicIvrRuntimeMenu("Sharma Clinic", storedProfile());
    expect(same.revision).toBe(baseline.revision);
    expect(baseline.revision).toMatch(/^[a-f0-9]{32}$/);

    const variations = [
      storedProfile({ greetingTemplate: "Welcome to {clinicName}." }),
      storedProfile({ language: "en-GB" }),
      storedProfile({ voice: "WOMAN" }),
      storedProfile({
        items: storedProfile().items.map((item: Record<string, unknown>) =>
          item.digit === 2 ? { ...item, label: "book an appointment" } : item,
        ),
      }),
      storedProfile({
        items: storedProfile().items.map((item: Record<string, unknown>) =>
          item.digit === 1 ? { ...item, enabled: true } : item,
        ),
      }),
      storedProfile({
        items: storedProfile().items.map((item: Record<string, unknown>) => {
          if (item.digit === 2) return { ...item, position: 1 };
          if (item.digit === 4) return { ...item, position: 0 };
          return item;
        }),
      }),
      storedProfile({
        items: storedProfile().items.map((item: Record<string, unknown>) => {
          if (item.digit === 2) return { ...item, action: "CLINIC_INFORMATION" };
          if (item.digit === 4) return { ...item, action: "APPOINTMENT_BOOKING" };
          return item;
        }),
      }),
    ];
    for (const variation of variations) {
      expect(
        compileCustomClinicIvrRuntimeMenu("Sharma Clinic", variation).revision,
      ).not.toBe(baseline.revision);
    }
  });

  it.each([
    ["unsupported language", { language: "xx-ZZ" }],
    ["incompatible voice", { language: "hi-IN", voice: "MAN" }],
    [
      "duplicate action",
      {
        items: storedProfile().items.map((item: Record<string, unknown>) =>
          item.digit === 4 ? { ...item, action: "APPOINTMENT_BOOKING" } : item,
        ),
      },
    ],
    [
      "invalid digit",
      {
        items: storedProfile().items.map((item: Record<string, unknown>) =>
          item.digit === 7 ? { ...item, digit: 8 } : item,
        ),
      },
    ],
    [
      "zero enabled actions",
      {
        items: storedProfile().items.map((item: Record<string, unknown>) => ({
          ...item,
          enabled: false,
        })),
      },
    ],
    ["invalid greeting", { greetingTemplate: "Welcome {patientName}." }],
    [
      "unknown action",
      {
        items: storedProfile().items.map((item: Record<string, unknown>) =>
          item.digit === 7 ? { ...item, action: "RUN_WEBHOOK" } : item,
        ),
      },
    ],
    [
      "malformed label",
      {
        items: storedProfile().items.map((item: Record<string, unknown>) =>
          item.digit === 7 ? { ...item, label: "<speak>urgent</speak>" } : item,
        ),
      },
    ],
  ])("rejects the complete corrupt custom profile for %s", async (_name, override) => {
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const menu = await getClinicIvrRuntimeMenuForTrustedClinic(
      { clinicId: "clinic-a", clinicName: "Sunrise Clinic" },
      vi.fn().mockResolvedValue(storedProfile(override)),
    );

    expect(menu.source).toBe("default");
    expect(menu.prompt).toBe(buildMainMenuPrompt("Sunrise Clinic"));
    expect(diagnostic).toHaveBeenCalledWith(
      "Falling back to the static clinic IVR menu.",
      {
        clinicId: "clinic-a",
        profileId: "profile-a",
        reason: "profile-validation-failed",
      },
    );
    expect(JSON.stringify(diagnostic.mock.calls)).not.toMatch(
      /patientName|RUN_WEBHOOK|<speak>|appointment booking/i,
    );
  });

  it("falls back to static availability when the optional profile read fails", async () => {
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const menu = await getClinicIvrRuntimeMenuForTrustedClinic(
      { clinicId: "clinic-a", clinicName: "Sunrise Clinic" },
      vi.fn().mockRejectedValue(new Error("database unavailable")),
    );

    expect(menu.source).toBe("default");
    expect(diagnostic).toHaveBeenCalledWith(
      "Falling back to the static clinic IVR menu.",
      { clinicId: "clinic-a", reason: "profile-read-failed" },
    );
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain("database unavailable");
  });

  it("freezes compiled runtime state", () => {
    const menu = defaultClinicIvrRuntimeMenu("Sunrise Clinic");
    expect(Object.isFrozen(menu)).toBe(true);
    expect(Object.isFrozen(menu.items)).toBe(true);
    expect(Object.isFrozen(menu.actionByDigit)).toBe(true);
  });
});
