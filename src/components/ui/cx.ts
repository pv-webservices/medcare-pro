/** Joins class names, dropping anything falsy. No dependency needed for this. */
export function cx(
  ...parts: ReadonlyArray<string | false | null | undefined>
): string {
  return parts.filter(Boolean).join(" ");
}
