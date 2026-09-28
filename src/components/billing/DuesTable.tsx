import Link from "next/link";
import StatusPill from "@/components/ui/StatusPill";
import { DUES_AGE_LABELS, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_TONES } from "@/lib/billing/billingLabels";
import type { DueRecord } from "@/lib/billing/dues";
import { formatRupees } from "@/lib/money";

const istDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium" });

/** FR-11.18. Every row links to its bill, where the payment is recorded. */
export default function DuesTable({ dues }: { dues: DueRecord[] }) {
  if (!dues.length) return <p className="rounded-2xl border border-line bg-canvas p-5">No outstanding bills match these filters.</p>;
  return <div className="overflow-x-auto rounded-2xl border border-line bg-canvas"><table className="w-full text-left text-sm">
    <thead><tr>{["Bill", "Patient", "Clinic / doctor", "Issued", "Age", "Status", "Total", "Paid", "Balance due"].map((label) => <th key={label} className="p-3">{label}</th>)}</tr></thead>
    <tbody>{dues.map((due) => <tr key={due.id} className="border-t border-line align-top">
      <td className="p-3"><Link className="font-semibold text-accent underline" href={`/billing/${due.id}`}>{due.invoiceNumber}</Link></td>
      <td className="p-3">{due.patientName}<br /><span className="text-muted">{due.patientCode} · {due.mobileNumber}</span></td>
      <td className="p-3">{due.clinicName}{due.doctorName && <><br /><span className="text-muted">{due.doctorName}</span></>}</td>
      <td className="p-3">{istDate(due.issuedAt)}</td>
      <td className="p-3">{due.ageDays} {due.ageDays === 1 ? "day" : "days"}<br /><span className="text-muted">{DUES_AGE_LABELS[due.ageBucket]}</span></td>
      <td className="p-3"><StatusPill tone={PAYMENT_STATUS_TONES[due.paymentStatus]}>{PAYMENT_STATUS_LABELS[due.paymentStatus]}</StatusPill></td>
      <td className="p-3">{formatRupees(due.grandTotal)}</td>
      <td className="p-3">{formatRupees(due.amountPaid)}</td>
      <td className="p-3 font-semibold">{formatRupees(due.balanceDue)}</td>
    </tr>)}</tbody>
  </table></div>;
}
