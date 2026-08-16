import type { ReactNode, SelectHTMLAttributes } from "react";
import { cx } from "@/components/ui/cx";
import { controlClasses, FieldShell } from "@/components/ui/Input";

/**
 * A native `<select>`, deliberately.
 *
 * A custom listbox would let us style the options, and would also cost us the
 * OS picker — which on the tablet at the front desk is a full-height wheel
 * that beats anything we would build. The only thing we restyle is the shell
 * and the chevron.
 */

interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  /** Hides the label visually but keeps it for screen readers. */
  isLabelHidden?: boolean;
  fieldClassName?: string;
  children: ReactNode;
}

function Chevron() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
    >
      <path
        d="M4 6.5 8 10.5 12 6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Select({
  id,
  label,
  hint,
  error,
  isLabelHidden = false,
  fieldClassName,
  className,
  children,
  ...rest
}: SelectProps) {
  const control = (
    <div className="relative">
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-message` : undefined}
        aria-label={isLabelHidden ? label : undefined}
        className={controlClasses(
          Boolean(error),
          cx("min-h-11 appearance-none py-0 pl-3 pr-9", className),
        )}
        {...rest}
      >
        {children}
      </select>
      <Chevron />
    </div>
  );

  if (isLabelHidden) {
    return (
      <div className={fieldClassName}>
        {control}
        {(error || hint) && (
          <p
            id={`${id}-message`}
            className={cx(
              "mt-1.5 text-label",
              error ? "text-alert" : "text-muted",
            )}
          >
            {error ?? hint}
          </p>
        )}
      </div>
    );
  }

  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      className={fieldClassName}
    >
      {control}
    </FieldShell>
  );
}
