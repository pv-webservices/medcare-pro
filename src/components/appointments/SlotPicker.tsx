"use client";

import { CalendarOff, Loader2 } from "lucide-react";
import { cx } from "@/components/ui/cx";
import type {
  AppointmentSlotView,
  AppointmentSlotsResult,
} from "@/lib/appointments";
import type { SlotOutcome } from "@/lib/appointmentSlots";

/**
 * The grid of times a doctor has free on one day — AP-6, over AP-2's engine.
 *
 * A GRID OF BUTTONS, NOT A DROPDOWN. The desk is comparing what is free against
 * what the patient can make, and a select hides every option but one. Taken
 * slots stay on screen, disabled: "10:00 is gone" is the answer to the question
 * being asked, and removing them would make a full morning look like a short
 * one.
 *
 * WHY A DAY IS EMPTY IS SAID IN WORDS. AP-2 returns an outcome alongside the
 * slots for exactly this — "the doctor is on leave" and "nobody set up hours for
 * that day" send the front desk to two different places, and a bare "no slots"
 * sends them to neither.
 */

interface SlotPickerProps {
  /** null before a doctor, service and date have all been chosen. */
  result: AppointmentSlotsResult | null;
  isLoading: boolean;
  error: string | null;
  /** "HH:mm" of the chosen slot, or "" for none yet. */
  selected: string;
  onSelect: (slot: AppointmentSlotView) => void;
}

const OUTCOME_MESSAGE: Record<SlotOutcome, { title: string; guidance: string }> = {
  ok: { title: "", guidance: "" },
  "on-leave": {
    title: "This doctor is on leave that day.",
    guidance: "Pick another date, or another doctor.",
  },
  "no-availability": {
    title: "No hours are set for this doctor on that day.",
    guidance:
      "Add availability on the doctor's page, or choose a day they already work.",
  },
  "invalid-duration": {
    title: "This service has an unusable length.",
    guidance:
      "An admin needs to correct its duration before it can be booked.",
  },
  "invalid-date": {
    title: "That is not a date this can be booked on.",
    guidance: "Choose a real calendar day.",
  },
};

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-5 py-8 text-center">
      {children}
    </div>
  );
}

export default function SlotPicker({
  result,
  isLoading,
  error,
  selected,
  onSelect,
}: SlotPickerProps) {
  if (error) {
    return (
      <Frame>
        <p role="alert" className="text-sm font-semibold text-red-600">
          {error}
        </p>
      </Frame>
    );
  }

  if (isLoading) {
    return (
      <Frame>
        <Loader2
          aria-hidden="true"
          strokeWidth={1.75}
          className="mx-auto h-5 w-5 animate-spin text-slate-400"
        />
        <p className="mt-2 text-sm text-slate-500">Checking what is free…</p>
      </Frame>
    );
  }

  if (!result) {
    return (
      <Frame>
        <p className="text-sm text-slate-500">
          Choose a doctor, a service and a date to see what is free.
        </p>
      </Frame>
    );
  }

  if (result.outcome !== "ok" || result.slots.length === 0) {
    const message =
      result.outcome === "ok"
        ? {
            title: "Every slot that day is taken.",
            guidance: "Try another date, or another doctor.",
          }
        : OUTCOME_MESSAGE[result.outcome];

    return (
      <Frame>
        <CalendarOff
          aria-hidden="true"
          strokeWidth={1.75}
          className="mx-auto h-5 w-5 text-slate-400"
        />
        <p className="mt-2 font-semibold text-slate-900">{message.title}</p>
        <p className="mt-1 text-sm text-slate-500">{message.guidance}</p>
      </Frame>
    );
  }

  const free = result.slots.filter((slot) => slot.status === "available").length;

  return (
    <div>
      <p className="mb-3 text-sm text-slate-500">
        <span className="font-bold tabular-nums text-slate-900">{free}</span>{" "}
        {free === 1 ? "slot" : "slots"} free of{" "}
        <span className="tabular-nums">{result.slots.length}</span>, at{" "}
        <span className="tabular-nums">{result.durationMinutes}</span> minutes
        each.
      </p>

      <div
        role="radiogroup"
        aria-label="Available slots"
        className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6"
      >
        {result.slots.map((slot) => {
          const isTaken = slot.status === "booked";
          const isChosen = !isTaken && slot.start === selected;

          return (
            <button
              key={slot.start}
              type="button"
              role="radio"
              aria-checked={isChosen}
              disabled={isTaken}
              onClick={() => onSelect(slot)}
              className={cx(
                "min-h-11 rounded-xl border px-2 text-sm font-semibold tabular-nums transition-colors",
                isTaken &&
                  "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400 line-through",
                !isTaken &&
                  !isChosen &&
                  "border-slate-200 bg-white text-slate-700 shadow-sm hover:border-primary hover:text-primary",
                isChosen &&
                  "border-primary bg-primary text-primary-foreground shadow-sm",
              )}
            >
              {slot.start}
              <span className="sr-only">
                {isTaken ? " — already booked" : ""}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
