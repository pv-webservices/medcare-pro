/**
 * Advisory password strength - part of the authentication UI.
 *
 * THIS IS GUIDANCE, NOT A RULE. The application has exactly one password
 * requirement, and it lives in src/lib/signupInput.ts: at least
 * MIN_PASSWORD_LENGTH characters. Nothing here adds a second one. The meter
 * never blocks a submit, never marks a long-enough password invalid, and the
 * server remains the only authority on what is accepted - inventing a
 * client-side "must contain a symbol" rule here would reject passwords the API
 * would happily take, which is worse than no meter at all.
 *
 * `isLongEnough` is the only output tied to a real rule. `score` and `label`
 * describe variety, and are shown as a hint.
 *
 * Pure and dependency-free, so it can be unit-tested without a DOM.
 */

export type PasswordStrengthScore = 0 | 1 | 2 | 3;

export interface PasswordStrength {
  /** 0 while the one real rule is unmet; 1-3 once it is. */
  score: PasswordStrengthScore;
  /** The word shown beside the meter. */
  label: string;
  /** The only assertion here that mirrors a server-side rule. */
  isLongEnough: boolean;
}

const LABELS: Record<PasswordStrengthScore, string> = {
  0: "Too short",
  1: "Fair",
  2: "Good",
  3: "Strong",
};

/** How much beyond the minimum counts as "went to the trouble". */
const COMFORTABLE_EXTRA = 4;

export function describePasswordStrength(
  password: string,
  minLength: number,
): PasswordStrength {
  const isLongEnough = password.length >= minLength;

  if (!isLongEnough) {
    return { score: 0, label: LABELS[0], isLongEnough: false };
  }

  const signals = [
    /[a-z]/.test(password) && /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^A-Za-z0-9]/.test(password),
    password.length >= minLength + COMFORTABLE_EXTRA,
  ].filter(Boolean).length;

  const score: PasswordStrengthScore = signals >= 3 ? 3 : signals === 2 ? 2 : 1;

  return { score, label: LABELS[score], isLongEnough: true };
}
