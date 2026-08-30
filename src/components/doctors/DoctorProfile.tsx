"use client";

import { useState } from "react";
import { Calendar, Pencil, Phone, User } from "lucide-react";
import DoctorForm from "@/components/doctors/DoctorForm";
import AvailabilityManager from "@/components/doctors/AvailabilityManager";
import LeaveManager from "@/components/doctors/LeaveManager";
import type { DoctorDetail } from "@/lib/doctors";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
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

export default function DoctorProfile({ doctor, canEdit, today }: DoctorProfileProps) {
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div className="space-y-6">
      {isEditing ? (
        <div className="space-y-5">
          <PageHeader
            title={`Edit ${doctor.name}`}
            breadcrumbs={[
              { label: "Doctors", href: "/doctors" },
              { label: doctor.name, href: `/doctors/${doctor.id}` },
              { label: "Edit" },
            ]}
          />
          <div className="rounded-3xl border border-line bg-canvas p-6 sm:p-7 shadow-card">
            <DoctorForm
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
        </div>
      ) : (
        <div className="space-y-5">
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
                <Button
                  variant="secondary"
                  onClick={() => setIsEditing(true)}
                  className="rounded-xl px-4 py-2 font-semibold text-label shadow-sm flex items-center gap-1.5"
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                  Edit doctor
                </Button>
              )
            }
          />

          {/* Quick Info Summary Card */}
          <div className="rounded-3xl border border-line bg-canvas p-6 shadow-card">
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-line/60">
              {/* Phone */}
              <div className="flex items-center gap-3.5 pt-0">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#EEF2FF] text-[#4F46E5]">
                  <Phone className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-label font-medium text-muted">Phone</p>
                  <p className="mt-0.5 text-lg font-bold tracking-tight text-ink tnum">
                    {doctor.phone || "—"}
                  </p>
                </div>
              </div>

              {/* Gender */}
              <div className="flex items-center gap-3.5 pt-4 sm:pt-0 sm:pl-6">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#EFF6FF] text-[#3B82F6]">
                  <User className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-label font-medium text-muted">Gender</p>
                  <p className="mt-0.5 text-lg font-bold tracking-tight text-ink">
                    {doctor.gender || "Not recorded"}
                  </p>
                </div>
              </div>

              {/* Age */}
              <div className="flex items-center gap-3.5 pt-4 sm:pt-0 sm:pl-6">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#F5F3FF] text-[#7C3AED]">
                  <Calendar className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-label font-medium text-muted">Age</p>
                  <p className="mt-0.5 text-lg font-bold tracking-tight text-ink tnum">
                    {doctor.age ?? "—"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Availability and Leave Two-Column Section */}
      <div className="grid gap-6 lg:grid-cols-2 items-start">
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
