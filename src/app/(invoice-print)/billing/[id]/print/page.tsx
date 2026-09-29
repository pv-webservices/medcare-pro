import { notFound } from "next/navigation";
import Link from "next/link";
import InvoiceDocument from "@/components/billing/InvoiceDocument";
import PrintButton from "@/components/prescriptions/PrintButton";
import { getInvoicePrintForActor } from "@/lib/billing/invoiceDetail";
import { billingPage } from "@/lib/billing/billingPages";
import "./print.css";
export const dynamic = "force-dynamic";

/** FR-11.22: outside the dashboard layout, rendered only from the issue snapshot. */
export default async function InvoicePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { invoice, payments } = await billingPage((actor) => getInvoicePrintForActor(actor, id));
  // Drafts, and drafts discarded without a number, have no document to print.
  if (!invoice.snapshot || invoice.status === "DRAFT") notFound();
  const cancelled = invoice.status === "CANCELLED";
  return (
    <main className="invoice-print-shell">
      <div className="invoice-print-controls">
        <Link href={`/billing/${id}`}>← Bill</Link>
        <PrintButton label="Print bill" />
      </div>
      <InvoiceDocument
        snapshot={invoice.snapshot}
        printout={{
          payments,
          amountPaid: invoice.amountPaid,
          balanceDue: cancelled ? null : invoice.balanceDue,
          asOf: new Date().toISOString(),
          cancellation: cancelled ? { at: invoice.cancelledAt, reason: invoice.cancelReason } : null,
        }}
      />
    </main>
  );
}
