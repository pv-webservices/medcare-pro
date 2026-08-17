import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "@/components/ui/cx";

/**
 * The unified button for the application.
 *
 * `commit` is the variant that writes a record. Now uses the primary violet theme.
 * `buttonClasses` is exported so a `<Link>` that behaves like a button can wear
 * the same clothes without a second implementation.
 */

export type ButtonVariant = "commit" | "primary" | "secondary" | "quiet" | "danger";
export type ButtonSize = "md" | "sm";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-xl font-medium " +
  "transition-colors disabled:cursor-not-allowed disabled:opacity-55";

/** 44px minimum — this is used on a shared tablet at a front desk. */
const SIZES: Record<ButtonSize, string> = {
  md: "min-h-11 px-5 text-sm",
  sm: "min-h-9 px-3.5 text-xs",
};

const VARIANTS: Record<ButtonVariant, string> = {
  commit: "bg-[#6B46C1] text-white hover:bg-[#5a3aa6] shadow-sm",
  primary: "bg-slate-900 text-white hover:bg-slate-800 shadow-sm",
  secondary: "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 shadow-sm",
  quiet: "text-slate-500 hover:bg-slate-50 hover:text-slate-900",
  danger: "border border-red-200 bg-red-50 text-red-600 hover:bg-red-100",
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
