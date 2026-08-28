"use client";

import { useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Check, Eye, EyeOff } from "lucide-react";
import { AuthFieldShell, authControlClasses } from "@/components/auth/AuthField";
import { describePasswordStrength } from "@/components/auth/passwordStrength";
import { cx } from "@/components/ui/cx";

/**
 * A password field with a visibility toggle and, where a new password is being
 * chosen, the one requirement the application actually enforces.
 *
 * THE TOGGLE IS A REAL TOGGLE. `aria-pressed` plus a label that names the
 * state, so a screen-reader user knows whether the password is currently on
 * screen. It stays in the tab order on purpose: a keyboard-only user is exactly
 * the person most likely to want to check what they typed.
 *
 * THE METER IS ADVISORY. See passwordStrength.ts - the only rule is the minimum
 * length, and the meter never gates the submit. The requirement line below it
 * renders that one rule and ticks when it is met, which is the feedback that
 * matters.
 *
 * THE VALUE IS NEVER PERSISTED HERE. It is a controlled input and nothing else;
 * clearing it after a failed submit is the caller's job, and every caller in
 * this app does it.
 */

interface PasswordFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type"> {
  id: string;
  label: string;
  value: string;
  hint?: ReactNode;
  error?: string;
  labelAction?: ReactNode;
  /**
   * Shows the length requirement and the advisory meter. On a sign-in form
   * there is nothing to advise - the password already exists - so this is off
   * by default.
   */
  showGuidance?: boolean;
  /** Mirrors MIN_PASSWORD_LENGTH in src/lib/signupInput.ts. */
  minPasswordLength?: number;
  describedBy?: string;
  fieldClassName?: string;
}

const METER_TONES = [
  "bg-auth-alert-mark",
  "bg-auth-warn-mark",
  "bg-auth-primary",
  "bg-auth-ok-mark",
] as const;

export default function PasswordField({
  id,
  label,
  value,
  hint,
  error,
  labelAction,
  showGuidance = false,
  minPasswordLength = 12,
  describedBy,
  fieldClassName,
  className,
  ...rest
}: PasswordFieldProps) {
  const [isVisible, setIsVisible] = useState(false);
  const guidanceId = useId();

  const strength = describePasswordStrength(value, minPasswordLength);
  const messageId = error || hint ? `${id}-message` : undefined;
  const described =
    cx(describedBy, messageId, showGuidance ? guidanceId : undefined) ||
    undefined;

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
        <input
          id={id}
          type={isVisible ? "text" : "password"}
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={described}
          className={authControlClasses(
            Boolean(error),
            cx("h-[52px] pl-4 pr-12", className),
          )}
          {...rest}
        />
        <button
          type="button"
          onClick={() => setIsVisible((current) => !current)}
          aria-label={isVisible ? "Hide password" : "Show password"}
          aria-pressed={isVisible}
          className="absolute right-1.5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-[10px] text-auth-muted transition-colors duration-150 hover:bg-auth-bg-tint hover:text-auth-ink"
        >
          {isVisible ? (
            <EyeOff className="h-[18px] w-[18px]" strokeWidth={2} />
          ) : (
            <Eye className="h-[18px] w-[18px]" strokeWidth={2} />
          )}
        </button>
      </div>

      {showGuidance && (
        <div id={guidanceId} className="mt-3">
          {/*
            Four segments, filled to the score. It is not a progress bar - there
            is nothing to complete - so it carries no role and no value; the word
            beside it is what communicates, and the colour only reinforces it.
          */}
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="flex flex-1 gap-1.5">
              {[0, 1, 2, 3].map((index) => (
                <span
                  key={index}
                  className={cx(
                    "h-1 flex-1 rounded-full transition-colors duration-200",
                    value.length > 0 && index <= strength.score
                      ? METER_TONES[strength.score]
                      : "bg-auth-bg-tint",
                  )}
                />
              ))}
            </span>
            <span className="w-[62px] shrink-0 text-right text-[12px] font-medium text-auth-muted">
              {value.length > 0 ? strength.label : ""}
            </span>
          </div>

          <p
            className={cx(
              "mt-2 flex items-center gap-1.5 text-[12.5px]",
              strength.isLongEnough
                ? "font-medium text-auth-ok-ink"
                : "text-auth-muted",
            )}
          >
            <span
              aria-hidden="true"
              className={cx(
                "flex h-4 w-4 items-center justify-center rounded-full",
                strength.isLongEnough
                  ? "bg-auth-ok-mark text-white"
                  : "border border-auth-line-strong",
              )}
            >
              {strength.isLongEnough && (
                <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
              )}
            </span>
            At least {minPasswordLength} characters
          </p>
        </div>
      )}
    </AuthFieldShell>
  );
}
