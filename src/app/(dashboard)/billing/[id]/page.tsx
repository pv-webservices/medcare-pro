import Link from "next/link";
import InvoiceDocument from "@/components/billing/InvoiceDocument";
import InvoiceActions from "@/components/billing/InvoiceActions";
import IssuedNotice from "@/components/billing/IssuedNotice";
import PaymentList from "@/components/billing/PaymentList";
import RecordPaymentForm from "@/components/billing/RecordPaymentForm";
import StatusPill from "@/components/ui/StatusPill";
import { getInvoiceDetailForActor } from "@/lib/billing/invoiceDetail";
import { billingPage } from "@/lib/billing/billingPages";
import { INVOICE_STATUS_LABELS, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_TONES } from "@/lib/billing/billingLabels";
import { formatRupees } from "@/lib/money";

export const dynamic = "force-dynamic";
const ist = (iso: string) => `${new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })} IST`;

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { invoice, payments, replacement, liveInvoiceId, may } = await billingPage((actor) => getInvoiceDetailForActor(actor, id));
  const isIssuedBill = invoice.invoiceNumber !== null;
  const activePayments = payments.filter((payment) => payment.status === "ACTIVE").length;
  return <section className="space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-bold">{invoice.invoiceNumber ?? "Bill"} · {INVOICE_STATUS_LABELS[invoice.status]}</h1>
      <div className="flex flex-wrap gap-4">{invoice.snapshot && <Link href={`/billing/${invoice.id}/print`} className="text-accent underline">Print bill</Link>}
        <Link href="/billing/dues" className="text-accent underline">Dues list</Link><Link href="/billing" className="text-accent underline">All bills</Link></div>
    </header>
    {isIssuedBill && <IssuedNotice invoiceId={invoice.id} />}
    {invoice.status === "CANCELLED" && isIssuedBill && <div role="note" className="space-y-1 rounded-2xl border border-alert-line bg-alert-bg p-5 text-alert-ink">
      <p className="font-semibold">Cancelled{invoice.cancelledAt ? ` on ${ist(invoice.cancelledAt)}` : ""}.</p>
      {invoice.cancelReason && <p className="whitespace-pre-wrap">Reason: {invoice.cancelReason}</p>}
    </div>}
    {invoice.replacesInvoiceId && <p>Replaces a <Link className="text-accent underline" href={`/billing/${invoice.replacesInvoiceId}`}>cancelled bill</Link>.</p>}
    {invoice.snapshot ? <InvoiceDocument snapshot={invoice.snapshot} /> : <div className="rounded-2xl border border-line bg-canvas p-5">
      <p>{invoice.status === "DRAFT" ? "This bill is a draft." : "This draft was discarded without an invoice number."}</p>
      {invoice.status === "DRAFT" && may.create && <Link href={`/registration/${invoice.registrationId}/bill`} className="text-accent underline">Continue bill</Link>}
    </div>}
    {isIssuedBill && <div className="space-y-4">
      <h2 className="text-xl font-semibold">Payments</h2>
      <dl className="grid gap-3 rounded-2xl bg-canvas-deep p-4 sm:grid-cols-4">
        <div><dt className="text-muted">Status</dt><dd>{invoice.status === "ISSUED"
          ? <StatusPill tone={PAYMENT_STATUS_TONES[invoice.paymentStatus]}>{PAYMENT_STATUS_LABELS[invoice.paymentStatus]}</StatusPill>
          : <StatusPill tone="neutral">Bill cancelled</StatusPill>}</dd></div>
        <div><dt className="text-muted">Grand total</dt><dd className="font-semibold">{formatRupees(invoice.totals.grandTotal)}</dd></div>
        <div><dt className="text-muted">Paid</dt><dd className="font-semibold">{formatRupees(invoice.amountPaid)}</dd></div>
        {/* A cancelled bill is not owed; its stored balance is history, not a due. */}
        <div><dt className="text-muted">Balance due</dt><dd className="font-semibold">{invoice.status === "ISSUED" ? formatRupees(invoice.balanceDue) : "—"}</dd></div>
      </dl>
      <PaymentList invoiceId={invoice.id} payments={payments} mayVoid={may.cancel && invoice.status === "ISSUED"} />
      {invoice.status === "ISSUED" && may.recordPayment && invoice.balanceDue !== "0.00"
        && <RecordPaymentForm key={invoice.balanceDue} invoiceId={invoice.id} balanceDue={invoice.balanceDue} />}
    </div>}
    <InvoiceActions invoiceId={invoice.id} registrationId={invoice.registrationId} status={invoice.status} isIssuedBill={isIssuedBill}
      activePayments={activePayments} mayCancel={may.cancel} mayCreate={may.create} replacement={replacement} liveInvoiceId={liveInvoiceId} />
  </section>;
}
