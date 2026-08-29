"use client";

import { CalendarSync } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import SlotPicker from "@/components/appointments/SlotPicker";
import Button from "@/components/ui/Button";
import Input, { Textarea } from "@/components/ui/Input";
import Panel from "@/components/ui/Panel";
import Select from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import type {
  AppointmentSlotView,
  AppointmentSlotsResult,
} from "@/lib/appointments";

/**
 * Moving an appointment to another slot — AP-6, over AP-4's reschedule.
 *
 * A FORM, NOT A BUTTON, which is why rescheduling is the one lifecycle action
 * that lives here rather than on the board's action strip: a move needs a date,
 * possibly a different doctor, and a slot chosen from what is actually free.
 *
 * WHAT A MOVE DOES, said plainly on screen because the record shape surprises
 * people: the original row is KEPT and marked as moved, and a NEW appointment
 * is created pointing back at it. Nothing is edited in place and nothing is
 * deleted, so the history of a booking that moved three times is still
 * readable. The desk is told this rather than left to discover it when the old
 * row stays on the board under "show past outcomes".
 *
 * The service cannot change — a different service is a different length and a
 * different price, which is a new booking, not a move. Only the doctor, the day
 * and the time are open.
 */

export interface RescheduleDoctorOption {
  id: string;
  name: string;
  department: string;
}

interface RescheduleFormProps {
  appointmentId: string;
  clinicId: string;
  appointmentTypeId: string;
  appointmentTypeName: string;
  /** Where it sits now, so the form opens on the day it is being moved from. */
  currentDoctorId: string;
  currentDate: string;
  doctors: readonly RescheduleDoctorOption[];
}

export default function RescheduleForm({
  appointmentId,
  clinicId,
  appointmentTypeId,
  appointmentTypeName,
  currentDoctorId,
  currentDate,
  doctors,
}: RescheduleFormProps) {
  const router = useRouter();
  const showToast = useToast();

  const [doctorId, setDoctorId] = useState(currentDoctorId);
  const [date, setDate] = useState(currentDate);
  const [slotStart, setSlotStart] = useState("");
  const [slotEnd, setSlotEnd] = useState("");
  const [reason, setReason] = useState("");

  /** Keyed by its query — see the note on the same guard in BookingForm. */
  const [loaded, setLoaded] = useState<{
    key: string;
    data: AppointmentSlotsResult;
  } | null>(null);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [slotError, setSlotError] = useState<string | null>(null);
  const [slotNonce, setSlotNonce] = useState(0);

  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const slotKey = `${clinicId}|${doctorId}|${appointmentTypeId}|${date}|${slotNonce}`;
  const slots = loaded?.key === slotKey ? loaded.data : null;

  useEffect(() => {
    if (!doctorId || !date) {
      return;
    }

    const controller = new AbortController();

    (async () => {
      setIsLoadingSlots(true);
      setSlotError(null);

      const query = new URLSearchParams({
        clinicId,
        doctorId,
        appointmentTypeId,
        date,
      });

      try {
        const response = await fetch(`/api/appointments/slots?${query}`, {
          signal: controller.signal,
        });
        const payload: {
          success?: boolean;
          data?: AppointmentSlotsResult;
          error?: string;
        } = await response.json().catch(() => ({}));

        if (!response.ok || !payload.success || !payload.data) {
          setSlotError(payload.error ?? "Could not load slots for that day.");
          return;
        }

        setLoaded({ key: slotKey, data: payload.data });
      } catch (error: unknown) {
        if ((error as { name?: string }).name === "AbortError") return;
        setSlotError("Could not reach the server. Check your connection.");
      } finally {
        setIsLoadingSlots(false);
      }
    })();

    return () => controller.abort();
  }, [slotKey, clinicId, doctorId, appointmentTypeId, date]);

  function handleSlot(slot: AppointmentSlotView) {
    setSlotStart(slot.start);
    setSlotEnd(slot.end);
    setFormError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (!slotStart) {
      setFormError("Choose the slot to move this appointment to.");
      return;
    }

    setIsSaving(true);

    try {
      const response = await fetch(
        `/api/appointments/${appointmentId}/reschedule`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            // Only sent when it actually changed, so an unchanged doctor is not
            // presented to the server as a move between doctors.
            ...(doctorId === currentDoctorId ? {} : { doctorId }),
            slotStart: `${date}T${slotStart}:00.000Z`,
            slotEnd: `${date}T${slotEnd}:00.000Z`,
            reason: reason.trim() === "" ? undefined : reason.trim(),
          }),
        },
      );

      const payload: {
        success?: boolean;
        error?: string;
        data?: { appointment: { id: string } };
      } = await response.json().catch(() => ({}));

      if (!response.ok || !payload.success || !payload.data) {
        setFormError(payload.error ?? "Could not move that appointment.");
        // Very likely the slot went while this was open — reload the grid so
        // the desk is choosing from what is free now.
        setSlotStart("");
        setSlotEnd("");
        setSlotNonce((n) => n + 1);
        return;
      }

      showToast({
        tone: "ok",
        title: "Appointment moved.",
        detail: `Now at ${slotStart}. The original is kept and marked as moved.`,
      });
      router.push(`/appointments/${payload.data.appointment.id}`);
      router.refresh();
    } catch {
      setFormError("Could not reach the server. Check your connection.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      {formError && (
        <p
          role="alert"
          className="mb-4 rounded-xl bg-alert-bg px-4 py-3 text-body font-medium text-alert-ink"
        >
          {formError}
        </p>
      )}

      <div className="grid gap-5 sm:grid-cols-1">
        <Select
          id="reschedule-doctor"
          label="Doctor"
          hint="Leave as-is to keep the same doctor."
          value={doctorId}
          onChange={(e) => {
            setDoctorId(e.target.value);
            setSlotStart("");
            setSlotEnd("");
          }}
        >
          {doctors.map((doctor) => (
            <option key={doctor.id} value={doctor.id}>
              {doctor.name}
            </option>
          ))}
        </Select>

        <Input
          id="reschedule-date"
          type="date"
          label="New date"
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            setSlotStart("");
            setSlotEnd("");
          }}
        />
      </div>

      <div className="mt-5 pt-4 border-t border-line">
        <SlotPicker
          result={slots}
          isLoading={isLoadingSlots}
          error={slotError}
          selected={slotStart}
          onSelect={handleSlot}
        />
      </div>

      <Textarea
        id="reschedule-reason"
        label="Reason"
        hint="Optional. Recorded in the audit trail."
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        fieldClassName="mt-5"
      />

      <div className="mt-6 pt-5 border-t border-line">
        <Button
          type="submit"
          variant="primary"
          className="w-full"
          isBusy={isSaving}
          busyLabel="Moving…"
        >
          <CalendarSync aria-hidden="true" strokeWidth={1.75} className="mr-2 h-4 w-4" />
          Move Appointment
        </Button>
      </div>
    </form>
  );
}
