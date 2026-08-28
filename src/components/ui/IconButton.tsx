import type { ButtonHTMLAttributes, Ref, ReactNode } from "react";
import { cx } from "@/components/ui/cx";

/**
 * A square button whose whole label is an icon.
 *
 * `label` IS REQUIRED AND IS NOT OPTIONAL POLITENESS. An icon-only control is
 * unnamed to a screen reader, and a row of unnamed buttons is a row of
 * "button, button, button". The prop becomes both the accessible name and the
 * browser tooltip, so the two can never disagree.
 *
 * Reach for this only where the icon is unambiguous on its own — close, more,
 * next, previous, notifications. A destructive or unusual action gets a real
 * button with a word on it.
 */

export type IconButtonTone = "default" | "danger";
export type IconButtonSize = "md" | "sm";

const SIZES: Record<IconButtonSize, string> = {
  md: "h-11 w-11 rounded-2xl",
  sm: "h-9 w-9 rounded-xl",
};

const TONES: Record<IconButtonTone, string> = {
  default: "text-muted hover:bg-canvas-deep hover:text-ink",
  danger: "text-muted hover:bg-alert-bg hover:text-alert-ink",
};

interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** The accessible name and the tooltip. "Dismiss", "More actions". */
  label: string;
  size?: IconButtonSize;
  tone?: IconButtonTone;
  /** Draws the hairline and surface of a secondary button. */
  isOutlined?: boolean;
  /** React 19 takes `ref` as an ordinary prop; it lands on the <button>. */
  ref?: Ref<HTMLButtonElement>;
  children: ReactNode;
}

export default function IconButton({
  label,
  size = "md",
  tone = "default",
  isOutlined = false,
  className,
  children,
  type = "button",
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex shrink-0 items-center justify-center transition-colors duration-150",
        "disabled:cursor-not-allowed disabled:opacity-55",
        SIZES[size],
        TONES[tone],
        isOutlined && "border border-line bg-canvas shadow-card hover:border-line-strong",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
