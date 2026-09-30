import Link from "next/link";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";
import NewBillPicker from "@/components/billing/NewBillPicker";
import { billingPage } from "@/lib/billing/billingPages";
import { mayStartBills } from "@/lib/billing/newBill";
import { getInvoiceFilterOptions, listInvoicesForActor } from "@/lib/billing/invoices";
import { invoiceFiltersSchema } from "@/lib/billing/invoiceValidation";
import { formatRupees } from "@/lib/money";
import { INVOICE_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/billing/billingLabels";

export const dynamic = "force-dynamic";
export default async function BillingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = Object.fromEntries(Object.entries(await searchParams).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== ""));
  const parsed = invoiceFiltersSchema.safeParse(query);
  const filters = parsed.success ? parsed.data : invoiceFiltersSchema.parse({});
  const [invoices, options, mayCreate] = await billingPage((actor) => Promise.all([listInvoicesForActor(actor, filters), getInvoiceFilterOptions(actor), mayStartBills(actor)]));
  // Any filter at all (page aside) means an empty table is "no matches", not "no bills yet".
  const filtered = parsed.success && Object.keys(query).some((key) => key !== "page");
  const link = (page: number) => `/billing?${new URLSearchParams({ ...(parsed.success ? query : {}), page: String(page) })}`;
  return <section className="space-y-5"><header className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-bold">Billing</h1><p className="text-muted">Prepare a bill from its registration / visit.</p></div><div className="flex flex-wrap items-center gap-4"><Link href="/billing/dues" className="font-semibold text-accent underline">Dues list</Link>{mayCreate && <NewBillPicker />}</div></header>
    {!parsed.success && <p role="alert">Invalid filters. Showing bills within your permitted clinics.</p>}
    <form className="grid items-end gap-3 rounded-2xl border border-line bg-canvas p-5 sm:grid-cols-3">
      <Input id="invoice-search" name="search" label="Patient / mobile / code / invoice number" defaultValue={filters.search} maxLength={200} />
      <Select id="invoice-clinic" name="clinicId" label="Clinic" defaultValue={filters.clinicId ?? ""}><option value="">All permitted clinics</option>{options.clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}</Select>
      <Select id="invoice-doctor" name="doctorId" label="Doctor" defaultValue={filters.doctorId ?? ""}><option value="">All doctors</option>{options.doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name}</option>)}</Select>
      <Select id="invoice-status" name="status" label="Invoice status" defaultValue={filters.status ?? ""}><option value="">All statuses</option>{(["DRAFT", "ISSUED", "CANCELLED"] as const).map((status) => <option key={status} value={status}>{INVOICE_STATUS_LABELS[status]}</option>)}</Select>
      <Select id="invoice-payment" name="paymentStatus" label="Payment status" defaultValue={filters.paymentStatus ?? ""}><option value="">All payment statuses</option>{(["UNPAID", "PARTIAL", "PAID"] as const).map((status) => <option key={status} value={status}>{PAYMENT_STATUS_LABELS[status]}</option>)}</Select>
      <Input id="invoice-from" name="from" label="Issued from (IST)" type="date" defaultValue={filters.from} />
      <Input id="invoice-to" name="to" label="Issued through (IST)" type="date" defaultValue={filters.to} />
      <Button type="submit">Filter bills</Button><Link href="/billing" className="text-accent underline">Reset filters</Link>
    </form>
    <p>{invoices.total} bills · Page {invoices.page}</p>
    <div className="overflow-x-auto rounded-2xl border border-line bg-canvas"><table className="w-full text-left text-sm"><thead><tr>{["Bill", "Patient", "Clinic", "Status", "Payment", "Total", "Balance"].map((label) => <th key={label} className="p-3">{label}</th>)}</tr></thead>
      <tbody>{invoices.items.map((invoice) => <tr key={invoice.id} className="border-t border-line"><td className="p-3"><Link className="text-accent underline" href={`/billing/${invoice.id}`}>{invoice.invoiceNumber ?? "Draft bill"}</Link></td>
        <td className="p-3">{invoice.snapshot?.patient.name ?? invoice.patientName}<br />{invoice.snapshot?.patient.patientCode ?? invoice.patientCode}</td><td className="p-3">{invoice.snapshot?.clinic.name ?? invoice.clinicName}</td><td className="p-3">{INVOICE_STATUS_LABELS[invoice.status]}</td><td className="p-3">{invoice.status === "ISSUED" ? PAYMENT_STATUS_LABELS[invoice.paymentStatus] : "—"}</td><td className="p-3">{formatRupees(invoice.totals.grandTotal)}</td><td className="p-3">{formatRupees(invoice.balanceDue)}</td></tr>)}</tbody>
    </table>{!invoices.items.length && (filtered
      ? <p className="p-5">No bills match these filters. <Link href="/billing" className="text-accent underline">Reset filters</Link></p>
      : invoices.total === 0
        ? <p className="p-5">{mayCreate ? "No bills yet. Start one with + New bill, or open a visit in Registrations and click Create bill." : "No bills yet."}</p>
        : <p className="p-5">No bills on this page.</p>)}</div>
    <nav aria-label="Billing pagination" className="flex gap-4">{invoices.page > 1 && <Link href={link(invoices.page - 1)}>Previous</Link>}{invoices.page * invoices.pageSize < invoices.total && <Link href={link(invoices.page + 1)}>Next</Link>}</nav>
  </section>;
}
