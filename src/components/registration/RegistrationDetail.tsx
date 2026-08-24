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
import PageHeader from "@/components/ui/PageHeader";
import Button, { buttonClasses } from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import StatusPill from "@/components/ui/StatusPill";

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

function NotSet() {
  return <span className="text-faint">Not set</span>;
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
      <div className="space-y-6">
        <PageHeader
          title={`Edit ${registration.patientName}`}
          meta="Every change is recorded in this registration's edit history."
        />

        <Card>
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
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/registration", label: "All registrations" }}
        title={registration.patientName}
        meta={
          <div className="flex flex-col gap-1.5 mt-2">
            <span className="text-sm font-medium tabular-nums text-muted">
              {registration.patientCode}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted">
                {registration.department}
                {registration.doctorName ? ` · ${registration.doctorName}` : ""} ·{""}
                {registration.clinicName}
              </span>
              <StatusPill
                tone={registration.visitType === "FOLLOW_UP" ? "accent" : "neutral"}
                hasDot={false}
              >
                {VISIT_TYPE_LABELS[registration.visitType]}
              </StatusPill>
              {visits.length > 1 && (
                <span className="text-sm text-muted">
                  · {visits.length} visits on this record
                </span>
              )}
            </div>
          </div>
        }
        actions={
          <>
            {canViewHistory && (
              <Link
                href={`/registration/${registration.id}/history`}
                className={buttonClasses("secondary", "md")}
              >
                Edit History
              </Link>
            )}
            {canEdit && (
              <Button variant="commit" onClick={() => setIsEditing(true)}>
                Edit Registration
              </Button>
            )}
          </>
        }
      />

      <Card>
        <dl className="grid gap-6 sm:grid-cols-3">
          <div>
            <dt className="text-sm font-semibold text-muted">Amount</dt>
            <dd className="mt-1 text-2xl font-bold tabular-nums text-ink">
              {formatRupees(registration.amount)}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-semibold text-muted">Visit date &amp; time</dt>
            <dd className="mt-1 text-base tabular-nums text-ink">
              {formatVisitDate(registration.visitDate)} at {registration.visitTime}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-semibold text-muted">Mobile number</dt>
            <dd className="mt-1 text-base tabular-nums text-ink">{registration.mobileNumber}</dd>
          </div>
          <div>
            <dt className="text-sm font-semibold text-muted">Age</dt>
            <dd className="mt-1 text-base tabular-nums text-ink">
              {registration.age === null ? <NotSet /> : registration.age}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-semibold text-muted">Gender</dt>
            <dd className="mt-1 text-base text-ink">{registration.gender ?? <NotSet />}</dd>
          </div>
          <div>
            <dt className="text-sm font-semibold text-muted">City</dt>
            <dd className="mt-1 text-base text-ink">{registration.city ?? <NotSet />}</dd>
          </div>
          <div className="sm:col-span-3">
            <dt className="text-sm font-semibold text-muted">Address</dt>
            <dd className="mt-1 text-base text-ink">{registration.address ?? <NotSet />}</dd>
          </div>
        </dl>
      </Card>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">
          Registered by {registration.createdByName ?? registration.createdByEmail}
        </p>
      </div>

      <div className="mt-8">
        <PatientVisits visits={visits} currentId={registration.id} />
      </div>
    </div>
  );
}
