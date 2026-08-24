import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import AppointmentFilters from "@/components/appointments/AppointmentFilters";
import AppointmentsTable from "@/components/appointments/AppointmentsTable";
import { buttonClasses } from "@/components/ui/Button";
import ModuleLocked from "@/components/ui/ModuleLocked";
import PageHeader, { Count } from "@/components/ui/PageHeader";
import {
  appointmentFilterSchema,
  listAppointments,
  type AppointmentFilters as Filters,
} from "@/lib/appointments";
import { formatAppointmentDate } from "@/components/appointments/status";
import { todayDateOnly } from "@/lib/dates";
import { listClinicsForActor } from "@/lib/clinics";
import { listDoctorsForActor } from "@/lib/doctors";
import { MODULE_FEATURES, moduleLock } from "@/lib/features";
import { can } from "@/lib/rbac";
import { resolveSelectedClinicId } from "@/lib/selectedClinic";
import { requireActor, UnauthenticatedError } from "@/lib/session";

// The appointment board — AP-6.
//
// An Appointment is a slot booked in a doctor's day; a Registration is the
// visit it becomes once the patient arrives and it is converted. Two records,
// two words, never interchanged — see the vocabulary rule in
// .claude/skills/admin-dashboard-ui.
//
// DEFAULTS TO TODAY. A front desk opening this screen is asking "who is coming
// in today?", not"every slot ever booked". The date control clears to widen it.
//
// Like the registration list, the clinic comes from the sidebar switcher
// (FR-2.3) rather than a filter of its own, so the two can never disagree — and
// lib/appointments.ts re-checks it against this user's scope regardless.

interface AppointmentBoardPageProps {
  // Next 16 hands search params to the page as a promise.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Keeps the applied filters on a page link, replacing just the page number. */
function pageHref(
  params: Record<string, string | string[] | undefined>,
  page: number,
): string {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    const single = Array.isArray(value) ? value[0] : value;
    // clinicId comes from the switcher, not the URL, so it is not carried over.
    if (single && key !== "page" && key !== "clinicId") {
      query.set(key, single);
    }
  }

  query.set("page", String(page));
  return `/appointments?${query.toString()}`;
}

/** The one string a single query parameter can be. */
function single(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function AppointmentBoardPage({
  searchParams,
}: AppointmentBoardPageProps) {
  let actor;
  try {
    actor = await requireActor();
  } catch (error: unknown) {
    if (error instanceof UnauthenticatedError) {
      redirect("/login");
    }
    throw error;
  }

  // `appointments` is a PREMIUM feature, so this is the first gate — someone
  // whose organisation does not have it is told that, rather than shown an
  // empty board.
  const locked = await moduleLock(actor, MODULE_FEATURES.appointments);
  if (locked) {
    return <ModuleLocked title="Appointments" reason={locked} />;
  }

  const params = await searchParams;
  const selectedClinicId = await resolveSelectedClinicId(actor);
  const today = todayDateOnly();

  // A date is only absent when the reader has cleared it on purpose; a first
  // visit to the page gets today.
  const requestedDate = "date" in params ? single(params.date) : today;

  let filters: Filters;
  try {
    filters = appointmentFilterSchema.parse({
      ...params,
      date: requestedDate,
      clinicId: selectedClinicId ?? undefined,
    });
  } catch {
    // A hand-edited or stale URL should narrow nothing, not break the board.
    filters = {
      date: today,
      clinicId: selectedClinicId ?? undefined,
    } as Filters;
  }

  const [
    result,
    clinics,
    doctors,
    canCreate,
    canCheckIn,
    canConvert,
    canCancel,
    canConfirm,
  ] = await Promise.all([
    listAppointments(actor, filters),
    listClinicsForActor(actor),
    listDoctorsForActor(actor, { clinicId: selectedClinicId }),
    can(actor, "appointment:create", selectedClinicId ?? undefined),
    can(actor, "appointment:checkin", selectedClinicId ?? undefined),
    can(actor, "appointment:convert", selectedClinicId ?? undefined),
    can(actor, "appointment:cancel", selectedClinicId ?? undefined),
    // AP-9. The same key that governs correcting a booking, because confirming
    // is the desk writing down something the patient said about theirs.
    can(actor, "appointment:update", selectedClinicId ?? undefined),
  ]);

  const selectedClinic = selectedClinicId
    ? clinics.find((clinic) => clinic.id === selectedClinicId)
    : undefined;

  const appliedDate = filters.date ?? "";
  const isFiltered = Boolean(
    filters.doctorId || filters.status || filters.includeHistory || appliedDate,
  );
  const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
  const firstOnPage = (result.page - 1) * result.pageSize + 1;
  const lastOnPage = Math.min(result.page * result.pageSize, result.total);

  return (
    <section className="max-w-[1400px] mx-auto w-full animate-in fade-in duration-500 space-y-6">
      <PageHeader
        title="Appointments"
        meta={
          <>
            <Count>{result.total}</Count>{""}
            {result.total === 1 ? "appointment" : "appointments"}
            {appliedDate
              ? appliedDate === today
                ? "today"
                : ` on ${formatAppointmentDate(appliedDate)}`
              : "upcoming"}
            {selectedClinic ? ` at ${selectedClinic.name}` : "across all clinics"}
          </>
        }
        actions={
          <>
            {/* AP-7. Shown to everyone who can reach the board, not only to
                whoever may edit the price list: the desk quotes these prices,
                and the screen is read-only for a role without
                `appointment:type:manage`. It is also the only way in — there is
                deliberately no sidebar entry of its own. */}
            <Link
              href="/appointments/types"
              className={buttonClasses("secondary", "md")}
            >
              Services
            </Link>
            {canCreate && (
              <Link
                href="/appointments/new"
                className={buttonClasses("commit", "md")}
              >
                Book Appointment
              </Link>
            )}
          </>
        }
      />

      <AppointmentFilters
        doctors={doctors.map(({ id, name }) => ({ id, name }))}
        today={today}
        initial={{
          date: appliedDate,
          doctorId: filters.doctorId ?? "",
          status: filters.status ?? "",
          includeHistory: filters.includeHistory ?? false,
        }}
      />

      <AppointmentsTable
        appointments={result.rows}
        showClinic={!selectedClinic}
        showDate={appliedDate === ""}
        isFiltered={isFiltered}
        permissions={{ canCheckIn, canConvert, canCancel, canConfirm, canCreate }}
      />

      {lastPage > 1 && (
        <nav
          aria-label="Appointment pages"
          className="mt-4 flex flex-wrap items-center justify-between gap-3"
        >
          <p className="text-label text-muted">
            Showing <Count>{firstOnPage}</Count>–<Count>{lastOnPage}</Count> of{""}
            <Count>{result.total}</Count>
          </p>

          <div className="flex gap-2">
            {result.page > 1 && (
              <Link
                href={pageHref(params, result.page - 1)}
                className={buttonClasses("secondary", "md")}
              >
                <ChevronLeft
                  aria-hidden="true"
                  strokeWidth={1.75}
                  className="h-4 w-4"
                />
                Previous
              </Link>
            )}
            {result.page < lastPage && (
              <Link
                href={pageHref(params, result.page + 1)}
                className={buttonClasses("secondary", "md")}
              >
                Next
                <ChevronRight
                  aria-hidden="true"
                  strokeWidth={1.75}
                  className="h-4 w-4"
                />
              </Link>
            )}
          </div>
        </nav>
      )}
    </section>
  );
}
