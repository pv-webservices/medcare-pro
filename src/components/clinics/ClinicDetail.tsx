"use client";

import { useState } from "react";
import ClinicForm from "@/components/clinics/ClinicForm";
import type { ClinicSummary } from "@/lib/clinics";

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

const COUNT_CLASS = "text-3xl font-semibold tabular-nums";
const COUNT_LABEL_CLASS = "mt-0.5 text-sm text-black/55 dark:text-white/55";
const FIELD_LABEL_CLASS = "text-sm text-black/55 dark:text-white/55";

export default function ClinicDetail({ clinic, canEdit }: ClinicDetailProps) {
  const [isEditing, setIsEditing] = useState(false);

  if (isEditing) {
    return (
      <div>
        <h1 className="mb-4 text-2xl font-semibold">Edit {clinic.name}</h1>
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
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          {clinic.themeColor && (
            <span
              aria-hidden
              className="h-8 w-8 shrink-0 rounded border border-black/15 dark:border-white/20"
              style={{ backgroundColor: clinic.themeColor }}
            />
          )}
          <h1 className="text-2xl font-semibold">{clinic.name}</h1>
        </div>

        {canEdit && (
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="min-h-11 rounded border border-black/20 px-5 text-base font-medium dark:border-white/25"
          >
            Edit Clinic
          </button>
        )}
      </div>

      {/* FR-2.2's counts, repeated here as the headline numbers for this clinic. */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:max-w-sm">
        <div className="rounded border border-black/15 px-4 py-3 dark:border-white/20">
          <p className={COUNT_CLASS}>{clinic.doctorCount}</p>
          <p className={COUNT_LABEL_CLASS}>Doctors</p>
        </div>
        <div className="rounded border border-black/15 px-4 py-3 dark:border-white/20">
          <p className={COUNT_CLASS}>{clinic.patientCount}</p>
          <p className={COUNT_LABEL_CLASS}>Patients</p>
        </div>
      </div>

      <dl className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <dt className={FIELD_LABEL_CLASS}>Address</dt>
          <dd className="mt-0.5 whitespace-pre-line">
            {clinic.address ?? <span className="text-black/40 dark:text-white/40">Not set</span>}
          </dd>
        </div>
        <div>
          <dt className={FIELD_LABEL_CLASS}>City</dt>
          <dd className="mt-0.5">
            {clinic.city ?? <span className="text-black/40 dark:text-white/40">Not set</span>}
          </dd>
        </div>
        <div>
          <dt className={FIELD_LABEL_CLASS}>Brand colour</dt>
          <dd className="mt-0.5">
            {clinic.themeColor ?? (
              <span className="text-black/40 dark:text-white/40">Not set</span>
            )}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className={FIELD_LABEL_CLASS}>Logo URL</dt>
          <dd className="mt-0.5 break-all">
            {clinic.logoUrl ?? (
              <span className="text-black/40 dark:text-white/40">Not set</span>
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}
