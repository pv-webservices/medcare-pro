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
 * that day"send the front desk to two different places, and a bare"no slots"
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
    <div className="rounded-2xl border border-dashed border-line bg-canvas-deep/60 px-5 py-8 text-center">
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
        <p role="alert" className="text-body font-semibold text-alert-ink">
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
          className="mx-auto h-5 w-5 animate-spin text-faint"
        />
        <p className="mt-2 text-body text-muted">Checking what is free…</p>
      </Frame>
    );
  }

  if (!result) {
    return (
      <Frame>
        <p className="text-body text-muted">
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
          className="mx-auto h-5 w-5 text-faint"
        />
        <p className="mt-2 font-semibold text-ink">{message.title}</p>
        <p className="mt-1 text-body text-muted">{message.guidance}</p>
      </Frame>
    );
  }

  const free = result.slots.filter((slot) => slot.status === "available").length;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2.5">
        <p className="text-body font-semibold text-ink">Available slots</p>
        <span className="text-label text-muted">
          <span className="tnum font-medium text-ink-soft">{free}</span> free today
        </span>
      </div>

      <div
        role="radiogroup"
        aria-label="Available slots"
        className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5"
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
                "h-11 rounded-xl border text-body font-semibold tnum transition-all duration-150 flex items-center justify-center",
                isTaken &&
                  "cursor-not-allowed border-line bg-canvas-deep/80 text-faint line-through opacity-60",
                !isTaken &&
                  !isChosen &&
                  "border-line bg-canvas text-ink shadow-sm hover:border-accent hover:text-accent hover:shadow-card",
                isChosen &&
                  "border-accent bg-accent text-accent-ink shadow-cta font-bold",
              )}
            >
              {slot.start}
              <span className="sr-only">
                {isTaken ? "— already booked" : ""}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
