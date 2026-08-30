import Link from "next/link";
import { redirect } from "next/navigation";
import RegistrationFilters from "@/components/registration/RegistrationFilters";
import RegistrationsTable from "@/components/registration/RegistrationsTable";
import { buttonClasses } from "@/components/ui/Button";
import PageHeader, { Count } from "@/components/ui/PageHeader";
import Pagination from "@/components/ui/Pagination";
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
import ModuleLocked from "@/components/ui/ModuleLocked";
import { MODULE_FEATURES, moduleLock } from "@/lib/features";

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

  const locked = await moduleLock(actor, MODULE_FEATURES.registrations);
  if (locked) {
    return <ModuleLocked title="Registrations" reason={locked} />;
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
    <section className="space-y-4">
      <PageHeader
        title="Registrations"
        description="Manage patient registrations and visit records."
        scope={selectedClinic ? selectedClinic.name : "All clinics"}
        meta={
          <>
            <Count>{result.total}</Count>{" "}
            {result.total === 1 ? "registration" : "registrations"}
            {selectedClinic ? ` at ${selectedClinic.name}` : " across all clinics"}
            {isFiltered ? " matching your filters" : ""}
            .
          </>
        }
        actions={
          canCreate && (
            <Link
              href="/registration/new"
              className={buttonClasses("primary", "md")}
            >
              New registration
            </Link>
          )
        }
      />

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
        canCreate={canCreate}
      />

      <Pagination
        page={result.page}
        lastPage={lastPage}
        total={result.total}
        firstOnPage={firstOnPage}
        lastOnPage={lastOnPage}
        hrefFor={(page) => pageHref(params, page)}
        label="Registration pages"
      />
    </section>
  );
}
