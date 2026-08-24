import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "@/components/ui/cx";

/**
 * The unified button for the application.
 *
 * DEPTH CARRIES THE HIERARCHY, not colour weight. `commit` is a solid accent
 * fill that casts a coloured shadow — it is the only thing on a screen that
 * floats above the surface, so the eye finds the affirmative action without
 * reading a word. `secondary` is the same colour as the page and merely raised,
 * which is what "an object you may press" looks like here. `quiet` is flush
 * with the surface until you point at it.
 *
 * Every variant presses IN on :active. That is the whole promise of the style:
 * a control that looks physical has to behave physically, and a button that
 * stays raised while held reads as broken.
 *
 * `commit` is the variant that writes a record. `buttonClasses` is exported so
 * a `<Link>` that behaves like a button can wear the same clothes without a
 * second implementation.
 */

export type ButtonVariant = "commit" | "primary" | "secondary" | "quiet" | "danger";
export type ButtonSize = "md" | "sm";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-2xl font-semibold" +
  "transition-[box-shadow,background-color,color] duration-200" +
  "disabled:cursor-not-allowed disabled:opacity-55 disabled:shadow-none";

/** 44px minimum — this is used on a shared tablet at a front desk. */
const SIZES: Record<ButtonSize, string> = {
  md: "min-h-11 px-5 text-body",
  sm: "min-h-9 px-4 text-meta",
};

/*
 * `primary` is an alias of `commit` rather than a second look. The two were
 * distinct in the old flat system (violet against near-black); with one accent
 * there is nothing left to distinguish them, and inventing a difference would
 * give two names to one meaning. Nothing in the app passes `primary` today.
 */
const AFFIRMATIVE =
  "bg-accent text-accent-ink shadow-neu-accent hover:bg-accent-strong" +
  "active:shadow-neu-accent-pressed";

const VARIANTS: Record<ButtonVariant, string> = {
  commit: AFFIRMATIVE,
  primary: AFFIRMATIVE,
  secondary:
    "bg-canvas text-ink shadow-neu-raised-sm hover:shadow-neu-raised" +
    "active:shadow-neu-pressed",
  quiet:
    "bg-transparent text-muted hover:text-ink hover:shadow-neu-raised-sm" +
    "active:shadow-neu-pressed",
  /*
   * Destructive stays a raised surface rather than a red fill. A solid red
   * button is the loudest object on the page, and on screens where Delete sits
   * beside Save that is the wrong thing to draw the eye. The red lives in the
   * label, where it is read at the moment of deciding.
   */
  danger:
    "bg-canvas text-alert-ink shadow-neu-raised-sm hover:shadow-neu-raised" +
    "hover:text-alert-mark active:shadow-neu-pressed",
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
