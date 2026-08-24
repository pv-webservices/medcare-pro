import type {
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
  SelectHTMLAttributes,
} from "react";
import { cx } from "@/components/ui/cx";

/**
 * Text fields, with their label, hint and error attached.
 *
 * A FIELD IS A WELL. Every control here is the same colour as the page and
 * carries `shadow-neu-inset`, so it reads as a recess you put something into
 * rather than an object sitting on top of one. That is the counterpart to the
 * raised button, and the pair is what makes the surface legible: raised means
 * press me, sunken means fill me.
 *
 * No borders. The inset shadow is the entire boundary, which means the FOCUS
 * RING IS LOAD-BEARING — a recess with no outline gives a keyboard user nothing
 * to locate. The global :focus-visible rule in globals.css draws it in the
 * accent; nothing here may set `outline-none`.
 *
 * The label/hint/error wiring lives in the primitive rather than at each call
 * site so `aria-describedby` and `aria-invalid` cannot be forgotten — inline
 * validation is a ground rule here, and a validation message the screen reader
 * never announces is not validation.
 *
 * Fields are 16px (`text-input`) on purpose: anything smaller makes iOS Safari
 * zoom on focus, which is intolerable on a shared front-desk tablet.
 */

const CONTROL_BASE =
  "block w-full rounded-2xl border-0 bg-canvas text-input text-ink" +
  "shadow-neu-inset placeholder:text-faint" +
  "transition-shadow duration-200 disabled:opacity-55";

/*
 * An invalid field cannot signal with a border, because it has none. A ring
 * composes with the inset shadow rather than replacing it, so the control stays
 * a well and gains a red edge — and the message below still carries the reason,
 * because a colour is not an explanation.
 */
export const controlClasses = (isInvalid: boolean, extra?: string) =>
  cx(CONTROL_BASE, isInvalid && "ring-2 ring-alert-mark/60", extra);

interface FieldShellProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  /** Sits to the right of the control — e.g. the brand-colour swatch. */
  adornment?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Label + control + one message slot. Error wins over hint; both never show. */
export function FieldShell({
  id,
  label,
  hint,
  error,
  adornment,
  children,
  className,
}: FieldShellProps) {
  return (
    <div className={className}>
      <label
        htmlFor={id}
        className="mb-2 block text-label font-semibold text-ink"
      >
        {label}
      </label>

      {adornment ? (
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">{children}</div>
          {adornment}
        </div>
      ) : (
        children
      )}

      {error ? (
        <p id={`${id}-message`} className="mt-2 text-meta font-medium text-alert-ink">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-message`} className="mt-2 text-meta font-medium text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  adornment?: ReactNode;
  /**
   * Sits inside the control's left edge — the rupee sign on an amount. Named
   * `unit` rather than `prefix` because `prefix` is already an HTML attribute,
   * and because that is what it is for.
   *
   * It is `aria-hidden`, so the unit must also appear in the label: a screen
   * reader user should not have to infer the currency from a decoration.
   */
  unit?: ReactNode;
  /** Applied to the wrapper, not the control — for grid spans. */
  fieldClassName?: string;
}

export default function Input({
  id,
  label,
  hint,
  error,
  adornment,
  unit,
  fieldClassName,
  className,
  ...rest
}: InputProps) {
  const control = (
    <input
      id={id}
      aria-invalid={error ? true : undefined}
      aria-describedby={error || hint ? `${id}-message` : undefined}
      className={controlClasses(
        Boolean(error),
        cx("min-h-11 pr-4", unit ? "pl-9" : "pl-4", className),
      )}
      {...rest}
    />
  );

  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      adornment={adornment}
      className={fieldClassName}
    >
      {unit ? (
        <div className="relative">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-input text-muted"
          >
            {unit}
          </span>
          {control}
        </div>
      ) : (
        control
      )}
    </FieldShell>
  );
}

interface TextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  fieldClassName?: string;
}

export function Textarea({
  id,
  label,
  hint,
  error,
  fieldClassName,
  className,
  rows = 2,
  ...rest
}: TextareaProps) {
  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      className={fieldClassName}
    >
      <textarea
        id={id}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-message` : undefined}
        className={controlClasses(Boolean(error), cx("px-4 py-3", className))}
      {...rest}
      />
    </FieldShell>
  );
}

interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  fieldClassName?: string;
}

export function Select({
  id,
  label,
  hint,
  error,
  fieldClassName,
  className,
  children,
  ...rest
}: SelectProps) {
  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      className={fieldClassName}
    >
      <div className="relative">
        <select
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? `${id}-message` : undefined}
          className={controlClasses(
            Boolean(error),
            cx("h-11 cursor-pointer appearance-none pl-4 pr-11", className),
          )}
          {...rest}
        >
          {children}
        </select>
        <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-muted">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </div>
      </div>
    </FieldShell>
  );
}
