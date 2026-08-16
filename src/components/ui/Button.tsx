import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "@/components/ui/cx";

/**
 * The one button in this app.
 *
 * `commit` is the variant that writes a record, and it is filled with the
 * selected clinic's own colour — so the clinic you are writing into is visible
 * at the instant you commit, which is the failure mode a multi-clinic account
 * actually has. Everything else stays neutral.
 *
 * `buttonClasses` is exported so a `<Link>` that behaves like a button can wear
 * the same clothes without a second implementation.
 */

export type ButtonVariant = "commit" | "primary" | "secondary" | "quiet" | "danger";
export type ButtonSize = "md" | "sm";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium " +
  "transition-colors disabled:cursor-not-allowed disabled:opacity-55";

/** 44px minimum — this is used on a shared tablet at a front desk. */
const SIZES: Record<ButtonSize, string> = {
  md: "min-h-11 px-5 text-body",
  sm: "min-h-9 px-3.5 text-label",
};

const VARIANTS: Record<ButtonVariant, string> = {
  commit:
    "bg-accent-solid text-accent-ink hover:brightness-110 active:brightness-95",
  primary: "bg-ink text-surface hover:opacity-90",
  secondary:
    "border border-line bg-surface text-ink hover:bg-surface-sunk",
  quiet: "text-muted hover:bg-surface-sunk hover:text-ink",
  danger: "border border-alert/45 bg-alert/8 text-alert hover:bg-alert/14",
};

export function buttonClasses(
  variant: ButtonVariant = "secondary",
  size: ButtonSize = "md",
  extra?: string,
): string {
  return cx(BASE, SIZES[size], VARIANTS[variant], extra);
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Replaces the label while a write is in flight, and disables the control. */
  busyLabel?: string;
  isBusy?: boolean;
  children: ReactNode;
}

export default function Button({
  variant = "secondary",
  size = "md",
  isBusy = false,
  busyLabel,
  className,
  disabled,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || isBusy}
      aria-busy={isBusy || undefined}
      className={buttonClasses(variant, size, className)}
      {...rest}
    >
      {isBusy && busyLabel ? busyLabel : children}
    </button>
  );
}
