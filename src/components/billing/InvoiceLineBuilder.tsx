"use client";
import { useState } from "react";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";
import type { InvoiceLineInput } from "@/lib/billing/invoiceValidation";
import { serviceCategories } from "@/lib/billing/billingValidation";
import { discountAmountForPercent } from "@/lib/billing/invoiceMath";

export default function InvoiceLineBuilder({ line, index, onChange, onRemove }: {
  line: InvoiceLineInput; index: number; onChange: (line: InvoiceLineInput) => void; onRemove: () => void;
}) {
  const [percent, setPercent] = useState("");
  const [error, setError] = useState("");
  function applyPercent() {
    try {
      onChange({ ...line, discountAmount: discountAmountForPercent(line.quantity, line.unitPrice, percent) });
      setError("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Invalid discount."); }
  }
  const id = `line-${index}`;
  return <fieldset className="space-y-3 rounded-2xl border border-line p-4">
    <legend className="px-2 font-semibold">Line {index + 1}</legend>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Input id={`${id}-description`} label="Description" value={line.description} maxLength={200} onChange={(e) => onChange({ ...line, description: e.target.value })} />
      <Select id={`${id}-category`} label="Category" value={line.category} onChange={(e) => onChange({ ...line, category: e.target.value as InvoiceLineInput["category"] })}>{serviceCategories.map((category) => <option key={category}>{category}</option>)}</Select>
      <Input id={`${id}-qty`} label="Quantity" type="number" min={1} max={999} step={1} value={Number.isNaN(line.quantity) ? "" : line.quantity} onChange={(e) => onChange({ ...line, quantity: e.target.value === "" ? NaN : Number(e.target.value) })} />
      <Input id={`${id}-price`} label="Rate (₹)" inputMode="decimal" value={line.unitPrice} onChange={(e) => onChange({ ...line, unitPrice: e.target.value })} />
      <Input id={`${id}-discount`} label="Discount (₹)" inputMode="decimal" value={line.discountAmount} onChange={(e) => onChange({ ...line, discountAmount: e.target.value })} />
      <Input id={`${id}-tax`} label="GST (%)" inputMode="decimal" value={line.taxRatePercent} onChange={(e) => onChange({ ...line, taxRatePercent: e.target.value })} />
      <Input id={`${id}-sac`} label="SAC (optional)" inputMode="numeric" maxLength={8} value={line.sacCode ?? ""} onChange={(e) => onChange({ ...line, sacCode: e.target.value || null })} />
      <div className="flex items-end gap-2"><Input id={`${id}-percent`} label="Discount (%)" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} /><Button type="button" variant="secondary" onClick={applyPercent}>Apply</Button></div>
    </div>
    {error && <p role="alert" className="text-alert-ink">{error}</p>}
    <Button type="button" variant="danger" onClick={onRemove}>Remove line</Button>
  </fieldset>;
}
