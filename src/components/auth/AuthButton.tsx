import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cx } from "@/components/ui/cx";

/**
 * Buttons and button-shaped links for the authentication screens.
 *
 * ONE PRIMARY PER SCREEN. `primary` is a solid indigo fill with a coloured
 * cast under it — the only object on the page that floats — so the eye finds
 * the action without reading. Anything else on the screen is `secondary` (a
 * white surface with a hairline) or `ghost` (text until you point at it).
 *
 * THE PRESS IS 1px AND THE HOVER IS A COLOUR. No scale, no lift, no shadow
 * bloom: 150–200ms on colour and shadow, and a 1px translate on `:active`,
 * which the reduced-motion rule in globals.css flattens along with everything
 * else.
 *
 * BUSY IS A STATE, NOT A DISABLED BUTTON WITH A DIFFERENT LABEL. `isBusy`
 * disables the control, sets `aria-busy`, swaps in the progress label and spins
 * a small mark beside it, so "Signing in…" is announced rather than merely
 * drawn.
 *
 * `authButtonClasses` is exported so a `<Link>` that is genuinely the primary
 * action of a screen can wear the same clothes without a second implementation.
 */

export type AuthButtonVariant = "primary" | "secondary" | "ghost";

const BASE =
  "inline-flex min-h-[50px] w-full items-center justify-center gap-2 rounded-[14px] px-5 text-[15px] font-semibold " +
  "transition-[background-color,box-shadow,color,border-color,transform] duration-[180ms] " +
  "active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 disabled:active:translate-y-0";

const VARIANTS: Record<AuthButtonVariant, string> = {
  primary:
    "bg-auth-primary text-auth-primary-ink shadow-auth-cta hover:bg-auth-primary-hover disabled:shadow-none",
  secondary:
    "border border-auth-line bg-auth-card text-auth-ink shadow-auth-sm hover:border-auth-line-strong hover:bg-auth-bg",
  ghost:
    "text-auth-muted hover:bg-auth-bg-tint hover:text-auth-ink",
};

export function authButtonClasses(
  variant: AuthButtonVariant = "primary",
  extra?: string,
): string {
  return cx(BASE, VARIANTS[variant], extra);
}

/** A secondary text link — "Forgot password?", "Create one", "Back to sign in". */
export const authLinkClasses =
  "rounded font-semibold text-auth-primary underline-offset-4 transition-colors duration-150 hover:text-auth-primary-hover hover:underline";

interface AuthButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: AuthButtonVariant;
  isBusy?: boolean;
  /** Replaces the label while a request is in flight. */
  busyLabel?: string;
  children: ReactNode;
}

export default function AuthButton({
  variant = "primary",
  isBusy = false,
  busyLabel,
  className,
  disabled,
  children,
  type = "button",
  ...rest
}: AuthButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || isBusy}
      aria-busy={isBusy || undefined}
      className={authButtonClasses(variant, className)}
      {...rest}
    >
      {isBusy && (
        <Loader2
          aria-hidden="true"
          className="h-[18px] w-[18px] animate-spin"
          strokeWidth={2.5}
        />
      )}
      {isBusy && busyLabel ? busyLabel : children}
    </button>
  );
}
