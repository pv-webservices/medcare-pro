import Link from "next/link";
import { formatRupees } from "@/lib/money";
import { VISIT_TYPE_LABELS, type PatientVisit } from "@/lib/registrations";

/**
 * Every visit on this patient's record — the "has this person been here
 * before?" question, answered on the record itself.
 *
 * This is what a single Patient ID buys: one person, one ID, one visit history,
 * however many times they come back. A patient with only this visit gets
 * nothing rendered — there is no history to read yet.
 */

interface PatientVisitsProps {
  visits: readonly PatientVisit[];
  /** The visit currently open, marked rather than linked. */
  currentId: string;
}

function formatVisitDate(date: string): string {
  // Parsed as UTC to match how the date is stored, so the label cannot slip a day.
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function PatientVisits({
  visits,
  currentId,
}: PatientVisitsProps) {
  if (visits.length < 2) {
    return null;
  }

  return (
    <section aria-labelledby="patient-visits-heading">
      <h2 id="patient-visits-heading" className="mb-3 text-lg font-semibold">
        Visit history
      </h2>

      <ol className="grid gap-2">
        {visits.map((visit) => {
          const isCurrent = visit.id === currentId;

          return (
            <li
              key={visit.id}
              aria-current={isCurrent ? "true" : undefined}
              className={`flex flex-wrap items-baseline justify-between gap-3 rounded-2xl px-3 py-2 ${
                isCurrent ? "shadow-neu-pressed" : "shadow-neu-raised-sm"
              }`}
            >
              <div className="min-w-0">
                <p className="text-sm tabular-nums">
                  {isCurrent ? (
                    <span className="font-medium">
                      {formatVisitDate(visit.visitDate)} at {visit.visitTime}
                    </span>
                  ) : (
                    <Link
                      href={`/registration/${visit.id}`}
                      className="font-medium underline"
                    >
                      {formatVisitDate(visit.visitDate)} at {visit.visitTime}
                    </Link>
                  )}
                  {isCurrent && (
                    <span className="ml-2 text-muted">
                      this visit
                    </span>
                  )}
                </p>
                <p className="text-sm text-muted">
                  {VISIT_TYPE_LABELS[visit.visitType]} · {visit.department}
                  {visit.doctorName ? ` · ${visit.doctorName}` : ""}
                </p>
              </div>
              <p className="shrink-0 text-sm font-medium tabular-nums">
                {formatRupees(visit.amount)}
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
