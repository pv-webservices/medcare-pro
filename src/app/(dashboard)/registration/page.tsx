import Link from "next/link";
import { redirect } from "next/navigation";
import RegistrationFilters from "@/components/registration/RegistrationFilters";
import RegistrationsTable from "@/components/registration/RegistrationsTable";
import { listClinicsForActor } from "@/lib/clinics";
import { listDoctorsForActor } from "@/lib/doctors";
import { can } from "@/lib/rbac";
import {
  listDepartmentsForActor,
  listRegistrationsForActor,
  parseRegistrationFilters,
  type RegistrationFilters as Filters,
} from "@/lib/registrations";
import { resolveSelectedClinicId } from "@/lib/selectedClinic";
import { requireActor, UnauthenticatedError } from "@/lib/session";

// Registration list — PRD §6.3 (FR-3.2 … FR-3.4): search, filter, export.
//
// FR-3.3 lists clinic among the filters; that job belongs to the sidebar clinic
// switcher (FR-2.3), which applies to every module, rather than to a second
// clinic control that could disagree with it. Any `clinicId` in the URL is
// therefore overridden by the switcher's selection — and would be re-checked
// against this user's scope regardless (see src/lib/clinicScope.ts).

interface RegistrationListPageProps {
  // Next 16 hands search params to the page as a promise.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const NO_FILTERS: Filters = {};

/** Keeps the applied filters on a page link, replacing just the page number. */
function pageHref(params: Record<string, string | string[] | undefined>, page: number): string {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    const single = Array.isArray(value) ? value[0] : value;
    // clinicId comes from the switcher, not the URL, so it is not carried over.
    if (single && key !== "page" && key !== "clinicId") {
      query.set(key, single);
    }
  }

  query.set("page", String(page));
  return `/registration?${query.toString()}`;
}

export default async function RegistrationListPage({
  searchParams,
}: RegistrationListPageProps) {
  let actor;
  try {
    actor = await requireActor();
  } catch (error: unknown) {
    if (error instanceof UnauthenticatedError) {
      redirect("/login");
    }
    throw error;
  }

  const params = await searchParams;
  const selectedClinicId = await resolveSelectedClinicId(actor);

  let filters: Filters;
  try {
    filters = parseRegistrationFilters({
      ...params,
      clinicId: selectedClinicId ?? undefined,
    });
  } catch {
    // A hand-edited or stale URL should narrow nothing, not break the page.
    filters = { ...NO_FILTERS, clinicId: selectedClinicId ?? undefined };
  }

  const [result, clinics, doctors, departments, canCreate] = await Promise.all([
    listRegistrationsForActor(actor, filters),
    listClinicsForActor(actor),
    listDoctorsForActor(actor, { clinicId: selectedClinicId }),
    listDepartmentsForActor(actor, selectedClinicId),
    can(actor, "registration:create", selectedClinicId ?? undefined),
  ]);

  const selectedClinic = selectedClinicId
    ? clinics.find((clinic) => clinic.id === selectedClinicId)
    : undefined;

  const isFiltered = Boolean(
    filters.search || filters.doctorId || filters.department || filters.from || filters.to,
  );
  const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
  const firstOnPage = (result.page - 1) * result.pageSize + 1;
  const lastOnPage = Math.min(result.page * result.pageSize, result.total);

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Registrations</h1>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            {result.total === 1 ? "1 registration" : `${result.total} registrations`}
            {selectedClinic ? ` at ${selectedClinic.name}` : " across all clinics"}
            {isFiltered ? " matching your filters" : ""}.
          </p>
        </div>

        {canCreate && (
          <Link
            href="/registration/new"
            className="inline-flex min-h-11 items-center rounded bg-foreground px-5 text-base font-medium text-background"
          >
            New Registration
          </Link>
        )}
      </div>

      <RegistrationFilters
        doctors={doctors.map(({ id, name }) => ({ id, name }))}
        departments={departments}
        clinicId={selectedClinicId}
        initial={{
          search: filters.search ?? "",
          doctorId: filters.doctorId ?? "",
          department: filters.department ?? "",
          from: filters.from ?? "",
          to: filters.to ?? "",
        }}
      />

      <RegistrationsTable
        registrations={result.rows}
        showClinic={!selectedClinic}
        isFiltered={isFiltered}
      />

      {lastPage > 1 && (
        <nav
          aria-label="Registration pages"
          className="mt-4 flex flex-wrap items-center justify-between gap-3"
        >
          <p className="text-sm text-black/60 dark:text-white/60">
            Showing {firstOnPage}–{lastOnPage} of {result.total}
          </p>

          <div className="flex gap-3">
            {result.page > 1 && (
              <Link
                href={pageHref(params, result.page - 1)}
                className="inline-flex min-h-11 items-center rounded border border-black/20 px-4 text-sm font-medium dark:border-white/25"
              >
                ← Previous
              </Link>
            )}
            {result.page < lastPage && (
              <Link
                href={pageHref(params, result.page + 1)}
                className="inline-flex min-h-11 items-center rounded border border-black/20 px-4 text-sm font-medium dark:border-white/25"
              >
                Next →
              </Link>
            )}
          </div>
        </nav>
      )}
    </section>
  );
}
