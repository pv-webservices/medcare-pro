"use client";

import { useState } from "react";
import Link from "next/link";
import RegistrationForm, {
  type DoctorOption,
} from "@/components/registration/RegistrationForm";
import PatientVisits from "@/components/registration/PatientVisits";
import { formatRupees } from "@/lib/money";
import {
  VISIT_TYPE_LABELS,
  type PatientVisit,
  type RegistrationRecord,
} from "@/lib/registrations";

/**
 * One registration — PRD §6.3 (FR-3.5, FR-3.6).
 *
 * Details read as a summary; editing is an explicit choice, so a record cannot
 * be changed by accidental typing. The edit history link appears only for roles
 * that hold `registration:history:read` — but the API enforces that too, since
 * hiding a link is not access control.
 */

interface RegistrationDetailProps {
  registration: RegistrationRecord;
  doctors: readonly DoctorOption[];
  departments: readonly string[];
  /** Every visit by this patient, newest first — includes the one shown here. */
  visits: readonly PatientVisit[];
  today: string;
  now: string;
  canEdit: boolean;
  canViewHistory: boolean;
}

const FIELD_LABEL_CLASS = "text-sm text-black/55 dark:text-white/55";

function NotSet() {
  return <span className="text-black/40 dark:text-white/40">Not set</span>;
}

function formatVisitDate(date: string): string {
  // Parsed as UTC to match how the date is stored, so the label cannot slip a day.
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function RegistrationDetail({
  registration,
  doctors,
  departments,
  visits,
  today,
  now,
  canEdit,
  canViewHistory,
}: RegistrationDetailProps) {
  const [isEditing, setIsEditing] = useState(false);

  if (isEditing) {
    return (
      <div>
        <h1 className="mb-1 text-2xl font-semibold">
          Edit {registration.patientName}
        </h1>
        <p className="mb-4 text-sm text-black/60 dark:text-white/60">
          {/* FR-3.6 — say it plainly rather than surprising them afterwards. */}
          Every change is recorded in this registration&rsquo;s edit history.
        </p>

        <RegistrationForm
          // The clinic cannot change after creation, so the picker is not
          // offered; this list exists only to satisfy the shared form's props.
          clinics={[
            { id: registration.clinicId, name: registration.clinicName },
          ]}
          doctors={doctors}
          departments={departments}
          today={today}
          now={now}
          registrationId={registration.id}
          initial={{
            clinicId: registration.clinicId,
            // Fixed for an edit — the visit already belongs to this patient.
            patientId: registration.patientId,
            patientCode: registration.patientCode,
            name: registration.patientName,
            age: registration.age === null ? "" : String(registration.age),
            gender: registration.gender ?? "",
            mobileNumber: registration.mobileNumber,
            address: registration.address ?? "",
            city: registration.city ?? "",
            doctorId: registration.doctorId ?? "",
            department: registration.department,
            amount: registration.amount,
            visitDate: registration.visitDate,
            visitTime: registration.visitTime,
            visitType: registration.visitType,
          }}
          onCancel={() => setIsEditing(false)}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm tabular-nums text-black/55 dark:text-white/55">
            {registration.patientCode}
          </p>
          <h1 className="text-2xl font-semibold">{registration.patientName}</h1>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            {registration.department}
            {registration.doctorName ? ` · ${registration.doctorName}` : ""} ·{" "}
            {registration.clinicName}
          </p>
          <p className="mt-2">
            <span
              className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                registration.visitType === "FOLLOW_UP"
                  ? "bg-sky-600/15 text-sky-800 dark:text-sky-300"
                  : "bg-black/10 text-black/70 dark:bg-white/15 dark:text-white/70"
              }`}
            >
              {VISIT_TYPE_LABELS[registration.visitType]}
            </span>
            {visits.length > 1 && (
              <span className="ml-2 text-sm text-black/55 dark:text-white/55">
                {visits.length} visits on this record
              </span>
            )}
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          {canViewHistory && (
            <Link
              href={`/registration/${registration.id}/history`}
              className="inline-flex min-h-11 items-center rounded border border-black/20 px-5 text-base font-medium dark:border-white/25"
            >
              Edit History
            </Link>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="min-h-11 rounded bg-foreground px-5 text-base font-medium text-background"
            >
              Edit Registration
            </button>
          )}
        </div>
      </div>

      <dl className="grid gap-4 sm:grid-cols-3">
        <div>
          <dt className={FIELD_LABEL_CLASS}>Amount</dt>
          <dd className="mt-0.5 text-2xl font-semibold tabular-nums">
            {formatRupees(registration.amount)}
          </dd>
        </div>
        <div>
          <dt className={FIELD_LABEL_CLASS}>Visit date &amp; time</dt>
          <dd className="mt-0.5 tabular-nums">
            {formatVisitDate(registration.visitDate)} at {registration.visitTime}
          </dd>
        </div>
        <div>
          <dt className={FIELD_LABEL_CLASS}>Mobile number</dt>
          <dd className="mt-0.5 tabular-nums">{registration.mobileNumber}</dd>
        </div>
        <div>
          <dt className={FIELD_LABEL_CLASS}>Age</dt>
          <dd className="mt-0.5 tabular-nums">
            {registration.age === null ? <NotSet /> : registration.age}
          </dd>
        </div>
        <div>
          <dt className={FIELD_LABEL_CLASS}>Gender</dt>
          <dd className="mt-0.5">{registration.gender ?? <NotSet />}</dd>
        </div>
        <div>
          <dt className={FIELD_LABEL_CLASS}>City</dt>
          <dd className="mt-0.5">{registration.city ?? <NotSet />}</dd>
        </div>
        <div className="sm:col-span-3">
          <dt className={FIELD_LABEL_CLASS}>Address</dt>
          <dd className="mt-0.5">{registration.address ?? <NotSet />}</dd>
        </div>
      </dl>

      <p className="mt-6 text-sm text-black/55 dark:text-white/55">
        Registered by {registration.createdByName ?? registration.createdByEmail}
        .
      </p>

      <div className="mt-8">
        <PatientVisits visits={visits} currentId={registration.id} />
      </div>
    </div>
  );
}
