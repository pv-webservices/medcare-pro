/** AI-5 kill switch (PRD §8). Off until the §5 tables are clinician-approved.
 * Issuing works identically whether it is on or off. */
export function prescriptionChecksEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.PRESCRIPTION_CHECKS_ENABLED === "true";
}
