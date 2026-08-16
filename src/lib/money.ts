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

const LAKH = 100_000;
const CRORE = 10_000_000;
const THOUSAND = 1_000;

/**
 * A short form for axis ticks, where a full figure will not fit.
 *
 * Uses the Indian scale — thousand, lakh, crore — to match the en-IN grouping
 * above. "₹1.2L" is what a clinic in India reads; "₹120K" is not.
 *
 * Ticks only. Money the reader has to act on is shown in full by
 * `formatRupees`: at clinic scale an exact total is short enough to print, and
 * rounding a revenue figure to one decimal is a worse trade than the space it
 * saves.
 */
export function formatRupeesCompact(amount: string | number): string {
  const value = typeof amount === "number" ? amount : Number(amount);

  if (!Number.isFinite(value)) {
    return `${CURRENCY_SYMBOL}0`;
  }

  const sign = value < 0 ? "-" : "";
  const magnitude = Math.abs(value);

  const trim = (scaled: number, suffix: string) =>
    `${sign}${CURRENCY_SYMBOL}${Number(scaled.toFixed(1))}${suffix}`;

  if (magnitude >= CRORE) return trim(magnitude / CRORE, "Cr");
  if (magnitude >= LAKH) return trim(magnitude / LAKH, "L");
  if (magnitude >= THOUSAND) return trim(magnitude / THOUSAND, "K");

  return `${sign}${CURRENCY_SYMBOL}${Math.round(magnitude)}`;
}

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
