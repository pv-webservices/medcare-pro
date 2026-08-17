import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClasses } from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import StatusPill from "@/components/ui/StatusPill";
import Table, { TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { formatRupees } from "@/lib/money";
import { VISIT_TYPE_LABELS, type RegistrationRecord } from "@/lib/registrations";

/**
 * Registration list — PRD §6.3 (FR-3.2, FR-3.3).
 *
 * The Patient ID leads each row because it is what a patient reads out over the
 * phone and what is printed on the card in their hand. It is set in the
 * `serial` face — tabular, open tracking — so a receptionist can match one
 * character by character without losing their place.
 *
 * The mobile number sits under the patient's name rather than in a column of
 * its own: it identifies the same person, and pairing them keeps the table
 * inside a tablet's width once the clinic column appears.
 */

interface RegistrationsTableProps {
  registrations: readonly RegistrationRecord[];
  /** Hidden when the list is already filtered to a single clinic. */
  showClinic: boolean;
  /** True when a search or filter is applied — changes the empty state's advice. */
  isFiltered: boolean;
  /** Offered from the empty state, so a blank list still has a way forward. */
  canCreate: boolean;
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

function Dash() {
  return <span className="text-slate-400">—</span>;
}

/**
 * Only follow-ups are badged. A new patient is the default case, so labelling
 * both would put a chip on every row and mark nothing out. The tone is neutral
 * because a visit type is a fact, not a state anybody has to act on.
 */
function FollowUpPill() {
  return (
    <StatusPill tone="neutral" hasDot={false}>
      {VISIT_TYPE_LABELS.FOLLOW_UP}
    </StatusPill>
  );
}

function PatientCode({ children }: { children: ReactNode }) {
  return <span className="serial font-semibold text-slate-900">{children}</span>;
}

export default function RegistrationsTable({
  registrations,
  showClinic,
  isFiltered,
  canCreate,
}: RegistrationsTableProps) {
  if (registrations.length === 0) {
    return (
      <EmptyState
        title={isFiltered ? "No registrations match" : "No registrations yet"}
        guidance={
          isFiltered
            ? "Try a different name or phone number, or widen the date range."
            : "Register a patient to start recording visits and revenue."
        }
        action={
          // A filtered list is not empty, it is narrowed — the way out is to
          // change the filters that are already on screen, not to add a record.
          !isFiltered && canCreate ? (
            <Link
              href="/registration/new"
              className={buttonClasses("commit", "md")}
            >
              New Registration
            </Link>
          ) : undefined
        }
      />
    );
  }

  return (
    <>
      <div className="hidden md:block">
        <Table caption="Registrations, with the patient, visit and amount for each">
          <THead>
            <TH>Patient ID</TH>
            <TH>Patient</TH>
            <TH>Doctor</TH>
            <TH>Department</TH>
            {showClinic && <TH>Clinic</TH>}
            <TH>Visit</TH>
            <TH align="end">Amount</TH>
            <TH align="end">
              <span className="sr-only">Open</span>
            </TH>
          </THead>

          <TBody>
            {registrations.map((registration) => (
              <TR key={registration.id}>
                <TD>
                  <Link
                    href={`/registration/${registration.id}`}
                    className="underline decoration-slate-200 underline-offset-4 hover:decoration-slate-900"
                  >
                    <PatientCode>{registration.patientCode}</PatientCode>
                  </Link>
                </TD>

                <TD>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-900">
                      {registration.patientName}
                    </span>
                    {registration.visitType === "FOLLOW_UP" && <FollowUpPill />}
                  </div>
                  <p className="mt-0.5 text-xs tabular-nums text-slate-500">
                    {registration.mobileNumber}
                  </p>
                </TD>

                <TD>{registration.doctorName ?? <Dash />}</TD>

                <TD>{registration.department}</TD>

                {showClinic && <TD>{registration.clinicName}</TD>}

                <TD>
                  <span className="tabular-nums">
                    {formatVisitDate(registration.visitDate)}
                  </span>
                  <p className="mt-0.5 text-xs tabular-nums text-slate-500">
                    {registration.visitTime}
                  </p>
                </TD>

                <TD isNumeric className="font-bold text-slate-900">
                  {formatRupees(registration.amount)}
                </TD>

                <TD align="end" className="py-0 pl-0">
                  <Link
                    href={`/registration/${registration.id}`}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-md text-slate-400 hover:text-slate-900 transition-colors"
                  >
                    <span className="sr-only">
                      Open registration {registration.patientCode}
                    </span>
                    <ChevronRight
                      aria-hidden="true"
                      strokeWidth={1.75}
                      className="h-4 w-4"
                    />
                  </Link>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>

      {/* Below tablet: the same fields, stacked. The amount stays on the top
          line beside the name — it is the number the desk is reconciling. */}
      <ul className="grid gap-3 md:hidden">
        {registrations.map((registration) => (
          <li key={registration.id}>
            <Card isFlush className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    href={`/registration/${registration.id}`}
                    className="font-semibold text-slate-900 underline decoration-slate-200 underline-offset-4 hover:decoration-slate-900"
                  >
                    {registration.patientName}
                  </Link>
                  <p className="mt-0.5 text-xs text-slate-500">
                    <PatientCode>{registration.patientCode}</PatientCode>
                    <span className="tabular-nums">
                      {" · "}
                      {registration.mobileNumber}
                    </span>
                  </p>
                </div>
                <p className="shrink-0 font-bold tabular-nums text-slate-900">
                  {formatRupees(registration.amount)}
                </p>
              </div>

              <p className="mt-2 text-xs text-slate-500">
                {registration.department}
                {registration.doctorName ? ` · ${registration.doctorName}` : ""}
                {showClinic ? ` · ${registration.clinicName}` : ""}
              </p>

              <div className="mt-1 flex flex-wrap items-center gap-2">
                <p className="text-xs tabular-nums text-slate-500">
                  {formatVisitDate(registration.visitDate)}{" "}
                  {registration.visitTime}
                </p>
                {registration.visitType === "FOLLOW_UP" && <FollowUpPill />}
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
