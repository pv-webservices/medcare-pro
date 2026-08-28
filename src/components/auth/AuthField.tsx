import type {
  InputHTMLAttributes,
  Ref,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";
import { cx } from "@/components/ui/cx";

/**
 * A labelled field for the authentication screens.
 *
 * THE LABEL IS ALWAYS VISIBLE. No placeholder-as-label: the moment a
 * front-desk user starts typing, a placeholder label is gone, and so is the
 * only clue about what the field was for. Placeholders here are examples, and
 * are allowed to be missing entirely.
 *
 * THE WIRING IS IN THE PRIMITIVE. `aria-describedby`, `aria-invalid` and the
 * one message slot are assembled here so no call site can forget them — an
 * error a screen reader never announces has not been reported. Error wins over
 * hint; both are never shown at once.
 *
 * 52px CONTROLS, 16px TEXT. The height is a comfortable target on a tablet at
 * a reception desk, and 16px is the size below which iOS Safari zooms the page
 * on focus.
 *
 * Autofill is expected to work here: these fields keep their `name` and their
 * `autoComplete`, and globals.css repaints Chrome's yellow rather than
 * suppressing it.
 */

export const authControlClasses = (isInvalid: boolean, extra?: string) =>
  cx(
    "block w-full rounded-[14px] border bg-auth-card text-[15px] text-auth-ink",
    "placeholder:text-auth-faint",
    "transition-[border-color,box-shadow] duration-150",
    isInvalid
      ? "border-auth-alert-mark/70 hover:border-auth-alert-mark"
      : "border-auth-line hover:border-auth-line-strong",
    "disabled:cursor-not-allowed disabled:bg-auth-bg disabled:text-auth-muted",
    extra,
  );

interface FieldShellProps {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  /** "Forgot password?" — sits on the label row, right-aligned. */
  labelAction?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function AuthFieldShell({
  id,
  label,
  hint,
  error,
  labelAction,
  children,
  className,
}: FieldShellProps) {
  return (
    <div className={className}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <label
          htmlFor={id}
          className="text-[13.5px] font-medium text-auth-ink-soft"
        >
          {label}
        </label>
        {labelAction}
      </div>

      {children}

      {error ? (
        <p
          id={`${id}-message`}
          className="mt-2 text-[12.5px] font-medium text-auth-alert-ink"
        >
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-message`} className="mt-2 text-[12.5px] text-auth-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface AuthFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  labelAction?: ReactNode;
  /** A Lucide node, rendered inside the control's left edge and hidden from AT. */
  icon?: ReactNode;
  /** Applied to the wrapper — for grid spans. */
  fieldClassName?: string;
  /** React 19 takes `ref` as an ordinary prop; it lands on the <input>. */
  ref?: Ref<HTMLInputElement>;
  /** Extra ids to announce alongside the message this field owns. */
  describedBy?: string;
}

export default function AuthField({
  id,
  label,
  hint,
  error,
  labelAction,
  icon,
  fieldClassName,
  describedBy,
  className,
  ...rest
}: AuthFieldProps) {
  const messageId = error || hint ? `${id}-message` : undefined;
  const described = cx(describedBy, messageId) || undefined;

  return (
    <AuthFieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      labelAction={labelAction}
      className={fieldClassName}
    >
      <div className="relative">
        {icon && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-4 top-1/2 flex -translate-y-1/2 items-center text-auth-faint"
          >
            {icon}
          </span>
        )}
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={described}
          className={authControlClasses(
            Boolean(error),
            cx("h-[52px] pr-4", icon ? "pl-11" : "pl-4", className),
          )}
          {...rest}
        />
      </div>
    </AuthFieldShell>
  );
}

interface AuthTextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  fieldClassName?: string;
}

export function AuthTextarea({
  id,
  label,
  hint,
  error,
  fieldClassName,
  className,
  rows = 2,
  ...rest
}: AuthTextareaProps) {
  return (
    <AuthFieldShell
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
        className={authControlClasses(
          Boolean(error),
          cx("resize-y px-4 py-3.5", className),
        )}
        {...rest}
      />
    </AuthFieldShell>
  );
}
