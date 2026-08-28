import type {
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";
import { cx } from "@/components/ui/cx";

/**
 * Text fields, with their label, hint and error attached.
 *
 * A FIELD IS A BORDERED WHITE SURFACE. Hairline, 14px radius, 44px tall, 15px
 * text. It is the same object everywhere in the product, which is what lets
 * someone fill a registration form they have never seen without reading it
 * first.
 *
 * THE LABEL IS ALWAYS VISIBLE. No placeholder-as-label: the moment a
 * receptionist starts typing, a placeholder label is gone and so is the only
 * clue about what the field was for. Placeholders here are examples, and are
 * allowed to be absent entirely.
 *
 * THE WIRING LIVES IN THE PRIMITIVE. `aria-describedby`, `aria-invalid` and the
 * one message slot are assembled here so no call site can forget them — a
 * validation message a screen reader never announces is not validation. Error
 * wins over hint; the two never show at once.
 *
 * Fields are 15px on desktop and step to 16px below `sm`, because anything
 * under 16px makes iOS Safari zoom the page on focus — intolerable on the
 * shared tablet at a front desk.
 */

const CONTROL_BASE =
  "block w-full rounded-2xl border bg-canvas text-input text-ink max-sm:text-[16px] " +
  "shadow-field placeholder:text-faint " +
  "transition-[border-color,box-shadow] duration-150 " +
  "disabled:cursor-not-allowed disabled:bg-canvas-deep disabled:text-muted";

/**
 * An invalid field signals with its own border rather than an extra ring, so
 * the control does not change size when it fails — and the message below still
 * carries the reason, because a colour is not an explanation.
 */
export const controlClasses = (isInvalid: boolean, extra?: string) =>
  cx(
    CONTROL_BASE,
    isInvalid
      ? "border-alert-mark/70 hover:border-alert-mark"
      : "border-line hover:border-line-strong",
    extra,
  );

interface FieldShellProps {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  /** Sits to the right of the control — e.g. the brand-colour swatch. */
  adornment?: ReactNode;
  /** Sits on the label row, right-aligned — "Forgot password?", "Optional". */
  labelAction?: ReactNode;
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
  labelAction,
  children,
  className,
}: FieldShellProps) {
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-label font-medium text-ink-soft">
          {label}
        </label>
        {labelAction}
      </div>

      {adornment ? (
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">{children}</div>
          {adornment}
        </div>
      ) : (
        children
      )}

      {error ? (
        <p id={`${id}-message`} className="mt-1.5 text-meta font-medium text-alert-ink">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-message`} className="mt-1.5 text-meta text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  adornment?: ReactNode;
  labelAction?: ReactNode;
  /** A Lucide node inside the left edge of the control. Hidden from AT. */
  icon?: ReactNode;
  /**
   * Sits inside the control's left edge — the rupee sign on an amount. Named
   * `unit` rather than `prefix` because `prefix` is already an HTML attribute.
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
  labelAction,
  icon,
  unit,
  fieldClassName,
  className,
  ...rest
}: InputProps) {
  const leading = icon ?? unit;

  const control = (
    <div className={leading ? "relative" : undefined}>
      {leading && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-3.5 top-1/2 flex -translate-y-1/2 items-center text-muted"
        >
          {leading}
        </span>
      )}
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-message` : undefined}
        className={controlClasses(
          Boolean(error),
          cx("min-h-11 pr-3.5", leading ? "pl-10" : "pl-3.5", className),
        )}
        {...rest}
      />
    </div>
  );

  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      adornment={adornment}
      labelAction={labelAction}
      className={fieldClassName}
    >
      {control}
    </FieldShell>
  );
}

interface TextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> {
  id: string;
  label: string;
  hint?: ReactNode;
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
  rows = 3,
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
        className={controlClasses(
          Boolean(error),
          cx("resize-y px-3.5 py-2.5", className),
        )}
        {...rest}
      />
    </FieldShell>
  );
}
