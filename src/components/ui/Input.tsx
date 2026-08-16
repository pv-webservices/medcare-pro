import type {
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
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
  "block w-full rounded-md border bg-surface text-input text-ink " +
  "placeholder:text-muted/70 transition-colors disabled:opacity-55";

export const controlClasses = (isInvalid: boolean, extra?: string) =>
  cx(
    CONTROL_BASE,
    isInvalid
      ? "border-alert hover:border-alert"
      : "border-line hover:border-muted/60",
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
      <label htmlFor={id} className="mb-1.5 block text-label font-medium text-ink">
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
        <p id={`${id}-message`} className="mt-1.5 text-label text-alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-message`} className="mt-1.5 text-label text-muted">
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
  /** Applied to the wrapper, not the control — for grid spans. */
  fieldClassName?: string;
}

export default function Input({
  id,
  label,
  hint,
  error,
  adornment,
  fieldClassName,
  className,
  ...rest
}: InputProps) {
  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      adornment={adornment}
      className={fieldClassName}
    >
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-message` : undefined}
        className={controlClasses(Boolean(error), cx("min-h-11 px-3", className))}
        {...rest}
      />
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
