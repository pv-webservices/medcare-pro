import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cx } from "@/components/ui/cx";

/**
 * The one button in this application.
 *
 * COLOUR CARRIES THE HIERARCHY, and only one thing per screen gets it. `primary`
 * is a solid accent fill casting a coloured shadow — the single most findable
 * object on a page. Everything else is `secondary` (a white surface with a
 * hairline) or `ghost` (nothing until you point at it). If a screen has two
 * primaries, one of them is wrong.
 *
 * `danger` is NOT a red fill. On screens where Delete sits beside Save, a solid
 * red button is the loudest thing in the room and draws the eye to the action
 * nobody should take by accident. The red lives in the label and in the border,
 * where it is read at the moment of deciding. `dangerSolid` exists for the
 * confirm button inside a confirmation dialog, where the destructive action IS
 * the primary action of that surface.
 *
 * BUSY IS A STATE, NOT A RELABELLED DISABLED BUTTON. `isBusy` disables the
 * control, sets `aria-busy`, spins a mark and swaps the label, so a screen
 * reader hears "Saving" rather than watching a silent button do nothing.
 *
 * `buttonClasses` is exported so a `<Link>` that is genuinely the primary action
 * of a screen can wear the same clothes without a second implementation.
 */

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "dangerSolid"
  /** @deprecated aliases of `primary` / `ghost`, kept while call sites migrate. */
  | "commit"
  | "quiet";

export type ButtonSize = "md" | "sm";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-xl font-semibold whitespace-nowrap " +
  "transition-[background-color,box-shadow,color,border-color,transform] duration-[180ms] " +
  "active:translate-y-px disabled:cursor-not-allowed disabled:opacity-55 disabled:active:translate-y-0";

/** 44px is the front-desk tablet minimum; `sm` is for dense table rows only. */
const SIZES: Record<ButtonSize, string> = {
  md: "min-h-11 px-4 text-body",
  sm: "min-h-9 px-3 text-label",
};

const PRIMARY =
  "border border-transparent bg-accent text-accent-ink shadow-cta hover:bg-accent-strong disabled:shadow-none";

const GHOST =
  "border border-transparent bg-transparent text-muted hover:bg-canvas-deep hover:text-ink";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: PRIMARY,
  commit: PRIMARY,
  secondary:
    "border border-line bg-canvas text-ink shadow-card hover:border-line-strong hover:bg-canvas-deep",
  ghost: GHOST,
  quiet: GHOST,
  danger:
    "border border-line bg-canvas text-alert-ink shadow-card hover:border-alert-line hover:bg-alert-bg",
  dangerSolid:
    "border border-transparent bg-alert-mark text-white shadow-card hover:bg-alert-ink",
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
      {isBusy && (
        <Loader2
          aria-hidden="true"
          strokeWidth={2.5}
          className={cx("animate-spin", size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4")}
        />
      )}
      {isBusy && busyLabel ? busyLabel : children}
    </button>
  );
}
