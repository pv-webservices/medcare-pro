import { ChevronDown } from "lucide-react";
import type { ReactNode, SelectHTMLAttributes } from "react";
import { cx } from "@/components/ui/cx";
import { controlClasses, FieldShell } from "@/components/ui/Input";

/**
 * A native `<select>`, deliberately.
 *
 * A custom listbox would let us style the options, and would also cost us the
 * OS picker — which on the tablet at the front desk is a full-height wheel that
 * beats anything we would build. The only things we restyle are the shell and
 * the chevron.
 *
 * The shell is the same inset well as every other field, so a select reads as
 * something you fill rather than something you press. The one place it does not
 * follow that rule is the clinic switcher in the sidebar, which passes
 * `isLabelHidden` and lives inside its own raised pill — see ClinicSwitcher.
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
  icon?: ReactNode;
  children: ReactNode;
}

export default function Select({
  id,
  label,
  hint,
  error,
  isLabelHidden = false,
  fieldClassName,
  icon,
  className,
  children,
  ...rest
}: SelectProps) {
  const control = (
    <div className="relative">
      {icon && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-muted"
        >
          {icon}
        </span>
      )}
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-message` : undefined}
        aria-label={isLabelHidden ? label : undefined}
        className={controlClasses(
          Boolean(error),
          cx(
            "min-h-11 cursor-pointer appearance-none py-0 pr-11",
            icon ? "pl-10" : "pl-4",
            className
          ),
        )}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        strokeWidth={2}
        className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
      />
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
              "mt-2 text-meta font-medium",
              error ? "text-alert-ink" : "text-muted",
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
