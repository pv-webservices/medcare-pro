import StatusPill from "@/components/ui/StatusPill";
import { PAYMENT_MODE_LABELS } from "@/lib/billing/billingLabels";
import type { PaymentRecord } from "@/lib/billing/payments";
import { formatRupees } from "@/lib/money";
import VoidPaymentButton from "./VoidPaymentButton";

const ist = (iso: string) => `${new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })} IST`;

/** Server-rendered so India-time strings never differ between server and browser. */
export default function PaymentList({ invoiceId, payments, mayVoid }: { invoiceId: string; payments: PaymentRecord[]; mayVoid: boolean }) {
  if (!payments.length) return <p className="text-muted">No payments recorded yet.</p>;
  return <div className="overflow-x-auto rounded-2xl border border-line bg-canvas"><table className="w-full text-left text-sm">
    <thead><tr>{["Received", "Mode", "Reference", "Amount", "Recorded by", "Status", "Action"].map((label) => <th key={label} className="p-3">{label}</th>)}</tr></thead>
    <tbody>{payments.map((payment) => <tr key={payment.id} className="border-t border-line align-top">
      <td className="p-3">{ist(payment.receivedAt)}</td>
      <td className="p-3">{PAYMENT_MODE_LABELS[payment.mode]}</td>
      <td className="p-3 break-all">{payment.reference ?? "—"}</td>
      <td className={`p-3 font-semibold ${payment.status === "VOIDED" ? "line-through" : ""}`}>{formatRupees(payment.amount)}</td>
      <td className="p-3">{payment.recordedByName}</td>
      <td className="p-3">{payment.status === "ACTIVE" ? <StatusPill tone="ok">Active</StatusPill> : <div className="space-y-1">
        <StatusPill tone="neutral">Voided</StatusPill>
        <p className="text-muted">{payment.voidedByName ?? "Unknown user"}, {payment.voidedAt ? ist(payment.voidedAt) : ""}</p>
        <p className="whitespace-pre-wrap">{payment.voidReason}</p></div>}</td>
      <td className="p-3">{mayVoid && payment.status === "ACTIVE"
        ? <VoidPaymentButton invoiceId={invoiceId} paymentId={payment.id} amountLabel={formatRupees(payment.amount)} /> : "—"}</td>
    </tr>)}</tbody>
  </table></div>;
}
