/** D7: sequence allocation belongs to the issue transaction, never this formatter. */
export function formatInvoiceNumber(prefix: string, fy: string, seq: number): string {
  if (!/^[A-Z0-9]{1,4}$/.test(prefix) || !/^\d{4}$/.test(fy))
    throw new RangeError("Invalid invoice prefix or financial year");
  if (!Number.isInteger(seq) || seq < 1 || seq > 99999)
    throw new RangeError("Invoice sequence must be from 1 to 99999");
  const number = `${prefix}-${fy}-${String(seq).padStart(5, "0")}`;
  if (number.length > 16) throw new RangeError("Invoice number exceeds 16 characters");
  return number;
}
