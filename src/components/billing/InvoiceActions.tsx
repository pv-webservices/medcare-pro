"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import ReasonModal from "./ReasonModal";
import { postBilling } from "./billingRequest";

/** FR-11.19 cancel and FR-11.20 replacement. The server re-checks every condition shown here. */
export default function InvoiceActions({ invoiceId, registrationId, status, isIssuedBill, activePayments, mayCancel, mayCreate, replacement, liveInvoiceId }: {
  invoiceId: string; registrationId: string; status: "DRAFT" | "ISSUED" | "CANCELLED"; isIssuedBill: boolean; activePayments: number;
  mayCancel: boolean; mayCreate: boolean; replacement: { id: string; invoiceNumber: string | null } | null; liveInvoiceId: string | null;
}) {
  const router = useRouter();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function cancel(reason: string) {
    await postBilling(`/api/invoices/${invoiceId}/cancel`, { reason }, "Could not cancel this bill.");
    setCancelOpen(false);
    router.refresh();
  }
  async function replace() {
    setBusy(true); setError("");
    try {
      await postBilling(`/api/invoices/${invoiceId}/replace`, {}, "Could not create a replacement bill.");
      router.push(`/registration/${registrationId}/bill`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create a replacement bill.");
      setBusy(false);
    }
  }
  if (status === "ISSUED" && mayCancel) return <div className="space-y-2">
    <Button variant="danger" disabled={activePayments > 0} aria-describedby={activePayments > 0 ? "cancel-blocked" : undefined}
      onClick={() => setCancelOpen(true)}>Cancel bill</Button>
    {activePayments > 0 && <p id="cancel-blocked" className="text-muted">
      Void the {activePayments === 1 ? "active payment" : `${activePayments} active payments`} before cancelling this bill.</p>}
    <ReasonModal id="cancel-reason" isOpen={cancelOpen} title="Cancel bill?" confirmLabel="Cancel bill" onClose={() => setCancelOpen(false)} onConfirm={cancel}>
      <p>The bill keeps its number and stays on record as cancelled. The visit amount becomes ₹0 until a replacement is issued. This cannot be undone.</p>
    </ReasonModal>
  </div>;
  if (status !== "CANCELLED" || !isIssuedBill) return null;
  if (replacement) return <p>Replaced by <Link className="font-semibold text-accent underline" href={`/billing/${replacement.id}`}>{replacement.invoiceNumber ?? "a draft bill"}</Link>.</p>;
  if (liveInvoiceId) return <p>This visit already has <Link className="font-semibold text-accent underline" href={`/billing/${liveInvoiceId}`}>another live bill</Link>.</p>;
  if (!mayCreate) return null;
  return <div className="space-y-2">
    <Button variant="primary" isBusy={busy} onClick={replace}>Create replacement</Button>
    <p className="text-muted">Opens a new draft for this visit with these lines copied.</p>
    {error && <p role="alert" className="text-alert-ink">{error}</p>}
  </div>;
}
