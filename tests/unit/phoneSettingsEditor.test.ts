import { describe, expect, it } from "vitest";
import type { ClinicPhoneSettingsView } from "@/lib/telephony/clinicPhoneSettingsContract";
import {
  businessHoursPayload,
  businessHoursToDraft,
  copyMondayToWeekdays,
  isBusinessHoursDirty,
  isPhoneCallSettingsDirty,
  normalizePhoneSettingPayload,
  phoneCallSettingsPayload,
  phoneSettingsToDraft,
  updateBusinessHoursDay,
  validateBusinessHoursDraft,
  validatePhoneCallSettingsDraft,
  validatePhoneSettingValue,
} from "@/lib/telephony/phoneSettingsEditor";

const SETTINGS: ClinicPhoneSettingsView = {
  clinicId: "clinic-a",
  serviceStatus: "active",
  routingMode: "AUTO",
  effectiveRoute: "RECEPTION",
  publicPhoneNumber: "+919000000002",
  receptionPhoneNumber: "+919000000003",
  urgentPhoneNumber: null,
  timezone: "Asia/Kolkata",
  phoneMenuSource: "default",
  readiness: {
    status: "ready",
    phoneService: { status: "ready", label: "Active", detail: "Active" },
    automaticHours: { status: "ready", label: "Hours", detail: "Hours" },
    reception: { status: "ready", label: "Reception", detail: "Reception" },
    urgentTransfer: { status: "ready", label: "Urgent", detail: "Urgent" },
    phoneMenu: { status: "ready", label: "Menu", detail: "Menu" },
  },
};

const HOURS = [
  { dayOfWeek: "MONDAY" as const, isClosed: false, openTime: "09:00", closeTime: "17:00" },
];

