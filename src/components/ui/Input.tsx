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
 * The label/hint/error wiring lives in the primitive rather than at each call
 * site so `aria-describedby` and `aria-invalid` cannot be forgotten — inline
 * validation is a ground rule here, and a validation message the screen reader
 * never announces is not validation.
 *
 * Fields are 16px (`text-input`) on purpose: anything smaller makes iOS Safari
 * zoom on focus, which is intolerable on a shared front-desk tablet.
 */

const CONTROL_BASE =
  "block w-full rounded-xl border bg-white text-sm text-slate-900 " +
  "placeholder:text-slate-400 transition-colors disabled:opacity-55 focus:outline-none focus:ring-4";

export const controlClasses = (isInvalid: boolean, extra?: string) =>
  cx(
    CONTROL_BASE,
    isInvalid
      ? "border-red-300 focus:border-red-500 focus:ring-red-500/20"
      : "border-slate-200 focus:border-violet-500 hover:border-slate-300 focus:ring-violet-500/10",
    extra,
  );

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
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-slate-700">
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
        <p id={`${id}-message`} className="mt-1.5 text-xs text-red-500">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-message`} className="mt-1.5 text-xs text-slate-500">
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
        cx("min-h-11 pr-3", unit ? "pl-8" : "pl-3", className),
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
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-input text-muted"
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
        className={controlClasses(Boolean(error), cx("px-3 py-2.5", className))}
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
          className={controlClasses(Boolean(error), cx("px-3 h-11 appearance-none pr-10 cursor-pointer", className))}
          {...rest}
        >
          {children}
        </select>
        <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">
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
