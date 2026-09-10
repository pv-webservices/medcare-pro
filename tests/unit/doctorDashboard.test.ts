import { describe, expect, it } from "vitest";
import {
  chooseNextDoctorAppointment,
  orderCompleteDoctorDay,
} from "@/lib/doctorDashboard";
import {
  appointmentDayBounds,
  appointmentWallClockNow,
} from "@/lib/dates";
import type { AppointmentStatus } from "@/lib/appointmentRules";

function row(
  id: string,
  time: string,
  status: AppointmentStatus,
  checkedInAt: Date | null = null,
) {
  return {
    id,
    slotStart: new Date(`2026-09-10T${time}:00.000Z`),
    status,
    checkedInAt,
  };
}

describe("doctor My Day schedule", () => {
  it("uses clinic wall-clock now instead of the real UTC instant", () => {
    const localThreePm = new Date(2026, 8, 10, 15, 0, 0);
    const now = appointmentWallClockNow(localThreePm);
    expect(now.toISOString()).toBe("2026-09-10T15:00:00.000Z");
    expect(row("past", "12:00", "SCHEDULED").slotStart < now).toBe(true);
    expect(row("future", "15:30", "SCHEDULED").slotStart > now).toBe(true);
  });

  it("builds half-open bounds for the complete operational day", () => {
    const bounds = appointmentDayBounds(new Date(2026, 8, 10, 15, 0));
    expect(bounds.start.toISOString()).toBe("2026-09-10T00:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2026-09-11T00:00:00.000Z");
  });

  it("keeps and orders more than ten rows without truncating history statuses", () => {
    const statuses: AppointmentStatus[] = [
      "SCHEDULED", "CONFIRMED", "CHECKED_IN", "CONVERTED",
      "CANCELLED", "NO_SHOW", "RESCHEDULED",
    ];
    const rows = Array.from({ length: 12 }, (_, index) =>
      row(`appointment-${index}`, `${String(8 + Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}`, statuses[index % statuses.length]),
    ).reverse();
    const ordered = orderCompleteDoctorDay(rows);
    expect(ordered).toHaveLength(12);
    expect(ordered.map((item) => item.status)).toEqual(
      Array.from({ length: 12 }, (_, index) => statuses[index % statuses.length]),
    );
  });

  it("prioritises the earliest checked-in patient over a future booking", () => {
    const waiting = row("waiting", "14:00", "CHECKED_IN", new Date("2026-09-10T14:02:00.000Z"));
    const next = row("next", "15:30", "CONFIRMED");
    expect(
      chooseNextDoctorAppointment([next, waiting], new Date("2026-09-10T15:00:00.000Z"))?.id,
    ).toBe("waiting");
  });

  it("ignores cancelled, no-show, and rescheduled rows when choosing next", () => {
    const now = new Date("2026-09-10T15:00:00.000Z");
    const selected = chooseNextDoctorAppointment([
      row("cancelled", "15:05", "CANCELLED"),
      row("no-show", "15:10", "NO_SHOW"),
      row("rescheduled", "15:15", "RESCHEDULED"),
      row("confirmed", "15:30", "CONFIRMED"),
    ], now);
    expect(selected?.id).toBe("confirmed");
  });
});
