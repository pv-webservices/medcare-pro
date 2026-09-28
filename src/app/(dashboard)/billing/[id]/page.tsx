import Link from "next/link";
import InvoiceDocument from "@/components/billing/InvoiceDocument";
import { getInvoiceForActor } from "@/lib/billing/invoices";
import { billingPage } from "@/lib/billing/billingPages";
import { formatRupees } from "@/lib/money";

export const dynamic = "force-dynamic";
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invoice = await billingPage((actor) => getInvoiceForActor(actor, id));
  return <section className="space-y-5"><header className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-bold">Bill · {invoice.status}</h1><Link href="/billing" className="text-accent underline">All bills</Link></header>
    {invoice.snapshot ? <InvoiceDocument snapshot={invoice.snapshot} /> : <div className="rounded-2xl border border-line bg-canvas p-5"><p>{invoice.status === "DRAFT" ? "This bill is a draft." : "This draft was discarded without an invoice number."}</p>
      {invoice.status === "DRAFT" && <Link href={`/registration/${invoice.registrationId}/bill`} className="text-accent underline">Continue bill</Link>}</div>}
    <p>Payment status: <strong>{invoice.paymentStatus}</strong> · Paid {formatRupees(invoice.amountPaid)} · Balance due {formatRupees(invoice.balanceDue)}</p>
  </section>;
}
