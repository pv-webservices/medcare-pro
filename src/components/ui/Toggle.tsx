"use client";

import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";

/**
 * An on/off switch for a setting that applies immediately — a feature module, a
 * permission, a notification preference.
 *
 * A REAL CHECKBOX UNDERNEATH. The visible switch is a styled `<span>`, but the
 * control the browser and the screen reader see is an `<input type="checkbox">`
 * covering the same box: it is focusable, it toggles with Space, it is
 * announced with its state and its label, and it submits inside a form. A
 * `<div>` with `role="switch"` and an onClick would need every one of those
 * rebuilt by hand, and would still lose in forced-colours mode.
 *
 * `description` is part of the label, not a sibling paragraph, so a screen
 * reader hears what the setting does rather than just its name.
 */

interface ToggleProps {
  id: string;
  label: string;
  description?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Explains why the control is unavailable — shown in place of nothing. */
  disabledReason?: string;
  name?: string;
  className?: string;
}

export default function Toggle({
  id,
  label,
  description,
  checked,
  onChange,
  disabled = false,
  disabledReason,
  name,
  className,
}: ToggleProps) {
  return (
    <div className={cx("flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <label
          htmlFor={id}
          className={cx(
            "block text-body font-medium",
            disabled ? "text-muted" : "text-ink",
          )}
        >
          {label}
        </label>
        {description && (
          <p className="mt-0.5 text-label text-muted">{description}</p>
        )}
        {disabled && disabledReason && (
          <p className="mt-1 text-meta text-muted">{disabledReason}</p>
        )}
      </div>

      <span className="relative inline-flex h-6 w-11 shrink-0 items-center">
        <input
          id={id}
          name={name}
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
        <span
          aria-hidden="true"
          className={cx(
            "block h-6 w-11 rounded-full transition-colors duration-150",
            "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent",
            checked ? "bg-accent" : "bg-line-strong",
            disabled && "opacity-50",
          )}
        />
        <span
          aria-hidden="true"
          className={cx(
            "pointer-events-none absolute top-1 h-4 w-4 rounded-full bg-canvas shadow-card transition-[left] duration-150",
            checked ? "left-6" : "left-1",
          )}
        />
      </span>
    </div>
  );
}
