import type { InvoicePreviewSnapshot, InvoiceSnapshot } from "@/lib/billing/invoiceValidation";
import Image from "next/image";
import { amountInWords } from "@/lib/billing/amountInWords";
import { PAYMENT_MODE_LABELS } from "@/lib/billing/billingLabels";
import { formatRupees } from "@/lib/money";

const istDateTime = (iso: string) => `${new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })} IST`;

/**
 * The print-only part of the document (FR-11.22). Payments are NOT in the
 * frozen snapshot: they are read live and labelled with the time they were read.
 */
export interface InvoicePrintout {
  payments: Array<{ id: string; receivedAt: string; mode: keyof typeof PAYMENT_MODE_LABELS; reference: string | null; amount: string }>;
  amountPaid: string;
  /** null when the bill is cancelled: nothing is owed on it. */
  balanceDue: string | null;
  asOf: string;
  cancellation: { at: string | null; reason: string | null } | null;
}

/**
 * Issued detail and print share this frozen document, never live profiles.
 * Preview mode (a snapshot with no number yet) is the saved draft as it will be
 * issued, before issuing: watermarked, and with no number or issue time.
 */
export default function InvoiceDocument({ snapshot, printout }: { snapshot: InvoiceSnapshot | InvoicePreviewSnapshot; printout?: InvoicePrintout }) {
  const preview = snapshot.invoiceNumber === null;
  return <article className={`invoice-document relative space-y-6 rounded-2xl border border-line bg-canvas p-5 sm:p-8${preview ? " overflow-hidden" : ""}`}>
    {printout?.cancellation && <div aria-hidden="true" className="invoice-watermark">CANCELLED</div>}
    {preview && <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center">
      <span className="-rotate-[30deg] whitespace-nowrap text-3xl font-extrabold tracking-widest text-ink/10 sm:text-5xl">DRAFT — not yet issued</span>
    </div>}
    <header className="flex flex-wrap justify-between gap-4">
      <div>
        {snapshot.clinic.logoUrl && <Image src={snapshot.clinic.logoUrl} alt={`${snapshot.clinic.name} logo`} width={192} height={64} unoptimized className="mb-3 h-16 max-w-48 object-contain" />}
        <h2 className="text-xl font-bold">{snapshot.clinic.legalName || snapshot.clinic.name}</h2>
        <p>{snapshot.clinic.address}</p><p>{snapshot.clinic.city}</p>
        {snapshot.clinic.gstin && <p>GSTIN: {snapshot.clinic.gstin}</p>}
      </div>
      <div><h1 className="text-2xl font-bold">{({ INVOICE: "Invoice", TAX_INVOICE: "Tax Invoice", BILL_OF_SUPPLY: "Bill of Supply" })[snapshot.documentType]}</h1>
        {snapshot.invoiceNumber === null
          ? <><p className="text-muted">Number assigned on issue</p><p className="text-muted">Dated when issued</p></>
          : <><p>{snapshot.invoiceNumber}</p><p>{new Date(snapshot.issuedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST</p></>}</div>
    </header>
    {printout?.cancellation && <div role="note" className="invoice-cancelled rounded-xl border border-alert-line bg-alert-bg p-4 text-alert-ink">
      <p className="font-semibold">CANCELLED{printout.cancellation.at ? ` on ${istDateTime(printout.cancellation.at)}` : ""}. This bill is not payable.</p>
      {printout.cancellation.reason && <p className="whitespace-pre-wrap">Reason: {printout.cancellation.reason}</p>}
    </div>}
    <section><h2 className="font-semibold">{snapshot.patient.name} · {snapshot.patient.patientCode}</h2>
      <p>{[snapshot.patient.age === null ? null : `Age ${snapshot.patient.age}`, snapshot.patient.gender, snapshot.patient.mobileNumber, snapshot.patient.city].filter(Boolean).join(" · ")}</p>
      <p>Visit: {snapshot.visit.date.slice(0, 16).replace("T", " ")} · {snapshot.visit.type === "FOLLOW_UP" ? "Follow-up" : "New patient"}</p>
      {snapshot.doctor && <p>{snapshot.doctor.name} · {snapshot.doctor.department}</p>}
    </section>
    <div className="invoice-lines invoice-scroll overflow-x-auto"><table className="w-full text-left text-sm">
      <thead><tr>{["#", "Description", "SAC", "Qty", "Rate", "Discount", "Taxable", "GST %", "Amount"].map((label) => <th className="border-b border-line p-2" key={label}>{label}</th>)}</tr></thead>
      <tbody>{snapshot.lines.map((line) => <tr key={line.position}>
        {[line.position + 1, line.description, line.sacCode || "—", line.quantity, formatRupees(line.unitPrice), formatRupees(line.discountAmount), formatRupees(line.taxableAmount), line.taxRatePercent, formatRupees(line.lineTotal)].map((value, index) => <td key={index} className="border-b border-line p-2">{value}</td>)}
      </tr>)}</tbody></table></div>
    <div className="invoice-totals space-y-3">
      <dl className="ml-auto max-w-sm space-y-2">{([
        ["Subtotal", snapshot.totals.subtotal], ["Discount", snapshot.totals.discountTotal], ["Taxable", snapshot.totals.taxableTotal],
        ["CGST", snapshot.totals.cgstTotal], ["SGST", snapshot.totals.sgstTotal], ["Grand total", snapshot.totals.grandTotal],
      ]).map(([label, value]) => <div key={label} className="flex justify-between gap-6"><dt>{label}</dt><dd className="font-semibold">{formatRupees(value)}</dd></div>)}</dl>
      <p className="invoice-words"><span className="font-semibold">Amount in words:</span> {amountInWords(snapshot.totals.grandTotal)}</p>
    </div>
    {printout && <section className="invoice-payments space-y-2" aria-labelledby="invoice-payments-title">
      <h2 id="invoice-payments-title" className="font-semibold">Payments as of {istDateTime(printout.asOf)}</h2>
      {printout.payments.length === 0 ? <p>No payments recorded.</p> : <div className="invoice-scroll overflow-x-auto"><table className="w-full text-left text-sm">
        <thead><tr>{["Received", "Mode", "Reference", "Amount"].map((label) => <th className="border-b border-line p-2" key={label}>{label}</th>)}</tr></thead>
        <tbody>{printout.payments.map((payment) => <tr key={payment.id}>
          {[istDateTime(payment.receivedAt), PAYMENT_MODE_LABELS[payment.mode], payment.reference || "—", formatRupees(payment.amount)].map((value, index) => <td key={index} className="border-b border-line p-2">{value}</td>)}
        </tr>)}</tbody></table></div>}
      <dl className="ml-auto max-w-sm space-y-2">
        <div className="flex justify-between gap-6"><dt>Paid</dt><dd className="font-semibold">{formatRupees(printout.amountPaid)}</dd></div>
        <div className="flex justify-between gap-6"><dt>Balance due</dt><dd className="font-semibold">{printout.balanceDue === null ? "— (cancelled)" : formatRupees(printout.balanceDue)}</dd></div>
      </dl>
    </section>}
    {snapshot.clinic.footerNote && <p className="whitespace-pre-wrap text-muted">{snapshot.clinic.footerNote}</p>}
    {printout && <p className="text-sm text-muted">This is a computer-generated document.</p>}
  </article>;
}
