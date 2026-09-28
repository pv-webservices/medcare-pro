/** Billing PRD §5. Decimal strings at the boundary; integer paise internally. */
const MAX_PAISE = 9_999_999_999;

function integer(value: number, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > max)
    throw new RangeError("Amount is outside the supported range");
  return value;
}

export function toPaise(value: string): number {
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(value))
    throw new RangeError("Expected a non-negative decimal amount with at most two decimals");
  const [whole, fraction = ""] = value.split(".");
  return integer(Number(whole) * 100 + Number(fraction.padEnd(2, "0")), MAX_PAISE);
}

export function fromPaise(value: number): string {
  integer(value, MAX_PAISE);
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;
}

export interface LineInput {
  quantity: number;
  unitPrice: string;
  discountAmount: string;
  taxRatePercent: string;
}

export function computeLine(input: LineInput) {
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 999)
    throw new RangeError("Quantity must be a whole number from 1 to 999");
  const gross = integer(input.quantity * toPaise(input.unitPrice), MAX_PAISE);
  const discount = toPaise(input.discountAmount);
  if (discount > gross) throw new RangeError("Discount exceeds gross amount");
  const rate = toPaise(input.taxRatePercent);
  if (rate > 4000) throw new RangeError("GST rate exceeds 40 percent");
  const taxable = gross - discount;
  // The product stays below MAX_SAFE_INTEGER even at Decimal(10,2)'s ceiling.
  const tax = Math.floor((taxable * rate + 5000) / 10000);
  const cgst = Math.floor(tax / 2);
  const sgst = tax - cgst;
  const lineTotal = integer(taxable + tax, MAX_PAISE);
  return { gross, discount, taxable, tax, cgst, sgst, lineTotal };
}

export function computeTotals(lines: readonly ReturnType<typeof computeLine>[]) {
  const totals = { subtotal: 0, discountTotal: 0, taxableTotal: 0, cgstTotal: 0, sgstTotal: 0, grandTotal: 0 };
  for (const line of lines) {
    totals.subtotal = integer(totals.subtotal + line.gross, MAX_PAISE);
    totals.discountTotal = integer(totals.discountTotal + line.discount, MAX_PAISE);
    totals.taxableTotal = integer(totals.taxableTotal + line.taxable, MAX_PAISE);
    totals.cgstTotal = integer(totals.cgstTotal + line.cgst, MAX_PAISE);
    totals.sgstTotal = integer(totals.sgstTotal + line.sgst, MAX_PAISE);
    totals.grandTotal = integer(totals.grandTotal + line.lineTotal, MAX_PAISE);
  }
  return totals;
}

/** Display percentage rounded half up to two places. Compare exact ratios for authorization. */
export function discountPercent(discount: number, subtotal: number): string {
  integer(discount, MAX_PAISE);
  integer(subtotal, MAX_PAISE);
  if (discount > subtotal) throw new RangeError("Discount exceeds subtotal");
  if (subtotal === 0) return "0.00";
  const hundredths = Math.floor((discount * 10000 * 2 + subtotal) / (subtotal * 2));
  return fromPaise(hundredths);
}

export function derivePaymentStatus(grandTotal: number, amountPaid: number): "UNPAID" | "PARTIAL" | "PAID" {
  integer(grandTotal, MAX_PAISE);
  integer(amountPaid, MAX_PAISE);
  if (amountPaid > grandTotal) throw new RangeError("Overpayments are not supported");
  if (amountPaid === grandTotal) return "PAID";
  return amountPaid === 0 ? "UNPAID" : "PARTIAL";
}
