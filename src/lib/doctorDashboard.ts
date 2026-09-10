import type { AppointmentStatus } from "@/lib/appointmentRules";

interface OperationalAppointmentRow {
  id: string;
  slotStart: Date;
  status: AppointmentStatus;
  checkedInAt: Date | null;
}

const ACTIVE = new Set<AppointmentStatus>([
  "SCHEDULED",
  "CONFIRMED",
  "CHECKED_IN",
]);

/** Sorts the complete day deterministically and intentionally never truncates. */
export function orderCompleteDoctorDay<T extends Pick<OperationalAppointmentRow, "id" | "slotStart">>(
  rows: readonly T[],
): T[] {
  return [...rows].sort(
    (left, right) =>
      left.slotStart.getTime() - right.slotStart.getTime() ||
      left.id.localeCompare(right.id),
  );
}

/** Checked-in patients take priority; otherwise choose the nearest active slot. */
export function chooseNextDoctorAppointment<T extends OperationalAppointmentRow>(
  rows: readonly T[],
  appointmentNow: Date,
): T | null {
  const ordered = orderCompleteDoctorDay(rows);
  const waiting = ordered
    .filter((row) => row.status === "CHECKED_IN")
    .sort(
      (left, right) =>
        (left.checkedInAt?.getTime() ?? left.slotStart.getTime()) -
        (right.checkedInAt?.getTime() ?? right.slotStart.getTime()),
    )[0];
  return (
    waiting ??
    ordered.find(
      (row) => row.slotStart >= appointmentNow && ACTIVE.has(row.status),
    ) ??
    null
  );
}
