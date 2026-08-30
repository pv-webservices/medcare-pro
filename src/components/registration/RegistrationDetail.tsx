"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Building2,
  Calendar,
  History,
  Home,
  Hospital,
  MapPin,
  Pencil,
  Phone,
  User,
  Users,
  Wallet,
} from "lucide-react";
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
import Button from "@/components/ui/Button";
import StatusPill from "@/components/ui/StatusPill";

/**
 * One registration — PRD §6.3 (FR-3.5, FR-3.6).
 *
 * Details read as a summary; editing is an explicit choice, so a record cannot
 * be changed by accidental typing. The edit history link appears only for roles
 * that hold `registration:history:read` — but the API enforces that too.
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

function formatVisitDate(date: string): string {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatCreatedAt(iso: string): string {
  const d = new Date(iso);
  const dateStr = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timeStr = d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${dateStr} at ${timeStr}`;
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
          breadcrumbs={[
            { label: "Registrations", href: "/registration" },
            { label: registration.patientCode, href: `/registration/${registration.id}` },
            { label: "Edit" },
          ]}
          description="Every change is recorded in this registration's edit history."
        />

        <div className="rounded-3xl border border-line bg-canvas p-6 sm:p-7 shadow-card">
          <RegistrationForm
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
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header & Meta Strip */}
      <div className="space-y-4">
        <PageHeader
          breadcrumbs={[
            { label: "Registrations", href: "/registration" },
            { label: registration.patientCode },
          ]}
          title={registration.patientName}
          scope={registration.clinicName}
          actions={
            <div className="flex items-center gap-3">
              {canViewHistory && (
                <Link
                  href={`/registration/${registration.id}/history`}
                  className="inline-flex items-center gap-2 rounded-xl border border-line bg-canvas px-4 py-2 text-label font-semibold text-ink shadow-sm hover:bg-canvas-deep transition-colors"
                >
                  <History className="h-4 w-4 text-muted" aria-hidden="true" />
                  <span>Edit history</span>
                </Link>
              )}
              {canEdit && (
                <Button
                  variant="primary"
                  onClick={() => setIsEditing(true)}
                  className="rounded-xl px-4 py-2 font-semibold text-label shadow-cta flex items-center gap-2"
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                  <span>Edit registration</span>
                </Button>
              )}
            </div>
          }
        />

        <div>
          <p className="serial text-body font-semibold text-muted">
            {registration.patientCode}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-label text-muted">
            <span className="inline-flex items-center gap-1.5">
              <Building2 className="h-4 w-4 text-muted" aria-hidden="true" />
              <span>Department: <strong className="font-semibold text-ink">{registration.department}</strong></span>
            </span>

            <span className="inline-flex items-center gap-1.5">
              <User className="h-4 w-4 text-muted" aria-hidden="true" />
              <span>Doctor: <strong className="font-semibold text-ink">{registration.doctorName ?? "—"}</strong></span>
            </span>

            <span className="inline-flex items-center gap-1.5">
              <Hospital className="h-4 w-4 text-muted" aria-hidden="true" />
              <span>Clinic: <strong className="font-semibold text-ink">{registration.clinicName}</strong></span>
            </span>

            <StatusPill
              tone={registration.visitType === "FOLLOW_UP" ? "accent" : "neutral"}
              hasDot={false}
            >
              {VISIT_TYPE_LABELS[registration.visitType]}
            </StatusPill>
          </div>
        </div>
      </div>

      {/* Main Details Card — Visual Facts */}
      <div className="rounded-3xl border border-line bg-canvas p-6 sm:p-8 shadow-card space-y-6">
        {/* Row 1: Amount, Visit Date & Time, Mobile Number */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-line/60">
          <div className="flex items-center gap-3.5 pt-0">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#EEF2FF] text-[#4F46E5]">
              <Wallet className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-label font-medium text-muted">Amount</p>
              <p className="mt-0.5 text-2xl font-bold tracking-tight text-ink tnum">
                {formatRupees(registration.amount)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3.5 pt-4 sm:pt-0 sm:pl-6">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#EEF2FF] text-[#4F46E5]">
              <Calendar className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-label font-medium text-muted">Visit date &amp; time</p>
              <p className="mt-0.5 text-base font-bold text-ink">
                {formatVisitDate(registration.visitDate)}
              </p>
              <p className="text-label text-muted tnum">{registration.visitTime}</p>
            </div>
          </div>

          <div className="flex items-center gap-3.5 pt-4 sm:pt-0 sm:pl-6">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#EEF2FF] text-[#4F46E5]">
              <Phone className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-label font-medium text-muted">Mobile number</p>
              <p className="mt-0.5 text-base font-bold text-ink tnum">
                {registration.mobileNumber}
              </p>
            </div>
          </div>
        </div>

        <hr className="border-line/60" />

        {/* Row 2: Age, Gender, City */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-line/60">
          <div className="flex items-center gap-3.5 pt-0">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#EEF2FF] text-[#4F46E5]">
              <User className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-label font-medium text-muted">Age</p>
              <p className="mt-0.5 text-base font-bold text-ink tnum">
                {registration.age ?? "Not set"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3.5 pt-4 sm:pt-0 sm:pl-6">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#EEF2FF] text-[#4F46E5]">
              <Users className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-label font-medium text-muted">Gender</p>
              <p className="mt-0.5 text-base font-bold text-ink">
                {registration.gender ?? "Not set"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3.5 pt-4 sm:pt-0 sm:pl-6">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#EEF2FF] text-[#4F46E5]">
              <MapPin className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-label font-medium text-muted">City</p>
              <p className="mt-0.5 text-base font-bold text-ink">
                {registration.city ?? "Not set"}
              </p>
            </div>
          </div>
        </div>

        <hr className="border-line/60" />

        {/* Row 3: Address */}
        <div className="flex items-center gap-3.5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#EEF2FF] text-[#4F46E5]">
            <Home className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <p className="text-label font-medium text-muted">Address</p>
            <p className="mt-0.5 text-base font-bold text-ink">
              {registration.address ?? "Not set"}
            </p>
          </div>
        </div>
      </div>

      {/* Meta Footer Strip */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-canvas px-6 py-4 shadow-card">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#EEF2FF] text-[#4F46E5]">
            <User className="h-4 w-4" aria-hidden="true" />
          </div>
          <span className="text-label font-medium text-muted">
            Registered by{" "}
            <strong className="font-semibold text-ink">
              {registration.createdByName ?? registration.createdByEmail}
            </strong>
          </span>
        </div>

        <div className="flex items-center gap-2 text-label text-muted">
          <Calendar className="h-4 w-4 text-muted" aria-hidden="true" />
          <span>Created on {formatCreatedAt(registration.createdAt)}</span>
        </div>
      </div>

      <PatientVisits visits={visits} currentId={registration.id} />
    </div>
  );
}
