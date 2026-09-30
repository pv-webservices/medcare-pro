import type { StatusTone } from "@/components/ui/StatusPill";

/** Front-desk wording for billing enums. Codes stay in URLs, filters and exports. */
export const INVOICE_STATUS_LABELS = { DRAFT: "Draft", ISSUED: "Issued", CANCELLED: "Cancelled" } as const;
export const PAYMENT_STATUS_LABELS = { UNPAID: "Unpaid", PARTIAL: "Partly paid", PAID: "Paid" } as const;
export const PAYMENT_MODE_LABELS = { CASH: "Cash", UPI: "UPI", CARD: "Card", BANK_TRANSFER: "Bank transfer", OTHER: "Other" } as const;
export const DUES_AGE_LABELS = { "0-7": "0–7 days", "8-30": "8–30 days", "31+": "31+ days" } as const;
export const PAYMENT_STATUS_TONES: Record<keyof typeof PAYMENT_STATUS_LABELS, StatusTone> = { UNPAID: "alert", PARTIAL: "warn", PAID: "ok" };
export const SERVICE_CATEGORY_LABELS = { CONSULTATION: "Consultation", PROCEDURE: "Procedure", TEST: "Test", OTHER: "Other" } as const;
export const INVOICE_TOTAL_LABELS = { subtotal: "Subtotal", discountTotal: "Discount", taxableTotal: "Taxable amount",
  cgstTotal: "CGST", sgstTotal: "SGST", grandTotal: "Grand total" } as const;
type TotalKey = keyof typeof INVOICE_TOTAL_LABELS;

/** Totals as labelled rows, in bill order. CGST and SGST are left out when both are zero (no GST on this bill). */
export function invoiceTotalRows<V extends number | string>(totals: Record<TotalKey, V>): Array<{ key: TotalKey; label: string; value: V }> {
  const noGst = Number(totals.cgstTotal) === 0 && Number(totals.sgstTotal) === 0;
  return (Object.keys(INVOICE_TOTAL_LABELS) as TotalKey[])
    .filter((key) => !(noGst && (key === "cgstTotal" || key === "sgstTotal")))
    .map((key) => ({ key, label: INVOICE_TOTAL_LABELS[key], value: totals[key] }));
}
