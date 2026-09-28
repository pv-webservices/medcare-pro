import type { InvoiceSnapshot } from "@/lib/billing/invoiceValidation";
import Image from "next/image";
import { formatRupees } from "@/lib/money";

/** Issued detail and PB-5 print share this frozen document, never live profiles. */
export default function InvoiceDocument({ snapshot }: { snapshot: InvoiceSnapshot }) {
  return <article className="space-y-6 rounded-2xl border border-line bg-canvas p-5 sm:p-8">
    <header className="flex flex-wrap justify-between gap-4">
      <div>
        {snapshot.clinic.logoUrl && <Image src={snapshot.clinic.logoUrl} alt={`${snapshot.clinic.name} logo`} width={192} height={64} unoptimized className="mb-3 h-16 max-w-48 object-contain" />}
        <h2 className="text-xl font-bold">{snapshot.clinic.legalName || snapshot.clinic.name}</h2>
        <p>{snapshot.clinic.address}</p><p>{snapshot.clinic.city}</p>
        {snapshot.clinic.gstin && <p>GSTIN: {snapshot.clinic.gstin}</p>}
      </div>
      <div><h1 className="text-2xl font-bold">{({ INVOICE: "Invoice", TAX_INVOICE: "Tax Invoice", BILL_OF_SUPPLY: "Bill of Supply" })[snapshot.documentType]}</h1>
        <p>{snapshot.invoiceNumber}</p><p>{new Date(snapshot.issuedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST</p></div>
    </header>
    <section><h2 className="font-semibold">{snapshot.patient.name} · {snapshot.patient.patientCode}</h2>
      <p>{[snapshot.patient.age === null ? null : `Age ${snapshot.patient.age}`, snapshot.patient.gender, snapshot.patient.mobileNumber, snapshot.patient.city].filter(Boolean).join(" · ")}</p>
      <p>Visit: {snapshot.visit.date.slice(0, 16).replace("T", " ")} · {snapshot.visit.type === "FOLLOW_UP" ? "Follow-up" : "New patient"}</p>
      {snapshot.doctor && <p>{snapshot.doctor.name} · {snapshot.doctor.department}</p>}
    </section>
    <div className="overflow-x-auto"><table className="w-full text-left text-sm">
      <thead><tr>{["#", "Description", "SAC", "Qty", "Rate", "Discount", "Taxable", "GST %", "Amount"].map((label) => <th className="border-b border-line p-2" key={label}>{label}</th>)}</tr></thead>
      <tbody>{snapshot.lines.map((line) => <tr key={line.position}>
        {[line.position + 1, line.description, line.sacCode || "—", line.quantity, formatRupees(line.unitPrice), formatRupees(line.discountAmount), formatRupees(line.taxableAmount), line.taxRatePercent, formatRupees(line.lineTotal)].map((value, index) => <td key={index} className="border-b border-line p-2">{value}</td>)}
      </tr>)}</tbody></table></div>
    <dl className="ml-auto max-w-sm space-y-2">{([
      ["Subtotal", snapshot.totals.subtotal], ["Discount", snapshot.totals.discountTotal], ["Taxable", snapshot.totals.taxableTotal],
      ["CGST", snapshot.totals.cgstTotal], ["SGST", snapshot.totals.sgstTotal], ["Grand total", snapshot.totals.grandTotal],
    ]).map(([label, value]) => <div key={label} className="flex justify-between gap-6"><dt>{label}</dt><dd className="font-semibold">{formatRupees(value)}</dd></div>)}</dl>
    {snapshot.clinic.footerNote && <p className="whitespace-pre-wrap text-muted">{snapshot.clinic.footerNote}</p>}
  </article>;
}
