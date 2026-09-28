import Link from "next/link";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";
import DuesTable from "@/components/billing/DuesTable";
import { billingPage } from "@/lib/billing/billingPages";
import { listDuesForActor } from "@/lib/billing/dues";
import { getInvoiceFilterOptions } from "@/lib/billing/invoices";
import { duesAgeBuckets, duesFiltersSchema } from "@/lib/billing/invoiceValidation";
import { DUES_AGE_LABELS } from "@/lib/billing/billingLabels";
import { accessibleClinicScope } from "@/lib/rbac";
import { formatRupees } from "@/lib/money";

export const dynamic = "force-dynamic";
export default async function DuesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = Object.fromEntries(Object.entries(await searchParams).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== ""));
  const parsed = duesFiltersSchema.safeParse(query);
  const filters = parsed.success ? parsed.data : duesFiltersSchema.parse({});
  const [dues, options, mayExport] = await billingPage((actor) => Promise.all([listDuesForActor(actor, filters), getInvoiceFilterOptions(actor),
    accessibleClinicScope(actor, "reports:export").then((scope) => scope.scope !== "none")]));
  const active = parsed.success ? query : {};
  const link = (page: number) => `/billing/dues?${new URLSearchParams({ ...active, page: String(page) })}`;
  const { page: _page, ...exportQuery } = active;
  return <section className="space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-bold">Dues</h1>
      <p className="text-muted">Issued bills with a balance still due. Open a bill to record a payment.</p></div>
      <Link href="/billing" className="text-accent underline">All bills</Link></header>
    {!parsed.success && <p role="alert">Invalid filters. Showing dues within your permitted clinics.</p>}
    <form className="grid items-end gap-3 rounded-2xl border border-line bg-canvas p-5 sm:grid-cols-3">
      <Input id="dues-search" name="search" label="Patient / mobile / code / invoice number" defaultValue={filters.search} maxLength={200} />
      <Select id="dues-clinic" name="clinicId" label="Clinic" defaultValue={filters.clinicId ?? ""}><option value="">All permitted clinics</option>{options.clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}</Select>
      <Select id="dues-doctor" name="doctorId" label="Doctor" defaultValue={filters.doctorId ?? ""}><option value="">All doctors</option>{options.doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name}</option>)}</Select>
      <Select id="dues-age" name="age" label="Days since issue (IST)" defaultValue={filters.age ?? ""}><option value="">Any age</option>{duesAgeBuckets.map((bucket) => <option key={bucket} value={bucket}>{DUES_AGE_LABELS[bucket]}</option>)}</Select>
      <Button type="submit">Filter dues</Button><Link href="/billing/dues" className="text-accent underline">Reset filters</Link>
    </form>
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-canvas-deep p-4">
      <p><span className="text-muted">Total balance due</span> <strong className="text-xl">{formatRupees(dues.totalBalanceDue)}</strong> · {dues.total} {dues.total === 1 ? "bill" : "bills"}</p>
      {mayExport && <a className="font-semibold text-accent underline" href={`/api/invoices/dues?${new URLSearchParams({ ...exportQuery, format: "csv" })}`}>Download CSV</a>}
    </div>
    <DuesTable dues={dues.items} />
    <nav aria-label="Dues pagination" className="flex gap-4">{dues.page > 1 && <Link href={link(dues.page - 1)}>Previous</Link>}{dues.page * dues.pageSize < dues.total && <Link href={link(dues.page + 1)}>Next</Link>}</nav>
  </section>;
}
