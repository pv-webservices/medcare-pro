"use client";
import { useState } from "react";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";
import type { InvoiceLineInput } from "@/lib/billing/invoiceValidation";
import { serviceCategories } from "@/lib/billing/billingValidation";
import { discountAmountForPercent } from "@/lib/billing/invoiceMath";
import { BILLING_MESSAGES, friendlyBillingMessage, lineFieldErrors, parseDiscountPercent, type LineField } from "@/lib/billing/billingMessages";

export default function InvoiceLineBuilder({ line, index, onChange, onRemove, showErrors = false }: {
  line: InvoiceLineInput; index: number; onChange: (line: InvoiceLineInput) => void; onRemove: () => void;
  /** Show every field's problem, not just the ones edited so far (e.g. after a failed save). */
  showErrors?: boolean;
}) {
  const [percent, setPercent] = useState("");
  const [percentError, setPercentError] = useState("");
  const [touched, setTouched] = useState<ReadonlySet<LineField>>(new Set());
  const errors = lineFieldErrors(line);
  const errorFor = (field: LineField) => (showErrors || touched.has(field) ? errors[field] : undefined);
  function change(field: LineField, next: InvoiceLineInput) {
    setTouched((current) => new Set(current).add(field));
    onChange(next);
  }
  function applyPercent() {
    const parsed = parseDiscountPercent(percent);
    if (parsed === null) { setPercentError(BILLING_MESSAGES.discountPercent); return; }
    try {
      change("discountAmount", { ...line, discountAmount: discountAmountForPercent(line.quantity, line.unitPrice, parsed) });
      setPercentError("");
    } catch (failure) {
      // Only a bad quantity or rate can stop the conversion; name that field, never the internal text.
      setPercentError(errors.unitPrice ?? errors.quantity ?? friendlyBillingMessage(failure instanceof Error ? failure.message : ""));
    }
  }
  const id = `line-${index}`;
  return <fieldset className="space-y-3 rounded-2xl border border-line p-4">
    <legend className="px-2 font-semibold">Line {index + 1}</legend>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Input id={`${id}-description`} label="Description" value={line.description} maxLength={200} error={errorFor("description")}
        onChange={(e) => change("description", { ...line, description: e.target.value })} />
      <Select id={`${id}-category`} label="Category" value={line.category} onChange={(e) => onChange({ ...line, category: e.target.value as InvoiceLineInput["category"] })}>{serviceCategories.map((category) => <option key={category}>{category}</option>)}</Select>
      <Input id={`${id}-qty`} label="Quantity" type="number" min={1} max={999} step={1} error={errorFor("quantity")}
        value={Number.isNaN(line.quantity) ? "" : line.quantity} onChange={(e) => change("quantity", { ...line, quantity: e.target.value === "" ? NaN : Number(e.target.value) })} />
      <Input id={`${id}-price`} label="Rate (₹)" inputMode="decimal" value={line.unitPrice} error={errorFor("unitPrice")}
        onChange={(e) => change("unitPrice", { ...line, unitPrice: e.target.value })} />
      <Input id={`${id}-discount`} label="Discount (₹)" inputMode="decimal" value={line.discountAmount} error={errorFor("discountAmount")}
        onChange={(e) => change("discountAmount", { ...line, discountAmount: e.target.value })} />
      <Input id={`${id}-tax`} label="GST (%)" inputMode="decimal" value={line.taxRatePercent} error={errorFor("taxRatePercent")}
        onChange={(e) => change("taxRatePercent", { ...line, taxRatePercent: e.target.value })} />
      <Input id={`${id}-sac`} label="SAC (optional)" inputMode="numeric" maxLength={8} value={line.sacCode ?? ""} error={errorFor("sacCode")}
        onChange={(e) => change("sacCode", { ...line, sacCode: e.target.value || null })} />
      <div className="flex items-end gap-2">
        <Input id={`${id}-percent`} label="Discount (%)" inputMode="decimal" value={percent} error={percentError || undefined}
          onChange={(e) => { setPercent(e.target.value); setPercentError(""); }} />
        <Button type="button" variant="secondary" disabled={!percent.trim()} onClick={applyPercent}>Apply</Button>
      </div>
    </div>
    <Button type="button" variant="danger" onClick={onRemove}>Remove line</Button>
  </fieldset>;
}
