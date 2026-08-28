"use client";

import { useState } from "react";
import DoctorForm from "@/components/doctors/DoctorForm";
import AvailabilityManager from "@/components/doctors/AvailabilityManager";
import LeaveManager from "@/components/doctors/LeaveManager";
import type { DoctorDetail } from "@/lib/doctors";

import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import StatusPill from "@/components/ui/StatusPill";

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

const FIELD_LABEL_CLASS = "text-body font-semibold text-muted";

function NotSet() {
  return <span className="text-faint">Not set</span>;
}

export default function DoctorProfile({ doctor, canEdit, today }: DoctorProfileProps) {
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div>
      {isEditing ? (
        <div className="mb-5 space-y-4">
          <PageHeader
            title={`Edit ${doctor.name}`}
            breadcrumbs={[
              { label: "Doctors", href: "/doctors" },
              { label: doctor.name, href: `/doctors/${doctor.id}` },
              { label: "Edit" },
            ]}
          />
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
        <div className="mb-5 space-y-4">
          <PageHeader
            title={doctor.name}
            breadcrumbs={[
              { label: "Doctors", href: "/doctors" },
              { label: doctor.name },
            ]}
            description={`${doctor.department} at ${doctor.clinicName}`}
            scope={doctor.clinicName}
            meta={
              doctor.isOnLeaveToday ? (
                <StatusPill tone="warn">On leave today</StatusPill>
              ) : undefined
            }
            actions={
              canEdit && (
                <Button variant="secondary" onClick={() => setIsEditing(true)}>
                  Edit doctor
                </Button>
              )
            }
          />

          <Card>
            <dl className="grid gap-5 sm:grid-cols-3">
              <div>
                <dt className={FIELD_LABEL_CLASS}>Phone</dt>
                <dd className="tnum mt-1 text-body font-medium text-ink">{doctor.phone ?? <NotSet />}</dd>
              </div>
              <div>
                <dt className={FIELD_LABEL_CLASS}>Gender</dt>
                <dd className="mt-1 text-body font-medium text-ink">{doctor.gender ?? <NotSet />}</dd>
              </div>
              <div>
                <dt className={FIELD_LABEL_CLASS}>Age</dt>
                <dd className="tnum mt-1 text-body font-medium text-ink">
                  {doctor.age === null ? <NotSet /> : doctor.age}
                </dd>
              </div>
            </dl>
          </Card>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
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
