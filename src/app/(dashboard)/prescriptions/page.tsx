import Link from "next/link";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";
import PrescriptionHistory from "@/components/prescriptions/PrescriptionHistory";
import {
  listPrescriptionsForActor,
  getPrescriptionFilterOptions,
} from "@/lib/prescriptions";
import { prescriptionPage } from "@/lib/prescriptionPages";
import { prescriptionFiltersSchema } from "@/lib/prescriptionValidation";
export const dynamic = "force-dynamic";
export default async function PrescriptionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const search = await searchParams;
  const candidate = Object.fromEntries(
    Object.entries(search).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" && entry[1] !== "",
    ),
  );
  const parsed = prescriptionFiltersSchema.safeParse(candidate);
  const filters = parsed.success
    ? parsed.data
    : prescriptionFiltersSchema.parse({});
  const history = await prescriptionPage((actor) =>
    listPrescriptionsForActor(actor, filters),
  );
  const options = await prescriptionPage((actor) =>
    getPrescriptionFilterOptions(actor),
  );
  const link = (page: number) =>
    `/prescriptions?${new URLSearchParams({ ...candidate, page: String(page) })}`;
  return (
    <section className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold">Prescriptions</h1>
        <p className="text-muted">
          Clinical records across your permitted clinics. Start consultations
          from a patient visit.
        </p>
      </header>
      {!parsed.success && (
        <p role="alert">
          Invalid filters. Showing unfiltered records within your authorized
          scope.
        </p>
      )}
      <form className="grid items-end gap-3 rounded-2xl border border-line bg-canvas p-5 sm:grid-cols-3">
        <Input
          id="rx-search"
          name="q"
          label="Patient / code / doctor / Rx number"
          defaultValue={filters.q}
          maxLength={255}
        />
        <Select
          id="rx-status"
          name="status"
          label="Status"
          defaultValue={filters.status || ""}
        >
          <option value="">All statuses</option>
          {["DRAFT", "ISSUED", "SUPERSEDED", "CANCELLED"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select
          id="rx-clinic"
          name="clinicId"
          label="Clinic"
          defaultValue={filters.clinicId || ""}
        >
          <option value="">All permitted clinics</option>
          {options.clinics.map((clinic) => (
            <option key={clinic.id} value={clinic.id}>
              {clinic.name}
            </option>
          ))}
        </Select>
        <Select
          id="rx-doctor"
          name="doctorId"
          label="Doctor"
          defaultValue={filters.doctorId || ""}
        >
          <option value="">All doctors</option>
          {options.doctors.map((doctor) => (
            <option key={doctor.id} value={doctor.id}>
              {doctor.name}
            </option>
          ))}
        </Select>
        <Input
          id="rx-from"
          name="from"
          label="Issued from"
          type="date"
          defaultValue={filters.from}
        />
        <Input
          id="rx-to"
          name="to"
          label="Issued to"
          type="date"
          defaultValue={filters.to}
        />
        {filters.patientId && (
          <input type="hidden" name="patientId" value={filters.patientId} />
        )}
        <Button type="submit">Search prescriptions</Button>
        <Link href="/prescriptions" className="py-3 text-accent underline">
          Reset filters
        </Link>
      </form>
      <PrescriptionHistory history={history} />
      <div className="flex items-center justify-between">
        <p className="text-muted">
          {history.total} records · Page {history.page}
        </p>
        <div className="flex gap-4">
          {history.page > 1 && (
            <Link
              className="text-accent underline"
              href={link(history.page - 1)}
            >
              Previous
            </Link>
          )}
          {history.page * history.pageSize < history.total && (
            <Link
              className="text-accent underline"
              href={link(history.page + 1)}
            >
              Next
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
