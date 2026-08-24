"use client";

import { useState } from "react";
import DoctorForm from "@/components/doctors/DoctorForm";
import AvailabilityManager from "@/components/doctors/AvailabilityManager";
import LeaveManager from "@/components/doctors/LeaveManager";
import type { DoctorDetail } from "@/lib/doctors";

import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";

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

const FIELD_LABEL_CLASS = "text-sm font-semibold text-muted";

function NotSet() {
  return <span className="text-faint">Not set</span>;
}

export default function DoctorProfile({ doctor, canEdit, today }: DoctorProfileProps) {
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div>
      {isEditing ? (
        <div className="mb-8 space-y-6">
          <PageHeader title={`Edit ${doctor.name}`} />
          <Card>
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
          </Card>
        </div>
      ) : (
        <div className="mb-8 space-y-6">
          <PageHeader
            title={doctor.name}
            meta={
              <div className="flex flex-col gap-2 mt-1">
                <span>{doctor.department} · {doctor.clinicName}</span>
                {doctor.isOnLeaveToday && (
                  <div>
                    <span className="rounded-md bg-warn-bg px-2.5 py-1 text-xs font-semibold text-warn-ink">
                      On leave today
                    </span>
                  </div>
                )}
              </div>
            }
            actions={
              canEdit && (
                <Button variant="secondary" onClick={() => setIsEditing(true)}>
                  Edit Doctor
                </Button>
              )
            }
          />

          <Card>
            <dl className="grid gap-6 sm:grid-cols-3">
              <div>
                <dt className={FIELD_LABEL_CLASS}>Phone</dt>
                <dd className="mt-1 tabular-nums text-base text-ink">{doctor.phone ?? <NotSet />}</dd>
              </div>
              <div>
                <dt className={FIELD_LABEL_CLASS}>Gender</dt>
                <dd className="mt-1 text-base text-ink">{doctor.gender ?? <NotSet />}</dd>
              </div>
              <div>
                <dt className={FIELD_LABEL_CLASS}>Age</dt>
                <dd className="mt-1 tabular-nums text-base text-ink">
                  {doctor.age === null ? <NotSet /> : doctor.age}
                </dd>
              </div>
            </dl>
          </Card>
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
