"use client";

import { useState } from "react";
import DoctorForm from "@/components/doctors/DoctorForm";
import AvailabilityManager from "@/components/doctors/AvailabilityManager";
import LeaveManager from "@/components/doctors/LeaveManager";
import type { DoctorDetail } from "@/lib/doctors";

/**
 * Doctor profile — PRD §6.4 (FR-4.2 … FR-4.4).
 *
 * Profile details read as a summary; editing is an explicit choice so a
 * doctor's record cannot be changed by accidental typing. Availability and
 * leave sit below because they are what staff come here to change day to day.
 */

interface DoctorProfileProps {
  doctor: DoctorDetail;
  canEdit: boolean;
  today: string;
}

const FIELD_LABEL_CLASS = "text-sm text-black/55 dark:text-white/55";

function NotSet() {
  return <span className="text-black/40 dark:text-white/40">Not set</span>;
}

export default function DoctorProfile({ doctor, canEdit, today }: DoctorProfileProps) {
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div>
      {isEditing ? (
        <div className="mb-8">
          <h1 className="mb-4 text-2xl font-semibold">Edit {doctor.name}</h1>
          <DoctorForm
            // Clinic cannot be changed after creation, so the picker is not
            // offered — this list exists only to satisfy the shared form's props.
            clinics={[{ id: doctor.clinicId, name: doctor.clinicName }]}
            initial={{
              id: doctor.id,
              clinicId: doctor.clinicId,
              name: doctor.name,
              department: doctor.department,
              gender: doctor.gender ?? "",
              age: doctor.age === null ? "" : String(doctor.age),
              phone: doctor.phone ?? "",
            }}
            onCancel={() => setIsEditing(false)}
          />
        </div>
      ) : (
        <div className="mb-8">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold">{doctor.name}</h1>
              <p className="mt-1 text-sm text-black/60 dark:text-white/60">
                {doctor.department} · {doctor.clinicName}
              </p>
              {doctor.isOnLeaveToday && (
                <p className="mt-2">
                  <span className="rounded bg-amber-600/15 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-400">
                    On leave today
                  </span>
                </p>
              )}
            </div>

            {canEdit && (
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="min-h-11 rounded border border-black/20 px-5 text-base font-medium dark:border-white/25"
              >
                Edit Doctor
              </button>
            )}
          </div>

          <dl className="grid gap-4 sm:grid-cols-3">
            <div>
              <dt className={FIELD_LABEL_CLASS}>Phone</dt>
              <dd className="mt-0.5 tabular-nums">{doctor.phone ?? <NotSet />}</dd>
            </div>
            <div>
              <dt className={FIELD_LABEL_CLASS}>Gender</dt>
              <dd className="mt-0.5">{doctor.gender ?? <NotSet />}</dd>
            </div>
            <div>
              <dt className={FIELD_LABEL_CLASS}>Age</dt>
              <dd className="mt-0.5 tabular-nums">
                {doctor.age === null ? <NotSet /> : doctor.age}
              </dd>
            </div>
          </dl>
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-2">
        <AvailabilityManager
          doctorId={doctor.id}
          entries={doctor.availability}
          canEdit={canEdit}
          today={today}
        />
        <LeaveManager
          doctorId={doctor.id}
          entries={doctor.leave}
          canEdit={canEdit}
          today={today}
        />
      </div>
    </div>
  );
}
