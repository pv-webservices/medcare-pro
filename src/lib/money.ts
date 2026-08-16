/**
 * Money formatting — Indian rupees.
 *
 * Amounts are stored as `Decimal(10, 2)` and carried through the app as plain
 * 2-decimal strings (see src/lib/registrations.ts), so nothing here parses a
 * float for storage — this is display only.
 *
 * `en-IN` grouping is deliberate: ₹1,50,000.00 is what a clinic in India
 * expects to read, not ₹150,000.00.
 */

export const CURRENCY_CODE = "INR";
export const CURRENCY_SYMBOL = "₹";

const FORMATTER = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: CURRENCY_CODE,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * "500.00" → "₹500.00".
 *
 * An unparseable value falls back to the symbol plus the raw text rather than
 * rendering "₹NaN" — this is used on the audit trail too, where the value is
 * whatever was recorded at the time.
 */
export function formatRupees(amount: string | number): string {
  const value = typeof amount === "number" ? amount : Number(amount);

  if (!Number.isFinite(value)) {
    return `${CURRENCY_SYMBOL}${String(amount)}`;
  }

  return FORMATTER.format(value);
}
