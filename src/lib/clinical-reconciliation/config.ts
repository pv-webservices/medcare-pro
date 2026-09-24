import { clinicalFactsEnabled } from "@/lib/clinical-facts/config";

/** AI-4 runtime kill switch (PRD §8). It depends on AI-3, whose accepted
 * facts are its only input. Off until the §5 tables are clinician-approved. */
export function clinicalReconciliationEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.CLINICAL_RECONCILIATION_ENABLED === "true" && clinicalFactsEnabled(env);
}

export class ClinicalReconciliationDisabledError extends Error {
  constructor() {
    super("Prescription reconciliation is disabled.");
    this.name = "ClinicalReconciliationDisabledError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
