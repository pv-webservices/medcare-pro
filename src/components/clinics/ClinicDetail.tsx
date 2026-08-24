"use client";

import { useState } from "react";
import ClinicForm from "@/components/clinics/ClinicForm";
import type { ClinicSummary } from "@/lib/clinics";

import PageHeader from "@/components/ui/PageHeader";
import Button, { buttonClasses } from "@/components/ui/Button";
import Card from "@/components/ui/Card";

/**
 * Clinic detail — PRD §6.2 (FR-2.1).
 *
 * Reads as a summary first; editing is an explicit choice rather than the
 * default state, so a clinic's details cannot be changed by accidental typing.
 */

interface ClinicDetailProps {
  clinic: ClinicSummary;
  canEdit: boolean;
}

const COUNT_CLASS = "text-3xl font-bold tabular-nums text-ink";
const COUNT_LABEL_CLASS = "mt-0.5 text-sm font-medium text-muted uppercase";
const FIELD_LABEL_CLASS = "text-sm font-semibold text-muted";

export default function ClinicDetail({ clinic, canEdit }: ClinicDetailProps) {
  const [isEditing, setIsEditing] = useState(false);

  if (isEditing) {
    return (
      <div className="space-y-6">
        <PageHeader title={`Edit ${clinic.name}`} />
        <Card>
        <ClinicForm
          initial={{
            id: clinic.id,
            name: clinic.name,
            address: clinic.address ?? "",
            city: clinic.city ?? "",
            logoUrl: clinic.logoUrl ?? "",
            themeColor: clinic.themeColor ?? "",
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
        back={{ href: "/clinics", label: "All clinics" }}
        title={clinic.name}
        meta={
          clinic.themeColor && (
            <div className="flex items-center gap-2 mt-1">
              <span
                aria-hidden
                className="h-4 w-4 shrink-0 rounded-full shadow-neu-raised-sm"
                style={{ backgroundColor: clinic.themeColor }}
              />
              <span className="text-sm font-medium text-muted">{clinic.themeColor}</span>
            </div>
          )
        }
        actions={
          canEdit && (
            <Button variant="secondary" onClick={() => setIsEditing(true)}>
              Edit Clinic
            </Button>
          )
        }
      />

      {/* FR-2.2's counts, repeated here as the headline numbers for this clinic. */}
      <div className="grid grid-cols-2 gap-4 sm:max-w-sm">
        <Card className="text-center p-6">
          <p className={COUNT_CLASS}>{clinic.doctorCount}</p>
          <p className={COUNT_LABEL_CLASS}>Doctors</p>
        </Card>
        <Card className="text-center p-6">
          <p className={COUNT_CLASS}>{clinic.patientCount}</p>
          <p className={COUNT_LABEL_CLASS}>Patients</p>
        </Card>
      </div>

      <Card>
        <dl className="grid gap-6 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <dt className={FIELD_LABEL_CLASS}>Address</dt>
            <dd className="mt-1 text-base text-ink whitespace-pre-line">
              {clinic.address ?? <span className="text-faint">Not set</span>}
            </dd>
          </div>
          <div>
            <dt className={FIELD_LABEL_CLASS}>City</dt>
            <dd className="mt-1 text-base text-ink">
              {clinic.city ?? <span className="text-faint">Not set</span>}
            </dd>
          </div>
          <div>
            <dt className={FIELD_LABEL_CLASS}>Brand colour</dt>
            <dd className="mt-1 text-base text-ink">
              {clinic.themeColor ?? (
                <span className="text-faint">Not set</span>
              )}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className={FIELD_LABEL_CLASS}>Logo URL</dt>
            <dd className="mt-1 text-base text-ink break-all">
              {clinic.logoUrl ?? (
                <span className="text-faint">Not set</span>
              )}
            </dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