describe("Phone settings editor domain", () => {
  it("hydrates and creates an exact safe call-settings payload", () => {
    const draft = phoneSettingsToDraft(SETTINGS);
    expect(isPhoneCallSettingsDirty(draft, SETTINGS)).toBe(false);
    expect(phoneCallSettingsPayload(draft)).toEqual({
      publicPhoneNumber: "+919000000002",
      receptionPhoneNumber: "+919000000003",
      urgentPhoneNumber: null,
      timezone: "Asia/Kolkata",
    });
    expect(Object.keys(phoneCallSettingsPayload(draft)).sort()).toEqual([
      "publicPhoneNumber",
      "receptionPhoneNumber",
      "timezone",
      "urgentPhoneNumber",
    ]);
  });

  it("tracks call-setting changes and canonical empty numbers", () => {
    const draft = { ...phoneSettingsToDraft(SETTINGS), publicPhoneNumber: "" };
    expect(isPhoneCallSettingsDirty(draft, SETTINGS)).toBe(true);
    expect(phoneCallSettingsPayload(draft).publicPhoneNumber).toBeNull();
  });

  describe("Phone-number validation rules", () => {
    it("accepts valid numbers with optional single leading + up to 13 digits", () => {
      expect(validatePhoneSettingValue("+919582609956")).toBeNull();
      expect(validatePhoneSettingValue("919582609956")).toBeNull();
      expect(validatePhoneSettingValue("+919876543210")).toBeNull();
      expect(validatePhoneSettingValue("+14155550100")).toBeNull();
      expect(validatePhoneSettingValue("4155550100")).toBeNull();
      expect(validatePhoneSettingValue("+1234567890123")).toBeNull(); // 13 digits with +
      expect(validatePhoneSettingValue("1234567890123")).toBeNull(); // 13 digits without +
    });

    it("trims accidental spaces before validation and allows empty values", () => {
      expect(validatePhoneSettingValue("")).toBeNull();
      expect(validatePhoneSettingValue("   ")).toBeNull();
      expect(validatePhoneSettingValue("  +919582609956  ")).toBeNull();
      expect(validatePhoneSettingValue("  919582609956  ")).toBeNull();
    });

    it("rejects phone numbers exceeding 13 digits", () => {
      expect(validatePhoneSettingValue("+91987654321012")).toBe(
        "Phone number cannot exceed 13 digits.",
      );
      expect(validatePhoneSettingValue("91987654321012")).toBe(
        "Phone number cannot exceed 13 digits.",
      );
      expect(validatePhoneSettingValue("+12345678901234")).toBe(
        "Phone number cannot exceed 13 digits.",
      );
    });

    it("rejects letters, special characters, decimals, internal spaces, and multiple + signs", () => {
      expect(validatePhoneSettingValue("+919876abc")).toBe("Enter a valid phone number.");
      expect(validatePhoneSettingValue("919876abc")).toBe("Enter a valid phone number.");
      expect(validatePhoneSettingValue("+91-987-6543210")).toBe("Enter a valid phone number.");
      expect(validatePhoneSettingValue("(91) 9876543210")).toBe("Enter a valid phone number.");
      expect(validatePhoneSettingValue("+91 9876 543210")).toBe("Enter a valid phone number.");
      expect(validatePhoneSettingValue("98.76543210")).toBe("Enter a valid phone number.");
      expect(validatePhoneSettingValue("++919876543210")).toBe("Enter a valid phone number.");
      expect(validatePhoneSettingValue("+91+9876543210")).toBe("Enter a valid phone number.");
      expect(validatePhoneSettingValue("91+9876543210")).toBe("Enter a valid phone number.");
      expect(validatePhoneSettingValue("+")).toBe("Enter a valid phone number.");
      expect(validatePhoneSettingValue("12345")).toBe("Enter a valid phone number.");
      expect(validatePhoneSettingValue("+0123456789")).toBe("Enter a valid phone number.");
    });

    it("normalizes phone numbers for save payload", () => {
      expect(normalizePhoneSettingPayload("")).toBeNull();
      expect(normalizePhoneSettingPayload("   ")).toBeNull();
      expect(normalizePhoneSettingPayload("+919582609956")).toBe("+919582609956");
      expect(normalizePhoneSettingPayload("  +919582609956  ")).toBe("+919582609956");
      expect(normalizePhoneSettingPayload("919582609956")).toBe("+919582609956");
    });

    it("validates draft across all three phone fields consistently", () => {
      const invalidDraft = {
        publicPhoneNumber: "invalid-phone",
        receptionPhoneNumber: "+123456789012345",
        urgentPhoneNumber: "123",
        timezone: "Asia/Kolkata",
      };
      const result = validatePhoneCallSettingsDraft(invalidDraft);
      expect(result.valid).toBe(false);
      expect(result.errors.publicPhoneNumber).toBe("Enter a valid phone number.");
      expect(result.errors.receptionPhoneNumber).toBe(
        "Phone number cannot exceed 13 digits.",
      );
      expect(result.errors.urgentPhoneNumber).toBe("Enter a valid phone number.");
    });

    it("clears errors immediately when draft values become valid", () => {
      const validDraft = {
        publicPhoneNumber: "+919582609956",
        receptionPhoneNumber: "919599143235",
        urgentPhoneNumber: "+919876543210",
        timezone: "Asia/Kolkata",
      };
      const result = validatePhoneCallSettingsDraft(validDraft);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual({});
    });
  });

  it("hydrates exactly seven weekdays and canonicalizes closed times", () => {
    const draft = businessHoursToDraft(HOURS);
    expect(draft).toHaveLength(7);
    expect(new Set(draft.map((day) => day.dayOfWeek)).size).toBe(7);
    expect(businessHoursPayload(draft).hours[1]).toMatchObject({
      dayOfWeek: "TUESDAY",
      isClosed: true,
      openTime: null,
      closeTime: null,
    });
    expect(isBusinessHoursDirty(draft, HOURS)).toBe(false);
  });

  it("requires open and close times and rejects overnight schedules", () => {
    let draft = businessHoursToDraft([]);
    draft = updateBusinessHoursDay(draft, "MONDAY", {
      isClosed: false,
      openTime: "18:00",
      closeTime: "09:00",
    });
    expect(validateBusinessHoursDraft(draft)).toMatchObject({ valid: false });
    draft = updateBusinessHoursDay(draft, "MONDAY", { openTime: "" });
    expect(validateBusinessHoursDraft(draft)).toMatchObject({ valid: false });
  });

  it("copies Monday only to Tuesday through Friday", () => {
    let draft = businessHoursToDraft([]);
    draft = updateBusinessHoursDay(draft, "MONDAY", {
      isClosed: false,
      openTime: "08:30",
      closeTime: "16:30",
    });
    const copied = copyMondayToWeekdays(draft);
    expect(copied.slice(1, 5).every((day) => !day.isClosed && day.openTime === "08:30")).toBe(true);
    expect(copied[5].isClosed).toBe(true);
    expect(copied[6].isClosed).toBe(true);
  });
});

