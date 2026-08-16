import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";
import Card from "@/components/ui/Card";
import { cx } from "@/components/ui/cx";
import EmptyState from "@/components/ui/EmptyState";
import StatusPill from "@/components/ui/StatusPill";
import Table, { TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import type { ClinicSummary } from "@/lib/clinics";
import { accentStyle } from "@/lib/theme";

/**
 * Clinic list — PRD §6.2 (FR-2.2), showing each clinic's doctor and patient
 * counts.
 *
 * This is the list pattern every later stage reuses: a `Table` on tablet and
 * up, the same fields as stacked `Card`s below, counts right-aligned in
 * tabular figures so they read down the column.
 *
 * The rail down each row is the clinic's own `themeColor`. It is the same 4px
 * bar the sidebar wears for the selected clinic, which is what teaches the
 * colour: you see the rail here, then you recognise it in the shell. A clinic
 * that has set no colour gets a neutral rail rather than a borrowed one —
 * absence should look like absence.
 */

interface ClinicsTableProps {
  clinics: readonly ClinicSummary[];
  /** The switcher's current selection, or null for "All clinics". */
  selectedClinicId: string | null;
}

/** Counts are the reason this screen exists, so they outrank the row's text. */
const COUNT_CLASS = "text-section font-semibold tabular-nums text-ink";

/** Falls back to the rule colour, not the house accent — see the note above. */
function railStyle(themeColor: string | null): CSSProperties {
  return themeColor
    ? accentStyle(themeColor)
    : ({ "--accent": "var(--line)" } as CSSProperties);
}

export default function ClinicsTable({
  clinics,
  selectedClinicId,
}: ClinicsTableProps) {
  if (clinics.length === 0) {
    return (
      <EmptyState
        title="No clinics yet"
        guidance="Add your first clinic to start adding doctors and registering patients. Everything else in MEDCARE PRO is recorded against one."
      />
    );
  }

  return (
    <>
      {/* Tablet and up. The wrapper scrolls, so a narrow viewport never pushes
          the sidebar off-screen. */}
      <div className="hidden md:block">
        <Table caption="Clinics in this account, with their doctor and patient counts">
          <THead>
            <TH>Clinic</TH>
            <TH>City</TH>
            <TH align="end">Doctors</TH>
            <TH align="end">Patients</TH>
            <TH align="end">
              <span className="sr-only">Open</span>
            </TH>
          </THead>

          <TBody>
            {clinics.map((clinic) => {
              const isCurrent = clinic.id === selectedClinicId;

              return (
                <TR
                  key={clinic.id}
                  isCurrent={isCurrent}
                  style={railStyle(clinic.themeColor)}
                >
                  <TD hasRail>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/clinics/${clinic.id}`}
                        className="font-medium text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
                      >
                        {clinic.name}
                      </Link>
                      {isCurrent && (
                        <StatusPill tone="accent" hasDot={false}>
                          Viewing
                        </StatusPill>
                      )}
                    </div>
                    {clinic.address && (
                      <p className="mt-0.5 text-label text-muted">{clinic.address}</p>
                    )}
                  </TD>

                  <TD>
                    {clinic.city ?? <span className="text-muted">—</span>}
                  </TD>

                  <TD isNumeric className={COUNT_CLASS}>
                    {clinic.doctorCount}
                  </TD>

                  <TD isNumeric className={COUNT_CLASS}>
                    {clinic.patientCount}
                  </TD>

                  <TD align="end" className="py-0 pl-0">
                    <Link
                      href={`/clinics/${clinic.id}`}
                      className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted hover:text-ink"
                    >
                      <span className="sr-only">Open {clinic.name}</span>
                      <ChevronRight
                        aria-hidden="true"
                        strokeWidth={1.75}
                        className="h-4 w-4"
                      />
                    </Link>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </div>

      {/* Below tablet: the same fields, stacked. */}
      <ul className="grid gap-3 md:hidden">
        {clinics.map((clinic) => {
          const isCurrent = clinic.id === selectedClinicId;

          return (
            <li key={clinic.id} style={railStyle(clinic.themeColor)}>
              <Card
                isFlush
                className={cx("overflow-hidden", isCurrent && "bg-surface-sunk")}
              >
                <div className="flex items-stretch">
                  <span aria-hidden="true" className="w-1 shrink-0 bg-accent" />

                  <div className="min-w-0 flex-1 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/clinics/${clinic.id}`}
                        className="font-medium text-ink underline decoration-line underline-offset-4"
                      >
                        {clinic.name}
                      </Link>
                      {isCurrent && (
                        <StatusPill tone="accent" hasDot={false}>
                          Viewing
                        </StatusPill>
                      )}
                    </div>

                    {clinic.city && (
                      <p className="mt-0.5 text-label text-muted">{clinic.city}</p>
                    )}

                    <div className="mt-3 flex gap-8">
                      <div>
                        <p className={COUNT_CLASS}>{clinic.doctorCount}</p>
                        <p className="text-micro font-semibold uppercase text-muted">
                          Doctors
                        </p>
                      </div>
                      <div>
                        <p className={COUNT_CLASS}>{clinic.patientCount}</p>
                        <p className="text-micro font-semibold uppercase text-muted">
                          Patients
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </>
  );
}
