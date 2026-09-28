"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import ReasonModal from "./ReasonModal";
import { postBilling } from "./billingRequest";

export default function VoidPaymentButton({ invoiceId, paymentId, amountLabel }: { invoiceId: string; paymentId: string; amountLabel: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  async function confirm(reason: string) {
    await postBilling(`/api/invoices/${invoiceId}/payments/${paymentId}/void`, { reason }, "Could not void this payment.");
    setOpen(false);
    router.refresh();
  }
  return <>
    <Button size="sm" variant="danger" onClick={() => setOpen(true)}>Void</Button>
    <ReasonModal id={`void-${paymentId}`} isOpen={open} title="Void payment?" confirmLabel="Void payment" onClose={() => setOpen(false)} onConfirm={confirm}>
      <p>The {amountLabel} payment stays on record as voided and the balance due goes back up. Use this only for a payment entered by mistake. Refunds are not recorded here.</p>
    </ReasonModal>
  </>;
}
