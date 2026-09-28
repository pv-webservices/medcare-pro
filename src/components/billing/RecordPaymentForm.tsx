"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import { paymentModes, recordPaymentSchema } from "@/lib/billing/invoiceValidation";
import { PAYMENT_MODE_LABELS } from "@/lib/billing/billingLabels";
import { formatRupees } from "@/lib/money";
import { postBilling } from "./billingRequest";

type Mode = (typeof paymentModes)[number];

/** FR-11.16. Mount with key={balanceDue} so the default amount follows the saved balance. */
export default function RecordPaymentForm({ invoiceId, balanceDue }: { invoiceId: string; balanceDue: string }) {
  const router = useRouter();
  const [amount, setAmount] = useState(balanceDue);
  const [mode, setMode] = useState<Mode>("CASH");
  const [reference, setReference] = useState("");
  const [receivedAt, setReceivedAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The desk enters India wall-clock time, whatever zone the browser is in.
    const body = recordPaymentSchema.safeParse({ amount: amount.trim(), mode, reference: reference.trim() || null,
      ...(receivedAt ? { receivedAt: `${receivedAt}:00+05:30` } : {}) });
    if (!body.success) { setError("Enter an amount greater than zero, with at most two decimals."); return; }
    setBusy(true); setError("");
    try {
      await postBilling(`/api/invoices/${invoiceId}/payments`, body.data, "Could not record this payment.");
      router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not record this payment."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="space-y-4 rounded-2xl border border-line bg-canvas p-5">
    <h3 className="text-lg font-semibold">Record a payment</h3>
    <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
      <Input id="payment-amount" label="Amount (₹)" inputMode="decimal" required value={amount} onChange={(event) => setAmount(event.target.value)}
        hint={`Balance due ${formatRupees(balanceDue)}. Overpayment is not supported.`} />
      <Select id="payment-mode" label="Mode" value={mode} onChange={(event) => setMode(event.target.value as Mode)}>
        {paymentModes.map((value) => <option key={value} value={value}>{PAYMENT_MODE_LABELS[value]}</option>)}
      </Select>
      <Input id="payment-reference" label="Reference (optional)" maxLength={100} value={reference}
        onChange={(event) => setReference(event.target.value)} hint="For example a UPI transaction ID." />
      <Input id="payment-received" label="Received at (IST, optional)" type="datetime-local" value={receivedAt}
        onChange={(event) => setReceivedAt(event.target.value)} hint="Leave blank to use the current time." />
    </fieldset>
    {error && <p role="alert" className="text-alert-ink">{error}</p>}
    <Button type="submit" variant="primary" isBusy={busy}>Record payment</Button>
  </form>;
}
