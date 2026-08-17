import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import DoctorProfile from "@/components/doctors/DoctorProfile";
import { todayDateOnly } from "@/lib/dates";
import { getDoctorForActor } from "@/lib/doctors";
import { can, ScopeError } from "@/lib/rbac";
import { requireActor, UnauthenticatedError } from "@/lib/session";

// Doctor profile, availability and leave — PRD §6.4 (FR-4.2 … FR-4.4).

interface DoctorDetailPageProps {
  // Next 16 hands route params to the page as a promise.
  params: Promise<{ id: string }>;
}

export default async function DoctorDetailPage({ params }: DoctorDetailPageProps) {
  const { id } = await params;

  let actor;
  try {
    actor = await requireActor();
  } catch (error: unknown) {
    if (error instanceof UnauthenticatedError) {
      redirect("/login");
    }
    throw error;
  }

  let doctor;
  try {
    doctor = await getDoctorForActor(actor, id);
  } catch (error: unknown) {
    // Another tenant's doctor, an unknown id, and one in a clinic outside this
    // user's scope all render the same 404 — see src/lib/doctors.ts.
    if (error instanceof ScopeError) {
      notFound();
    }
    throw error;
  }

  const canEdit = await can(actor, "doctor:edit", doctor.clinicId);

  return (
    <section className="max-w-[1400px] mx-auto w-full animate-in fade-in duration-500 space-y-6">
      <DoctorProfile
        doctor={doctor}
        canEdit={canEdit}
        // Resolved on the server so "today" matches the UTC dates in storage
        // rather than the viewer's local clock.
        today={todayDateOnly()}
      />
    </section>
  );
}
