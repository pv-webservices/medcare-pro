import { describe, expect, it } from "vitest";
import type { ClinicPhoneSettingsView } from "@/lib/telephony/clinicPhoneSettingsContract";
import {
  businessHoursPayload,
  businessHoursToDraft,
  copyMondayToWeekdays,
  isBusinessHoursDirty,
  isPhoneCallSettingsDirty,
  phoneCallSettingsPayload,
  phoneSettingsToDraft,
  updateBusinessHoursDay,
  validateBusinessHoursDraft,
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

