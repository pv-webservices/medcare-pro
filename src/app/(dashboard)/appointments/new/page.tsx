import Link from "next/link";
import { redirect } from "next/navigation";
import BookingForm from "@/components/appointments/BookingForm";
import { buttonClasses } from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import ModuleLocked from "@/components/ui/ModuleLocked";
import PageHeader from "@/components/ui/PageHeader";
import { listAppointmentTypes } from "@/lib/appointmentTypes";
import { listClinicsForActor } from "@/lib/clinics";
import { todayDateOnly } from "@/lib/dates";
import { listDoctorsForActor } from "@/lib/doctors";
import { MODULE_FEATURES, moduleLock } from "@/lib/features";
import { can } from "@/lib/rbac";
import { resolveSelectedClinicId } from "@/lib/selectedClinic";
import { requireActor, UnauthenticatedError } from "@/lib/session";

// Book an appointment — AP-6, over AP-3's createAppointment.
//
// EVERY LIST HERE IS ALREADY SCOPED by the library that produced it: clinics
// and doctors to what this user can reach, services to their organisation. The
// form narrows them further as the desk makes choices, and the server re-derives
// all three from the session when the booking is posted — nothing on this page
// is trusted on the way back in.
//
// The page refuses a caller without `appointment:create` rather than rendering
// a form whose submit button would always fail. That is a courtesy, not the
// enforcement: POST /api/appointments runs the same check regardless.

export default async function BookAppointmentPage() {
  let actor;
  try {
    actor = await requireActor();
  } catch (error: unknown) {
    if (error instanceof UnauthenticatedError) {
      redirect("/login");
    }
    throw error;
  }

  const locked = await moduleLock(actor, MODULE_FEATURES.appointments);
  if (locked) {
    return <ModuleLocked title="Appointments" reason={locked} />;
  }

  const selectedClinicId = await resolveSelectedClinicId(actor);

  if (!(await can(actor, "appointment:create", selectedClinicId ?? undefined))) {
    redirect("/appointments");
  }

  const [clinics, doctors, services, canManageServices] = await Promise.all([
    listClinicsForActor(actor),
    listDoctorsForActor(actor, {}),
    listAppointmentTypes(actor, {}),
    // AP-7. Only to decide whether the dead end below offers a way out of
    // itself; the services screen re-checks this per row regardless.
    can(actor, "appointment:type:manage", selectedClinicId ?? undefined),
  ]);

  // Only live services can be booked onto. A retired one still exists so the
  // appointments already booked with it stay readable, but it must not be
  // offered here.
  const bookable = services.filter((service) => service.isActive);

  return (
    <section className="mx-auto w-full max-w-4xl">
      <PageHeader
        title="Book an appointment"
        description="Hold a slot in a doctor's day. The patient record is created later, when they arrive and the appointment is registered."
        breadcrumbs={[{ label: "Appointments", href: "/appointments" }, { label: "Book an appointment" }]}
      />

      {bookable.length === 0 ? (
        <EmptyState
          title="No bookable services yet"
          guidance={
            canManageServices
              ? "Add at least one service — its length and its price — before anything can be booked."
              : "An admin needs to add at least one service — its length and its price — before anything can be booked."
          }
          action={
            canManageServices ? (
              <Link
                href="/appointments/types"
                className={buttonClasses("primary", "md")}
              >
                Add a Service
              </Link>
            ) : undefined
          }
        />
      ) : doctors.length === 0 ? (
        <EmptyState
          title="No doctors to book with"
          guidance="Add a doctor, and set the hours they work, before booking a slot in their day."
        />
      ) : (
        <BookingForm
          clinics={clinics.map(({ id, name }) => ({ id, name }))}
          doctors={doctors.map(({ id, name, department, clinicId }) => ({
            id,
            name,
            department,
            clinicId,
          }))}
          services={bookable.map(
            ({ id, name, durationMinutes, defaultAmount, clinicId }) => ({
              id,
              name,
              durationMinutes,
              defaultAmount,
              clinicId,
            }),
          )}
          selectedClinicId={selectedClinicId}
          today={todayDateOnly()}
        />
      )}
    </section>
  );
}
