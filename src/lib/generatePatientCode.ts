import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Patient ID generation — FR-3.1, format `PT-YYYY-####`.
 *
 * THE ONLY PLACE this logic lives. Per the multi-clinic-data-model skill, do
 * not inline it at call sites: if PRD §10's "account-wide numbering" assumption
 * flips to per-clinic, this function is the single thing that changes.
 *
 * Current scope: sequential and unique per TENANT (not per clinic), resetting
 * each calendar year.
 */

const PREFIX = "PT";
const SEQUENCE_PADDING = 4;

type TransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export function formatPatientCode(year: number, sequence: number): string {
  return `${PREFIX}-${year}-${String(sequence).padStart(SEQUENCE_PADDING, "0")}`;
}

/** Pulls the numeric sequence out of a code, or 0 if it does not parse. */
function parseSequence(code: string): number {
  const parsed = Number.parseInt(code.split("-")[2] ?? "", 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Returns the next patient code for a tenant.
 *
 * MUST be called inside a transaction that also creates the Patient row, and
 * the caller must be prepared to retry on a unique-constraint violation
 * against `patients(tenant_id, patient_code)`: two concurrent registrations can
 * read the same highest code before either has written. The database
 * constraint is what actually guarantees uniqueness — this function only picks
 * the next candidate.
 */
export async function generatePatientCode(
  tx: TransactionClient,
  tenantId: string,
  now: Date = new Date(),
): Promise<string> {
  const year = now.getFullYear();
  const yearPrefix = `${PREFIX}-${year}-`;

  // Highest existing code for this tenant and year. Ordering by patientCode
  // works because the sequence is zero-padded to a fixed width.
  const latest = await tx.patient.findFirst({
    where: { tenantId, patientCode: { startsWith: yearPrefix } },
    orderBy: { patientCode: "desc" },
    select: { patientCode: true },
  });

  const nextSequence = latest ? parseSequence(latest.patientCode) + 1 : 1;

  return formatPatientCode(year, nextSequence);
}

export type { Prisma };
